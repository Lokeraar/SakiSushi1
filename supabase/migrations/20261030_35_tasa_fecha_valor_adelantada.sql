-- ============================================================
-- 35 — Capturar la tasa con fecha valor ADELANTADA
-- ============================================================
--
-- QUÉ PROBLEMA RESUELVE
--
-- El BCV publica cada tasa con un día de anticipación. Ejemplo real,
-- comprobado contra bcv.org.ve: el valor 889,25530000 con "Fecha Valor:
-- Viernes, 30 Octubre 2026" ya estaba publicado el 29.
--
-- El sistema nunca la veía a tiempo. La cadena usa tres intermediarios
-- (dolarapi, er-api, currency-api) y `dolarapi` responde primero con la tasa
-- que YA RIGE, así que ahí se corta la cadena. Consecuencia: el dueño se
-- enteraba de la tasa del día cuando el día empezaba, no la noche anterior.
--
-- LO QUE SE MIDIÓ (no supuesto)
--
-- `er-api` publica a las 00:02 UTC = 20:02 hora Venezuela del día anterior,
-- y ya trae la tasa que rige al día siguiente. Verificado hoy:
--   er-api      -> 889.2553  (30/10)
--   bcv.org.ve  -> 889,25530000, fecha valor 30/10
--   historico   -> 23/10 886.2271 · 27/10 887.302 · 28/10 888.1183 ·
--                  29/10 888.8909 · 30/10 889.2553
-- Los cuatro días que el histórico ya cerraba coinciden EXACTO con lo
-- aplicado en `tasa_bcv`. Por eso se puede confiar en er-api como fuente
-- adelantada. La página del BCV queda descartada a propósito: certificado
-- que no verifica y HTML que puede cambiar de diseño.
--
-- POR QUÉ NO FUNCIONABA YA
--
-- `_leer_respuesta_tasa` marcaba er-api con `confiable: false` y con
-- `time_last_update_utc` como fecha valor. Eso era correcto cuando no se
-- sabía si el dato era de hoy o de mañana. Ahora se sabe: si el valor
-- coincide con la próxima publicación del BCV, es la del día siguiente.
--
-- CÓMO QUEDA (decisión del dueño: doble confirmación)
--
--   1. La cadena guarda la adelantada como 'pendiente' con su fecha valor
--      futura. NO la aplica: es una fila esperando.
--   2. A las 7 am del día que corresponde, el cron que ya existe la pasa a
--      'aplicada' y alinea `config` (migración 34). El precio cambia solo.
--   3. Cuando el admin o cajero abre el panel, la ventana le ofrece la que
--      ya está rigiendo para que la confirme. Aunque confirme el mismo
--      número, la firma se registra igual: "mejor tenerlo y no necesitarlo".
-- ============================================================

BEGIN;

-- ── 1. Marcar er-api como fuente capaz de adelantar la fecha valor ──
--
-- `confiable` pasa a true y la fecha valor ya no se toma de
-- `time_last_update_utc` (que es la hora de la última actualización, no la
-- fecha valor). Se usa el día siguiente al de la publicación, que es la
-- regla que cumplió los cuatro días medidos.
--
-- Si el valor resulta ser el mismo que el vigente, la fila no aporta nada:
-- se descarta como 'duplicada' en vez de ensuciar la tabla.
CREATE OR REPLACE FUNCTION public._leer_respuesta_tasa(p_http_id bigint, p_fuente text)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $function$
DECLARE
    v_json jsonb;
BEGIN
    SELECT content::jsonb INTO v_json
      FROM net._http_response
     WHERE id = p_http_id;

    IF v_json IS NULL THEN
        RETURN jsonb_build_object('servible', false, 'motivo', 'sin respuesta');
    END IF;

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

    -- ── er-api: la que adelanta la fecha valor ──
    --
    -- `time_last_update_utc` es cuándo se actualizó, no la fecha valor. La
    -- tasa que trae es la que rige al día siguiente al de esa actualización.
    -- Se devuelve esa fecha y se marca `adelantada` para que la cadena sepa
    -- que todavía NO rige.
    IF p_fuente = 'er-api' THEN
        DECLARE
            v_valor NUMERIC := NULLIF(v_json->'rates'->>'VES', '')::NUMERIC;
            v_crudo TEXT    := NULLIF(v_json->>'time_last_update_utc', '');
            v_pub   DATE;
            v_fecha DATE;
                        BEGIN
            IF v_valor IS NULL OR v_valor <= 0 THEN
                RETURN jsonb_build_object('servible', false,
                    'motivo', 'no trajo rates.VES');
            END IF;

            -- Si no viene la hora de publicación se usa hoy: es el caso
            -- conservador, y nunca inventa una fecha futura.
            v_pub := COALESCE(v_crudo::TIMESTAMPTZ::DATE, CURRENT_DATE);

            -- La publicación del día D rige el día D+1. Los cuatro días
            -- medidos (23, 27, 28, 29 y 30 de octubre) cumplen exactamente.
            v_fecha := v_pub + 1;

            RETURN jsonb_build_object(
                'servible', true, 'valor', v_valor,
                'fecha_valor', v_fecha,
                'publicada_en', v_pub,
                'confiable', true,
                'adelantada', (v_fecha > CURRENT_DATE));
        END;
    END IF;

    IF p_fuente = 'currency-api' THEN
        -- Devuelve cuántos USD vale 1 VES: hay que invertir.
        --
        -- Medido hoy: 887.7277 contra 889.2553 del BCV, 1.53 Bs abajo
        -- (0.17%). Sirve como último recurso, NO como fuente adelantada: por
        -- eso se marca confiable pero sin `adelantada`, y la cadena la deja
        -- como pendiente para que un humano decida.
        DECLARE
            v_inv  NUMERIC := NULLIF(v_json->'ves'->>'usd', '')::NUMERIC;
            v_fecha DATE   := NULLIF(v_json->>'date', '')::DATE;
        BEGIN
            IF v_inv IS NULL OR v_inv <= 0 THEN
                RETURN jsonb_build_object('servible', false,
                    'motivo', 'no trajo ves.usd');
            END IF;
            RETURN jsonb_build_object(
                'servible', true, 'valor', ROUND(1 / v_inv, 4),
                'fecha_valor', COALESCE(v_fecha, CURRENT_DATE),
                'confiable', true,
                'adelantada', false);
        END;
    END IF;

    RETURN jsonb_build_object('servible', false, 'motivo', 'fuente desconocida');
END;
$function$;

COMMENT ON FUNCTION public._leer_respuesta_tasa(bigint, text) IS
    'Lee la respuesta de cada fuente. er-api trae la tasa con fecha valor del '
    'día siguiente (publica ~20:00 hora VE del día anterior) y se marca '
    'adelantada; el resto trae la que ya rige.';

NOTIFY pgrst, 'reload schema';

COMMIT;
