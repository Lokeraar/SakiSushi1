-- ============================================================================
-- 43 — Identidad de clientes: anónimo y registrado
-- ============================================================================
--
-- PROBLEMA QUE RESUELVE
--
-- Hasta hoy el cliente no tenía identidad real. `crear_pedido_con_reserva`
-- guardaba `COALESCE(auth.uid()::TEXT, 'anon')`, y un visitante sin sesión
-- caía siempre en el literal `'anon'`.
--
-- Ese literal es COMPARTIDO: si dos invitados piden, los dos quedan como
-- 'anon'. Por eso no se puede simplemente dejarlo pasar en las reglas de
-- lectura. Sería el peor defecto posible: todos los invitados viendo los
-- pedidos de todos.
--
-- Los pedidos viejos además quedaron con NULL, porque la función cambió
-- después de que se crearan.
--
-- LA SOLUCIÓN
--
-- 1. El cliente anónimo genera un identificador de 128 bits en su teléfono.
-- 2. Lo cambia por una FICHA firmada por el servidor. Para firmar hay una
--    clave secreta que solo vive en la base: el navegador no puede fabricar
--    una ficha válida ni ver la clave.
-- 3. Al pedir, manda la ficha. La función comprueba la firma y guarda el
--    identificador del cliente.
-- 4. Al leer su historial, manda la ficha otra vez. Una función comprueba la
--    firma y devuelve SOLO las filas de ese identificador.
--
-- Por qué no se confía en el identificador crudo: cualquiera que lo vea
-- podría leer ese historial. Con firma, cambiar un solo carácter invalida la
-- ficha entera.
--
-- El cliente REGISTRADO no usa nada de esto: tiene sesión de Supabase Auth,
-- y `auth.uid()` ya lo verifica el servidor.
-- ============================================================================

BEGIN;

-- ----------------------------------------------------------------------------
-- El secreto para firmar.
--
-- Vive en una tabla privada sin acceso para nadie. Una función antigua de
-- `anon` no lo ve: solo lo leen las funciones SECURITY DEFINER de abajo.
-- Se genera una sola vez y no se toca más; si se rotara, todas las fichas
-- emitidas dejarían de valer.
-- ----------------------------------------------------------------------------
CREATE SCHEMA IF NOT EXISTS private;
REVOKE ALL ON SCHEMA private FROM PUBLIC, anon, authenticated;

CREATE TABLE IF NOT EXISTS private.firma_cliente (
    id        BOOLEAN PRIMARY KEY DEFAULT TRUE CHECK (id),
    secreto   TEXT NOT NULL,
    creado_en TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

INSERT INTO private.firma_cliente (id, secreto)
VALUES (TRUE, encode(extensions.gen_random_bytes(32), 'hex'))
ON CONFLICT (id) DO NOTHING;

-- Nadie entra salvo las funciones que corren como dueño.
REVOKE ALL ON private.firma_cliente FROM PUBLIC, anon, authenticated;

-- ----------------------------------------------------------------------------
-- Comprobación de la ficha.
--
-- La ficha tiene la forma  <id>.<firma>  y se verifica sin base de datos
-- externa: se recalcula la firma con el secreto y se compara.
--
-- `IS DISTINCT FROM` y no `<>` por la misma razón de siempre: en SQL
-- `NULL <> NULL` no es verdadero, es NULL, y una comparación nula dejaría
-- pasar la ficha.
-- ----------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.ficha_valida(p_ficha TEXT)
RETURNS TEXT
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
    v_id       TEXT;
    v_recibida TEXT;
    v_esperada TEXT;
    v_secreto  TEXT;
BEGIN
    IF p_ficha IS NULL OR p_ficha = '' THEN
        RETURN NULL;
    END IF;

    -- Formato: exactamente un punto, un id y una firma.
    IF length(p_ficha) > 300 OR p_ficha NOT LIKE '%.%' THEN
        RETURN NULL;
    END IF;

    v_id       := split_part(p_ficha, '.', 1);
    v_recibida := split_part(p_ficha, '.', 2);

    -- 32 caracteres hex = 128 bits. Ni más corto (adivinable) ni más largo.
    IF v_id !~ '^[0-9a-f]{32}$' THEN
        RETURN NULL;
    END IF;

    SELECT secreto INTO v_secreto FROM private.firma_cliente WHERE id = TRUE;
    IF v_secreto IS NULL THEN
        RETURN NULL;
    END IF;

    v_esperada := encode(extensions.hmac(v_id, v_secreto, 'sha256'), 'hex');

    -- Comparación en tiempo constante.
    --
    -- Comparar con `<>` filtra, por lo lento que tarda en fallar, cuántos
    -- caracteres iniciales acertó quien está probando. Con 64 caracteres
    -- hex y suficientes intentos, eso alcanza para reconstruir la firma
    -- carácter por carácter. No es teórico: es un ataque conocido.
    IF length(v_recibida) <> length(v_esperada) THEN
        RETURN NULL;
    END IF;

    IF extensions.hmac(v_recibida, v_secreto, 'sha256')
       IS DISTINCT FROM extensions.hmac(v_esperada, v_secreto, 'sha256') THEN
        RETURN NULL;
    END IF;

    RETURN v_id;
END;
$$;

-- ----------------------------------------------------------------------------
-- Emisión de la ficha.
--
-- El navegador NO propone el identificador: lo genera la base con 128 bits
-- reales. Así no depende de que el navegador tenga un generador criptográfico
-- disponible, y el identificador nunca nace débil.
--
-- Devuelve la ficha, que el cliente guarda tal cual en su teléfono.
-- ----------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.emitir_ficha_cliente()
RETURNS TEXT
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
    v_id      TEXT;
    v_secreto TEXT;
BEGIN
    v_id := encode(extensions.gen_random_bytes(16), 'hex');

    SELECT secreto INTO v_secreto FROM private.firma_cliente WHERE id = TRUE;

    RETURN v_id || '.' || encode(extensions.hmac(v_id, v_secreto, 'sha256'), 'hex');
END;
$$;

-- ----------------------------------------------------------------------------
-- Resolver la identidad de quien llama.
--
-- Devuelve, en este orden de preferencia:
--   1. `auth.uid()` si hay sesión (cliente registrado, cajero, admin).
--   2. El identificador de la ficha, si la firma es válida (cliente anónimo).
--   3. NULL, si no hay ninguna de las dos.
--
-- Null significa "sin identidad", y quien llama decide qué hacer. NO se
-- devuelve un valor compartido como 'anon': eso fue justo el defecto.
-- ----------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.cliente_actual(p_ficha TEXT DEFAULT NULL)
RETURNS TEXT
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
BEGIN
    IF auth.uid() IS NOT NULL THEN
        RETURN auth.uid()::TEXT;
    END IF;

    RETURN public.ficha_valida(p_ficha);
END;
$$;

-- ----------------------------------------------------------------------------
-- Historial del cliente anónimo.
--
-- La tabla `pedidos` tiene RLS y su regla es `session_id = auth.uid()`.
-- Un anónimo no tiene `auth.uid()`, así que la regla nunca le devuelve nada.
-- Esta función corre como dueña (SECURITY DEFINER), comprueba la firma y
-- filtra explícitamente por el identificador verificado.
--
-- Es la ÚNICA puerta de lectura para invitados, y devuelve solo lo suyo.
-- ----------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.pedidos_de_cliente(p_ficha TEXT)
RETURNS SETOF public.pedidos
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
    v_id TEXT;
BEGIN
    v_id := public.cliente_actual(p_ficha);

    IF v_id IS NULL THEN
        -- Sin identidad válida no se devuelve nada, y no se devuelve un
        -- error revelador: simplemente el conjunto vacío.
        RETURN;
    END IF;

    RETURN QUERY
        SELECT p.* FROM public.pedidos p
         WHERE p.session_id = v_id
         ORDER BY p.fecha DESC
         LIMIT 100;
END;
$$;

-- ----------------------------------------------------------------------------
-- Notificaciones del cliente anónimo.
--
-- Mismo razonamiento que el historial: la campanita hoy está vacía para
-- siempre porque su regla compara contra un `auth.uid()` que no existe.
-- ----------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.notificaciones_de_cliente(p_ficha TEXT)
RETURNS SETOF public.notificaciones
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
    v_id TEXT;
BEGIN
    v_id := public.cliente_actual(p_ficha);

    IF v_id IS NULL THEN
        RETURN;
    END IF;

    RETURN QUERY
        SELECT n.* FROM public.notificaciones n
         WHERE n.session_id = v_id
         ORDER BY n.fecha DESC
         LIMIT 50;
END;
$$;

-- ----------------------------------------------------------------------------
-- Guardar la suscripción push con identidad verificada.
--
-- Antes el cliente mandaba un session_id que inventaba su propio navegador
-- (`cli-...`, con Math.random de 8 caracteres). Ahora ese valor lo emite y lo
-- firma la base.
-- ----------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.registrar_push_cliente(
    p_ficha       TEXT,
    p_endpoint    TEXT,
    p_p256dh      TEXT,
    p_auth        TEXT,
    p_user_agent  TEXT DEFAULT NULL
)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
    v_id TEXT;
    v_row public.push_subscriptions;
BEGIN
    v_id := public.cliente_actual(p_ficha);

    IF v_id IS NULL THEN
        RETURN jsonb_build_object('success', false, 'error', 'ficha_invalida');
    END IF;

    INSERT INTO public.push_subscriptions AS ps
        (session_id, endpoint, p256dh, auth, user_agent, rol)
    VALUES
        (v_id, p_endpoint, p_p256dh, p_auth, p_user_agent, 'cliente')
    ON CONFLICT (endpoint) DO UPDATE
        SET session_id = EXCLUDED.session_id,
            p256dh     = EXCLUDED.p256dh,
            auth       = EXCLUDED.auth,
            user_agent = EXCLUDED.user_agent,
            rol        = 'cliente'
    RETURNING * INTO v_row;

    RETURN jsonb_build_object('success', true, 'id', v_row.id, 'rol', v_row.rol);
END;
$$;

COMMIT;
