-- ============================================================
-- 41 — El cliente registra su suscripción push a través de una función
-- ============================================================
--
-- QUÉ PROBLEMA RESUELVE
--
-- La migración 40 le abrió al visitante anónimo INSERT y DELETE sobre
-- `push_subscriptions`, acotados a `rol = 'cliente'`. El INSERT funciona y un
-- `rol = 'admin'` por esa puerta sigue rechazado: eso está bien.
--
-- Pero `cliente-notificaciones.js` no inserta: hace un `upsert` con
-- `onConflict: 'endpoint'`. Un upsert es INSERT + UPDATE, y ahí aparecen dos
-- límites que ninguna policy de INSERT resuelve:
--
--   1. PostgREST exige el permiso de TABLA de UPDATE antes de evaluar nada.
--   2. RLS, para actualizar una fila, necesita poder LEERLA primero: sin una
--      policy de SELECT, el UPDATE no ve ninguna fila y falla.
--
-- El mensaje que devuelve ("new row violates row-level security policy") no
-- ayuda: suena a que la fila es inválida, cuando el problema es que la
-- sentencia no llega a verla.
--
-- POR QUÉ UNA FUNCIÓN Y NO MÁS POLICIES
--
-- Darle SELECT a anon sería abrirle la tabla: podría leer los endpoints y las
-- claves de todos los dispositivos suscritos. Aunque sin la clave privada
-- VAPID no pueda enviar push, son datos de otros. No hace falta para nada:
-- el visitante solo necesita poder escribir LA SUYA.
--
-- Esta función hace el upsert con permisos de dueño, valida el rol adentro y
-- no expone ninguna lectura. Es el mismo patrón que ya usa el resto del
-- proyecto (`crear_cierre_local`, `aplicar_tasa_elegida`, `crear_reserva`):
-- la tabla queda cerrada, la puerta es una función con reglas explícitas.
--
-- QUÉ PUEDE HACER UN ANÓNIMO CON ESTO
--
-- Registrar o renovar una suscripción con rol 'cliente'. Nada más:
--   · no puede leer suscripciones ajenas (no hay SELECT),
--   · no puede borrarlas (solo la suya, vía la policy de DELETE de la 40),
--   · no puede crearse una fila de cajero ni de admin (el rol es fijo acá).
--
-- IDEMPOTENTE.
-- ============================================================

BEGIN;

CREATE OR REPLACE FUNCTION public.registrar_push_cliente(
    p_session_id TEXT,
    p_endpoint   TEXT,
    p_p256dh     TEXT,
    p_auth       TEXT,
    p_user_agent TEXT DEFAULT NULL
)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $$
DECLARE
    v_id BIGINT;
BEGIN
    -- Validación mínima: sin endpoint no hay a quién notificar.
    IF p_endpoint IS NULL OR length(btrim(p_endpoint)) = 0 THEN
        RETURN jsonb_build_object('success', false, 'error', 'Falta el endpoint');
    END IF;
    IF p_session_id IS NULL OR length(btrim(p_session_id)) = 0 THEN
        RETURN jsonb_build_object('success', false, 'error', 'Falta el session_id');
    END IF;

    -- Upsert por endpoint, que es único en la tabla. El rol SIEMPRE es
    -- 'cliente' y se escribe acá, no se recibe por parámetro: es lo que
    -- impide que un anónimo se registre como cajero o admin.
    INSERT INTO push_subscriptions (session_id, endpoint, p256dh, auth, rol, user_agent)
    VALUES (btrim(p_session_id), btrim(p_endpoint), p_p256dh, p_auth, 'cliente', p_user_agent)
    ON CONFLICT (endpoint) DO UPDATE
       SET session_id = EXCLUDED.session_id,
           p256dh     = EXCLUDED.p256dh,
           auth       = EXCLUDED.auth,
           user_agent = COALESCE(EXCLUDED.user_agent, push_subscriptions.user_agent)
     -- Solo se renueva una fila que ya era de cliente. Si el endpoint
     -- colisionara con una de cajero o admin, no se toca.
     WHERE push_subscriptions.rol = 'cliente'
    RETURNING id INTO v_id;

    IF v_id IS NULL THEN
        RETURN jsonb_build_object('success', false,
                                  'error', 'Ese endpoint pertenece a otra sesión');
    END IF;

    RETURN jsonb_build_object('success', true, 'id', v_id);
END;
$$;

-- El visitante es anónimo: la función tiene que ser invocable sin sesión.
REVOKE ALL ON FUNCTION public.registrar_push_cliente(TEXT, TEXT, TEXT, TEXT, TEXT) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.registrar_push_cliente(TEXT, TEXT, TEXT, TEXT, TEXT) TO anon, authenticated;

COMMIT;
