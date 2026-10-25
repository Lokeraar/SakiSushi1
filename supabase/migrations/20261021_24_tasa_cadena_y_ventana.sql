-- ============================================================
-- 20261021_24_tasa_cadena_y_ventana.sql
--
-- TRES COSAS, Y UN DEFECTO QUE HABÍA QUE CERRAR PRIMERO
-- ============================================================
--
-- EL DEFECTO
--
-- La migración 22 dejó la captura a mitad de camino. El cron de las 5 pm
-- llamaba a `solicitar_captura_tasa()`, que DISPARA la petición HTTP con
-- pg_net y devuelve un id. La respuesta queda guardada en
-- `net._http_response`. Pero NINGÚN cron la procesaba: `procesar_respuesta_tasa()`
-- existía y nadie la llamaba.
--
-- Medido al empezar esta migración:
--
--   cron que procesa respuestas : 0
--   respuestas descargadas       : 1
--   filas en tasa_bcv            : 2  (la sembrada a mano + una cargada en el panel)
--
-- Es decir: el automatismo salía a preguntar el precio al BCV y volvía con la
-- respuesta en la mano, pero nadie la pasaba a la caja.
--
-- Lo que sigue construye la cadena de respaldos SOBRE ese procesamiento, así
-- que primero se cierra el circuito.
--
-- ============================================================
-- PARTE 1 — LA CADENA DE RESPALDOS
-- ============================================================
--
-- Orden de fuentes:
--
--   1. ve.dolarapi.com   principal. Informa `fechaActualizacion`, que es lo
--                        más parecido a la fecha valor que da una API.
--   2. open.er-api.com   respaldo 1. Devuelve el número correcto pero NO la
--                        fecha valor del BCV: `time_last_update_utc` es cuándo
--                        refrescó su cotización. Medido: devolvía 887,302
--                        (la del martes 27) con fecha 25/10.
--   3. currency-api      respaldo 2 (fawazahmed0, vía jsDelivr). Devuelve
--                        `ves.usd` invertido. Tampoco informa fecha valor
--                        del BCV.
--
-- REGLA: una fuente no principal NUNCA produce una captura 'aplicada'.
-- Entra como 'pendiente' con el motivo escrito, y espera que un humano la
-- confirme desde el panel. Si la dejáramos 'aplicada', su fecha inventada
-- podría convertirla en "vigente" sin que nadie lo note: exactamente la
-- trampa que la migración 22 evitó.
--
-- IDEMPOTENTE.
-- ============================================================

BEGIN;

-- ============================================================
-- Estado de cada intento de captura
-- ============================================================
--
-- Sin esto no se puede saber en qué eslabón de la cadena vamos.
CREATE TABLE IF NOT EXISTS tasa_intento (
    id            BIGSERIAL PRIMARY KEY,
    -- El mismo id que devuelve net.http_get(). Es la llave para leer la
    -- respuesta: `net._http_response` NO tiene columna `url`.
    http_id       BIGINT,
    fuente        TEXT        NOT NULL,
    es_principal  BOOLEAN     NOT NULL DEFAULT FALSE,
    disparado_en  TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    -- 'en_curso'  -> disparado, esperando respuesta
    -- 'ok'        -> la respuesta se registró en tasa_bcv
    -- 'fallido'   -> la respuesta no sirvió; hay que probar la siguiente
    estado        TEXT        NOT NULL DEFAULT 'en_curso',
    detalle       TEXT,
    CONSTRAINT tasa_intento_estado_valido
        CHECK (estado IN ('en_curso','ok','fallido'))
);

CREATE INDEX IF NOT EXISTS idx_tasa_intento_estado
    ON tasa_intento(estado, disparado_en DESC);

COMMENT ON TABLE tasa_intento IS
    'Cada disparo de la cadena de fuentes de la tasa. Sin esto no se sabe en qué eslabón va ni por qué falló.';

-- ============================================================
-- Disparar una fuente concreta
-- ============================================================
CREATE OR REPLACE FUNCTION public._disparar_fuente_tasa(p_fuente TEXT, p_es_principal BOOLEAN)
RETURNS BIGINT
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public', 'net'
AS $$
DECLARE
    v_url TEXT;
    v_req BIGINT;
BEGIN
    v_url := CASE p_fuente
        WHEN 'dolarapi'     THEN 'https://ve.dolarapi.com/v1/dolares/oficial'
        WHEN 'er-api'       THEN 'https://open.er-api.com/v6/latest/USD'
        WHEN 'currency-api' THEN 'https://cdn.jsdelivr.net/npm/@fawazahmed0/currency-api@latest/v1/currencies/ves.json'
        ELSE NULL
    END;

    IF v_url IS NULL THEN
        RAISE EXCEPTION 'Fuente de tasa desconocida: %', p_fuente USING ERRCODE = '22023';
    END IF;

    SELECT net.http_get(url := v_url, timeout_milliseconds := 15000) INTO v_req;

    INSERT INTO tasa_intento (http_id, fuente, es_principal, estado)
    VALUES (v_req, p_fuente, p_es_principal, 'en_curso');

    RETURN v_req;
END;
$$;

-- ============================================================
-- Arrancar la cadena del día
-- ============================================================
CREATE OR REPLACE FUNCTION public.capturar_tasa_con_respaldo()
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $$
DECLARE
    v_req BIGINT;
BEGIN
    -- Si ya hay un intento en curso o resuelto hoy, no se duplica.
    IF EXISTS (
        SELECT 1 FROM tasa_intento
         WHERE disparado_en::DATE = CURRENT_DATE
           AND estado IN ('en_curso', 'ok')
    ) THEN
        RETURN jsonb_build_object(
            'success', false,
            'ya_intentado', true,
            'error', 'La cadena de hoy ya arrancó o terminó. No se duplica.'
        );
    END IF;

    v_req := public._disparar_fuente_tasa('dolarapi', TRUE);

    RETURN jsonb_build_object(
        'success', true,
        'http_id', v_req,
        'fuente', 'dolarapi',
        'eslabon', 1
    );
END;
$$;

-- ============================================================
-- Leer una respuesta y decidir si sirve
-- ============================================================
--
-- Cada fuente tiene su forma. Esta función traduce las tres a un mismo
-- contrato: valor, fecha valor, y si esa fecha es confiable.
--
-- `confiable` es la distinción más importante de todo el archivo. Viene de
-- medir: er-api devuelve el número del BCV pero con la fecha de su propia
-- actualización, no con la fecha valor oficial.
CREATE OR REPLACE FUNCTION public._leer_respuesta_tasa(p_http_id BIGINT, p_fuente TEXT)
RETURNS JSONB
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path TO 'public'
AS $$
DECLARE
    v_body TEXT;
    v_err  TEXT;
    v_json JSONB;
BEGIN
    SELECT content, error_msg INTO v_body, v_err
      FROM net._http_response
     WHERE id = p_http_id;

    IF NOT FOUND THEN
        RETURN jsonb_build_object('servible', false, 'motivo', 'todavía sin respuesta');
    END IF;

    IF v_err IS NOT NULL AND v_err <> '' THEN
        RETURN jsonb_build_object('servible', false, 'motivo', 'la petición falló: ' || v_err);
    END IF;

    IF v_body IS NULL OR v_body = '' THEN
        RETURN jsonb_build_object('servible', false, 'motivo', 'respuesta vacía');
    END IF;

    BEGIN
        v_json := v_body::JSONB;
    EXCEPTION WHEN OTHERS THEN
        RETURN jsonb_build_object('servible', false,
            'motivo', 'la respuesta no es JSON válido: ' || left(v_body, 80));
    END;

    -- ── dolarapi ──
    IF p_fuente = 'dolarapi' THEN
        DECLARE
            v_valor NUMERIC := NULLIF(v_json->>'promedio', '')::NUMERIC;
            v_fecha DATE    := NULLIF(v_json->>'fechaActualizacion', '')::TIMESTAMPTZ::DATE;
        BEGIN
            IF v_valor IS NULL OR v_fecha IS NULL OR v_valor <= 0 THEN
                RETURN jsonb_build_object('servible', false,
                    'motivo', 'faltan promedio o fechaActualizacion');
            END IF;
            RETURN jsonb_build_object(
                'servible', true, 'valor', v_valor, 'fecha_valor', v_fecha,
                'confiable', true);
        END;
    END IF;

    -- ── er-api ──
    -- OJO: `time_last_update_utc` NO es la fecha valor del BCV. Se usa como
    -- referencia aproximada y se marca NO confiable a propósito.
    IF p_fuente = 'er-api' THEN
        DECLARE
            v_valor NUMERIC := NULLIF(v_json->'rates'->>'VES', '')::NUMERIC;
            v_crudo TEXT    := NULLIF(v_json->>'time_last_update_utc', '');
        BEGIN
            IF v_valor IS NULL OR v_valor <= 0 THEN
                RETURN jsonb_build_object('servible', false,
                    'motivo', 'no trajo rates.VES');
            END IF;
            RETURN jsonb_build_object(
                'servible', true, 'valor', v_valor,
                'fecha_valor', COALESCE(v_crudo::TIMESTAMPTZ::DATE, CURRENT_DATE),
                'confiable', false);
        END;
    END IF;

    -- ── currency-api (fawazahmed0) ──
    -- Devuelve cuántos USD vale 1 VES: hay que invertir.
    IF p_fuente = 'currency-api' THEN
        DECLARE
            v_usd   NUMERIC := NULLIF(v_json->'ves'->>'usd', '')::NUMERIC;
            v_fecha DATE    := NULLIF(v_json->>'date', '')::DATE;
        BEGIN
            IF v_usd IS NULL OR v_usd <= 0 THEN
                RETURN jsonb_build_object('servible', false,
                    'motivo', 'no trajo ves.usd');
            END IF;
            RETURN jsonb_build_object(
                'servible', true,
                'valor', ROUND(1 / v_usd, 4),
                'fecha_valor', COALESCE(v_fecha, CURRENT_DATE),
                'confiable', false);
        END;
    END IF;

    RETURN jsonb_build_object('servible', false, 'motivo', 'fuente desconocida');
END;
$$;

-- ============================================================
-- Resolver el eslabón pendiente
-- ============================================================
--
-- Es la función que el cron llama cada pocos minutos. Hace una de tres cosas
-- según lo que encuentre:
--
--   a) No hay nada en curso y no se intentó hoy  -> arranca la cadena
--   b) Hay un intento esperando respuesta       -> la lee
--       b1) sirve  -> registra en tasa_bcv y termina
--       b2) no sirve -> marca fallido y dispara el siguiente eslabón
--   c) La cadena ya terminó hoy                 -> no hace nada
CREATE OR REPLACE FUNCTION public.resolver_captura_tasa()
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $$
DECLARE
    v_ult   RECORD;
    v_lect  JSONB;
    v_res   JSONB;
    v_sig   TEXT;
    v_sig_principal BOOLEAN;
    v_eslabon INTEGER;
    v_cadena TEXT[] := ARRAY['dolarapi','er-api','currency-api'];
BEGIN
    -- ── (a) Arrancar si hoy no se intentó ──
    IF NOT EXISTS (
        SELECT 1 FROM tasa_intento WHERE disparado_en::DATE = CURRENT_DATE
    ) THEN
        RETURN public.capturar_tasa_con_respaldo();
    END IF;

    -- ── (c) Si ya terminó bien hoy, no hacer nada ──
    IF EXISTS (
        SELECT 1 FROM tasa_intento
         WHERE disparado_en::DATE = CURRENT_DATE AND estado = 'ok'
    ) THEN
        RETURN jsonb_build_object('success', true, 'ya_resuelto', true);
    END IF;

    -- ── (b) Tomar el último intento sin resolver ──
    SELECT * INTO v_ult
      FROM tasa_intento
     WHERE disparado_en::DATE = CURRENT_DATE
       AND estado = 'en_curso'
     ORDER BY disparado_en DESC
     LIMIT 1;

    IF v_ult IS NULL THEN
        -- Todos fallaron y no quedan eslabones: se reporta y se deja así.
        RETURN jsonb_build_object(
            'success', false,
            'error', 'La cadena terminó sin ninguna fuente servible hoy',
            'intentos', (SELECT count(*) FROM tasa_intento
                          WHERE disparado_en::DATE = CURRENT_DATE)
        );
    END IF;

    v_lect := public._leer_respuesta_tasa(v_ult.http_id, v_ult.fuente);

    -- ── (b1) Sirve: registrar ──
    IF (v_lect->>'servible')::BOOLEAN THEN
        v_res := public.registrar_tasa_bcv(
            (v_lect->>'valor')::NUMERIC,
            (v_lect->>'fecha_valor')::DATE,
            CASE v_ult.fuente
                WHEN 'currency-api' THEN 'currency-api'
                ELSE v_ult.fuente
            END,
            v_ult.es_principal
        );

        -- Una fuente no principal NO puede producir una captura aplicada.
        -- Su fecha valor es dudosa: queda pendiente y un humano la confirma.
        IF NOT v_ult.es_principal THEN
            UPDATE tasa_bcv
               SET estado = 'pendiente',
                   aplicada_en = NULL,
                   motivo_estado = 'Captura de respaldo (' || v_ult.fuente ||
                       '): la fecha valor no es la del BCV. Confirmar a mano.'
             WHERE id = (v_res->>'id')::BIGINT;
        END IF;

        UPDATE tasa_intento
           SET estado = 'ok',
               detalle = 'valor ' || (v_lect->>'valor') || ' con fecha valor ' ||
                         (v_lect->>'fecha_valor')
         WHERE id = v_ult.id;

        RETURN jsonb_build_object(
            'success', true,
            'fuente', v_ult.fuente,
            'es_principal', v_ult.es_principal,
            'registro', v_res,
            'fecha_valor_confiable', (v_lect->>'confiable')::BOOLEAN
        );
    END IF;

    -- ── (b2) No sirve: marcar y probar el siguiente ──
    UPDATE tasa_intento
       SET estado = 'fallido',
           detalle = v_lect->>'motivo'
     WHERE id = v_ult.id;

    v_eslabon := array_position(v_cadena, v_ult.fuente);

    IF v_eslabon IS NULL OR v_eslabon >= array_length(v_cadena, 1) THEN
        RETURN jsonb_build_object(
            'success', false,
            'error', 'Se agotaron las fuentes',
            'ultimo_fallo', jsonb_build_object(
                'fuente', v_ult.fuente, 'motivo', v_lect->>'motivo')
        );
    END IF;

    v_sig           := v_cadena[v_eslabon + 1];
    v_sig_principal := FALSE;   -- del segundo eslabón en adelante, nunca principal

    RETURN jsonb_build_object(
        'success', true,
        'cayo', v_ult.fuente,
        'motivo_fallo', v_lect->>'motivo',
        'siguiente', v_sig,
        'http_id', public._disparar_fuente_tasa(v_sig, v_sig_principal)
    );
END;
$$;

-- ============================================================
-- Compatibilidad: `solicitar_captura_tasa()` ahora arranca la cadena
-- ============================================================
--
-- La firma se mantiene porque el cron viejo la llama. Lo que cambia es que
-- ahora deja un rastro en `tasa_intento`.
CREATE OR REPLACE FUNCTION public.solicitar_captura_tasa()
RETURNS BIGINT
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $$
DECLARE
    v_r JSONB;
BEGIN
    v_r := public.capturar_tasa_con_respaldo();
    RETURN (v_r->>'http_id')::BIGINT;
END;
$$;

-- ============================================================
-- PARTE 2 — LA VENTANA DEL PRIMER ADMIN O CAJERO DEL DÍA
-- ============================================================
--
-- El pedido del dueño: que el primero que entre (admin o cajero) vea la tasa
-- del BCV y decida, con la opción "Mantener esta tasa: X" a la vista. Y que
-- cuando uno confirma, se cierre en las demás computadoras.
--
-- POR QUÉ UNA TABLA APARTE Y NO COLUMNAS EN `config`
--
-- `admin-realtime.js` muestra un toast en CADA UPDATE de `config`. Si la
-- confirmación escribiera ahí, el cajero vería "Tasa actualizada desde
-- cajero" sin que nadie haya cambiado nada, y se le va a enseñar a
-- desconfiar de ese aviso.
--
-- Además esto es un registro de decisiones, no una configuración: merece su
-- propia tabla con historial real.
CREATE TABLE IF NOT EXISTS tasa_revision_diaria (
    dia             DATE PRIMARY KEY,
    -- Quién fue el primero del día en decidir
    revisada_por    TEXT,
    -- 'mantener'     -> se dejó la que ya estaba
    -- 'aplicar_bcv'  -> se aplicó la del BCV
    -- 'aplicar_otra' -> se puso un número a mano
    -- 'sin_captura'  -> no había tasa del BCV y no se hizo nada
    accion          TEXT,
    tasa_aplicada   NUMERIC(14,4),
    tasa_bcv        NUMERIC(14,4),
    fecha_valor_bcv DATE,
    nota            TEXT,
    revisada_en     TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    CONSTRAINT tasa_revision_accion_valida
        CHECK (accion IN ('mantener','aplicar_bcv','aplicar_otra','sin_captura'))
);

COMMENT ON TABLE tasa_revision_diaria IS
    'Una fila por día: quién fue el primero en decidir sobre la tasa y qué decidió. Es el registro que responde "por qué ese día se cobró con esa tasa".';

-- ============================================================
-- ¿Hay algo que revisar hoy?
-- ============================================================
CREATE OR REPLACE FUNCTION public.estado_revision_tasa()
RETURNS JSONB
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path TO 'public'
AS $$
DECLARE
    v_rev   RECORD;
    v_bcv   JSONB;
    v_base  NUMERIC;
    v_dif   NUMERIC;
BEGIN
    SELECT * INTO v_rev FROM tasa_revision_diaria WHERE dia = CURRENT_DATE;
    v_bcv := public.tasa_bcv_vigente_json();
    SELECT tasa_cambio INTO v_base FROM config WHERE id = 1;

    RETURN jsonb_build_object(
        'ya_revisada',   v_rev.dia IS NOT NULL,
        'revisada_por',  v_rev.revisada_por,
        'accion',        v_rev.accion,
        'revisada_en',   v_rev.revisada_en,
        -- Se pide la ventana solo si hay algo que decidir: una tasa del BCV
        -- capturada. Sin captura no hay nada que mostrar y sería ruido.
        'necesita_revision', (v_rev.dia IS NULL AND v_bcv IS NOT NULL),
        'bcv',     v_bcv,
        'aplicada', v_base,
        'diferencia_bolivares', CASE
            WHEN v_bcv IS NOT NULL AND COALESCE(v_base, 0) > 0
            THEN ROUND(((v_bcv->>'valor')::NUMERIC - v_base)::NUMERIC, 4)
            ELSE NULL END,
        'diferencia_porcentaje', CASE
            WHEN v_bcv IS NOT NULL AND COALESCE(v_base, 0) > 0
            THEN ROUND((((v_bcv->>'valor')::NUMERIC - v_base) / v_base * 100)::NUMERIC, 4)
            ELSE NULL END
    );
END;
$$;

-- ============================================================
-- Confirmar la decisión del día
-- ============================================================
CREATE OR REPLACE FUNCTION public.confirmar_revision_tasa(
    p_accion  TEXT,
    p_nota    TEXT DEFAULT NULL
)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $$
DECLARE
    v_bcv    JSONB;
    v_base   NUMERIC;
    v_quien  TEXT;
BEGIN
    PERFORM public.exigir_cajero_o_admin();

    IF p_accion IS NULL OR p_accion NOT IN ('mantener','aplicar_bcv','aplicar_otra','sin_captura') THEN
        RETURN jsonb_build_object('success', false,
            'error', 'Acción inválida: usá mantener, aplicar_bcv, aplicar_otra o sin_captura');
    END IF;

    v_bcv  := public.tasa_bcv_vigente_json();
    SELECT tasa_cambio INTO v_base FROM config WHERE id = 1;

    -- Quién confirmó: el nombre del usuario logueado, si se puede resolver.
    SELECT u.nombre INTO v_quien
      FROM auth.users a
      JOIN usuarios u ON u.id::TEXT = a.raw_user_meta_data->>'custom_user_id'
     WHERE a.id = auth.uid()
     LIMIT 1;

    INSERT INTO tasa_revision_diaria
        (dia, revisada_por, accion, tasa_aplicada, tasa_bcv, fecha_valor_bcv, nota)
    VALUES (
        CURRENT_DATE,
        COALESCE(v_quien, 'usuario ' || COALESCE(public.rol_actual(), 'desconocido')),
        p_accion,
        v_base,
        (v_bcv->>'valor')::NUMERIC,
        (v_bcv->>'fecha_valor')::DATE,
        p_nota
    )
    ON CONFLICT (dia) DO UPDATE
        SET revisada_por    = EXCLUDED.revisada_por,
            accion          = EXCLUDED.accion,
            tasa_aplicada   = EXCLUDED.tasa_aplicada,
            tasa_bcv        = EXCLUDED.tasa_bcv,
            fecha_valor_bcv = EXCLUDED.fecha_valor_bcv,
            nota            = EXCLUDED.nota,
            revisada_en     = NOW();

    RETURN jsonb_build_object(
        'success', true,
        'dia', CURRENT_DATE,
        'accion', p_accion,
        'revisada_por', COALESCE(v_quien, 'desconocido'),
        'tasa_aplicada', v_base,
        'tasa_bcv', (v_bcv->>'valor')::NUMERIC
    );
END;
$$;

-- ============================================================
-- PARTE 3 — MOSTRAR LAS CAPTURAS DE RESPALDO QUE ESPERAN CONFIRMACIÓN
-- ============================================================
--
-- Una captura de respaldo entra como 'pendiente'. Si su fecha valor ya pasó,
-- no aparece ni como vigente (esa filtra estado 'aplicada') ni como próxima
-- (esa filtra fecha futura). Quedaría invisible.
--
-- Esta función la saca a la luz, porque "hay una tasa esperando que alguien
-- la confirme" es información que el admin necesita.
CREATE OR REPLACE FUNCTION public.tasas_por_confirmar_json()
RETURNS JSONB
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path TO 'public'
AS $$
    SELECT COALESCE(jsonb_agg(fila ORDER BY fila->>'capturada_en' DESC), '[]'::JSONB)
      FROM (
        SELECT jsonb_build_object(
                   'id',           t.id,
                   'valor',        t.valor,
                   'fecha_valor',  t.fecha_valor,
                   'fuente',       t.fuente,
                   'motivo_estado',t.motivo_estado,
                   'capturada_en', t.capturada_en
               ) AS fila
          FROM tasa_bcv t
         WHERE t.estado = 'pendiente'
           AND t.fecha_valor <= CURRENT_DATE
         ORDER BY t.capturada_en DESC
         LIMIT 5
      ) s;
$$;

-- ============================================================
-- `tasa_panel()` gana dos bloques
-- ============================================================
CREATE OR REPLACE FUNCTION public.tasa_panel()
RETURNS JSONB
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path TO 'public'
AS $$
DECLARE
    v_bcv          JSONB;
    v_proxima      JSONB;
    v_cfg          RECORD;
    v_base         NUMERIC;
    v_dif_bs       NUMERIC;
    v_dif_pct      NUMERIC;
    v_signo        TEXT;
    v_es_igual     BOOLEAN := FALSE;
    v_capturas     JSONB;
    v_por_confirmar JSONB;
    v_ultimo_intento RECORD;
    v_cadena       JSONB;
    v_umbral       NUMERIC := 0.5;
BEGIN
    v_bcv     := public.tasa_bcv_vigente_json();
    v_proxima := public.tasa_bcv_proxima_json();

    SELECT tasa_cambio, tasa_efectiva, aumento_acumulado, ultima_actualizacion
      INTO v_cfg
      FROM config
     WHERE id = 1;

    v_base := COALESCE(v_cfg.tasa_cambio, 0);

    IF v_bcv IS NOT NULL AND v_base > 0 THEN
        v_dif_bs  := (v_bcv->>'valor')::NUMERIC - v_base;
        v_dif_pct := ROUND(((v_dif_bs) / v_base * 100)::NUMERIC, 4);
        v_es_igual := ABS(v_dif_bs) < 0.01;
        v_signo   := CASE WHEN v_es_igual THEN 'igual'
                          WHEN v_dif_bs > 0 THEN 'falta'
                          WHEN v_dif_bs < 0 THEN 'sobra'
                          ELSE 'igual' END;
    END IF;

    SELECT COALESCE(jsonb_agg(fila ORDER BY fila->>'fecha_valor' DESC, fila->>'capturada_en' DESC), '[]'::JSONB)
      INTO v_capturas
      FROM (
        SELECT jsonb_build_object(
                   'id',           t.id,
                   'fecha_valor',  t.fecha_valor,
                   'valor',        t.valor,
                   'fuente',       t.fuente,
                   'es_principal', t.es_principal,
                   'estado',       t.estado,
                   'motivo_estado',t.motivo_estado,
                   'capturada_en', t.capturada_en,
                   'aplicada_en',  t.aplicada_en,
                   'fue_adelanto', (t.aplicada_en IS NOT NULL
                                    AND t.aplicada_en::DATE < t.fecha_valor)
               ) AS fila
          FROM tasa_bcv t
         ORDER BY t.fecha_valor DESC, t.capturada_en DESC
         LIMIT 10
      ) s;

    v_por_confirmar := public.tasas_por_confirmar_json();

    -- La cadena de hoy, para que el admin vea si el respaldo se usó y por qué.
    SELECT * INTO v_ultimo_intento
      FROM tasa_intento
     WHERE disparado_en::DATE = CURRENT_DATE
     ORDER BY disparado_en DESC
     LIMIT 1;

    SELECT COALESCE(jsonb_agg(jsonb_build_object(
               'fuente',   i.fuente,
               'estado',   i.estado,
               'detalle',  i.detalle,
               'hora',     to_char(i.disparado_en AT TIME ZONE 'America/Caracas', 'HH24:MI')
           ) ORDER BY i.disparado_en), '[]'::JSONB)
      INTO v_cadena
      FROM tasa_intento i
     WHERE i.disparado_en::DATE = CURRENT_DATE;

    RETURN jsonb_build_object(
        'hoy', CURRENT_DATE,
        'bcv', v_bcv,
        'proxima', v_proxima,
        'aplicada', jsonb_build_object(
            'tasa_cambio',         v_base,
            'tasa_efectiva',       v_cfg.tasa_efectiva,
            'aumento_acumulado',   v_cfg.aumento_acumulado,
            'ultima_actualizacion',v_cfg.ultima_actualizacion
        ),
        'diferencia', jsonb_build_object(
            'bolivares',          ROUND(COALESCE(v_dif_bs, 0)::NUMERIC, 4),
            'porcentaje',         COALESCE(v_dif_pct, 0),
            'signo',              COALESCE(v_signo, 'igual'),
            'es_igual',           v_es_igual,
            'umbral_porcentaje',  v_umbral,
            'requiere_revision',  COALESCE(ABS(v_dif_pct) >= v_umbral, false),
            'por_100_usd',        ROUND(COALESCE(v_dif_bs, 0) * 100, 2)
        ),
        'capturas',      v_capturas,
        'por_confirmar', v_por_confirmar,
        'cadena_hoy',    v_cadena,
        'revision',      public.estado_revision_tasa()
    );
END;
$$;

COMMENT ON FUNCTION public.tasa_panel() IS
    'Cuadro completo de la tasa para el panel del admin: la del BCV con fecha valor y origen, la próxima capturada, la que el sistema cobra, la diferencia medida, las últimas 10 capturas, las de respaldo esperando confirmación, la cadena de fuentes de hoy y el estado de la ventana diaria.';

-- ============================================================
-- Permisos
-- ============================================================
GRANT EXECUTE ON FUNCTION public.estado_revision_tasa()          TO authenticated;
GRANT EXECUTE ON FUNCTION public.confirmar_revision_tasa(TEXT, TEXT) TO authenticated;
GRANT EXECUTE ON FUNCTION public.tasas_por_confirmar_json()      TO authenticated;
GRANT EXECUTE ON FUNCTION public.resolver_captura_tasa()         TO authenticated;
GRANT EXECUTE ON FUNCTION public.capturar_tasa_con_respaldo()    TO authenticated;

REVOKE ALL ON FUNCTION public._disparar_fuente_tasa(TEXT, BOOLEAN)  FROM PUBLIC;
REVOKE ALL ON FUNCTION public._leer_respuesta_tasa(BIGINT, TEXT)    FROM PUBLIC;

-- La tabla de revisiones no se expone por PostgREST: se lee por la función.
-- Si se expusiera, cualquier anónimo vería quién decidió qué.
REVOKE ALL ON TABLE public.tasa_revision_diaria FROM PUBLIC, anon;
REVOKE ALL ON TABLE public.tasa_intento          FROM PUBLIC, anon;
ALTER TABLE public.tasa_revision_diaria ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.tasa_intento          ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS tasa_revision_lectura ON public.tasa_revision_diaria;
CREATE POLICY tasa_revision_lectura ON public.tasa_revision_diaria
    FOR SELECT TO authenticated
    USING (COALESCE(public.es_cajero_o_admin(), false));

-- ============================================================
-- Cron: procesar la respuesta y avanzar la cadena
-- ============================================================
--
-- Cada 3 minutos entre las 21:00 y las 21:30 UTC (5pm a 5:30pm de Venezuela).
-- Esa ventana alcanza para los tres eslabones: 21:00 dolarapi, 21:03 se lee,
-- 21:06 er-api si falló, y así.
--
-- El de las 11 UTC (7am) sigue aplicando las capturas que llegaron a su fecha.
SELECT cron.unschedule(jobid) FROM cron.job
 WHERE jobname IN ('tasa-bcv-capturar','tasa-bcv-procesar');

-- Se retira el cron viejo que solo disparaba sin procesar: lo reemplaza el
-- resolvedor, que hace las dos cosas.
SELECT cron.schedule('tasa-bcv-procesar', '*/3 21 * * 1-5', $$
    SELECT public.resolver_captura_tasa();
$$);

COMMENT ON TABLE tasa_intento IS
    'Cada disparo de la cadena de fuentes de la tasa. Sin esto no se sabe en qué eslabón va ni por qué falló.';

NOTIFY pgrst, 'reload schema';

COMMIT;

-- ============================================================
-- Realtime para la ventana diaria
-- ============================================================
--
-- Sin esto, cuando un admin confirma la tasa, las OTROS equipos no se
-- enteran: el toast aparecería recién al recargar. `config` ya está en la
-- publicación (lo usa el aviso del cajero). `tasa_revision_diaria` se agrega
-- para que la ventana se cierre sola en las demás computadoras.
--
-- Se hace fuera del BEGIN grande porque ALTER PUBLICATION no es idempotente
-- y queremos poder correrlo solo si hace falta.
DO $$
BEGIN
    IF NOT EXISTS (
        SELECT 1 FROM pg_publication_tables
         WHERE pubname = 'supabase_realtime'
           AND tablename = 'tasa_revision_diaria'
    ) THEN
        ALTER PUBLICATION supabase_realtime ADD TABLE tasa_revision_diaria;
    END IF;
END $$;

-- ============================================================
-- GRANT de SELECT para Realtime (faltaba y rompía la réplica)
-- ============================================================
--
-- Realtime de Supabase evalúa la RLS al emitir eventos: para que un cliente
-- reciba un cambio necesita, además de una policy de SELECT, el PRIVILEGIO de
-- tabla. Sin el GRANT, la policía existe pero la puerta está con llave: el
-- canal se suscribe, dice "joined", y no llega nunca un evento.
--
-- Medido: con la ventana abierta en el Cajero, un INSERT desde el admin no
-- cerraba nada. `has_table_privilege('authenticated','tasa_revision_diaria',
-- 'SELECT')` devolvía false.
--
-- Queda protegido por la POLICY `tasa_revision_lectura`, que exige
-- cajero o admin. El GRANT solo permite intentarlo; la policy decide qué filas.
GRANT SELECT ON TABLE public.tasa_revision_diaria TO authenticated;
GRANT SELECT ON TABLE public.tasa_intento          TO authenticated;

DROP POLICY IF EXISTS tasa_intento_lectura ON public.tasa_intento;
CREATE POLICY tasa_intento_lectura ON public.tasa_intento
    FOR SELECT TO authenticated
    USING (COALESCE(public.es_cajero_o_admin(), false));

-- ============================================================
-- NOTA IMPORTANTE — Realtime necesita el JWT del lado del CLIENTE
-- ============================================================
--
-- Agregar la tabla a la publicación y dar el GRANT NO alcanza. El websocket
-- de Supabase Realtime se autentica por su cuenta y NO usa el header
-- `Authorization` de `global.headers` (ese header viaja solo en las consultas
-- REST).
--
-- Como `supabase-config.js` crea el cliente con `persistSession: false`, no
-- hay sesión de GoTrue de dónde sacar el token, y Realtime cae siempre al rol
-- `anon`. El síntoma engaña de lo lindo: el canal responde `joined`, el
-- servidor registra la suscripción, y NO llega nunca un evento.
--
-- Verificado en realtime.subscription: todas las suscripciones del admin
-- figuraban con `claims_role = 'anon'` aunque el usuario estuviera logueado.
--
-- La solución es del lado del navegador: la opción `accessToken` de
-- supabase-js v2, que Realtime consulta antes de abrir el websocket:
--
--     accessToken: jwtToken ? async () => jwtToken : undefined
--
-- Con eso, `await cliente.realtime.accessToken()` pasa de 46 caracteres (la
-- publishable key) a 960 (el JWT), y la base registra
-- `claims_role = 'authenticated'`.
--
-- CONSECUENCIA PARA EL FUTURO: cualquier policy de RLS que exija un rol es
-- inalcanzable para Realtime hasta que el cliente mande el JWT. Si una tabla
-- nueva "no replica" y el canal dice `joined`, revisar primero esto:
--
--     select entity::regclass, claims_role from realtime.subscription;
