-- ============================================================
-- 36 — Capturar de noche, después de que er-api publique la del día siguiente
-- ============================================================
--
-- QUÉ PROBLEMA RESUELVE
--
-- El cron de captura corría a las 17:00 hora Venezuela (21:00 UTC), cada 3
-- minutos, de lunes a viernes. Pero la fuente que adelanta la fecha valor
-- publica MUCHO después: er-api publica entre las 20:02 y las 20:26 hora
-- Venezuela. A las 5 de la tarde todavía no hay nada que capturar.
--
-- Consecuencia medida el 30/10/2026: a las 11:51 de la mañana `config`
-- seguía con la tasa del 29 aunque la del 30 estaba publicada desde la noche
-- anterior. El cron de las 7 am no tenía nada nuevo que aplicar porque nadie
-- había capturado después de las 5 de la tarde. El sistema se quedaba un día
-- atrás, todos los días.
--
-- LA REGLA DEL DUEÑO
--
-- "El horario más seguro de captura es el de la última fuente que la publica,
-- más 10 minutos, en el día anterior."
--
-- Aplicada con la evidencia: la última fuente que publica es currency-api,
-- pero da 887.7277 contra 889.2553 del BCV — 1.53 Bs abajo. Esperar a la
-- última sería esperar a la que miente. Así que la regla se aplica sobre la
-- última de las fuentes CONFIABLES, que es er-api (20:02–20:26 VE), más un
-- margen amplio: 22:40 hora Venezuela = 02:40 UTC.
--
--   margen sobre la publicación más tardía medida (20:26) = 2 h 14 min
--   sigue siendo el día anterior, así que la fecha valor futura se conoce
--     con horas de sobra y el cron de las 7 am del día siguiente la aplica
--
-- POR QUÉ UN SOLO DISPARO
--
-- Antes corría cada 3 minutos durante 57 minutos intentando por la cadena de
-- respaldos. A las 22:40 no hace falta: la publicación ya ocurrió. Un solo
-- disparo alcanza, y se evita martillar tres APIs 19 veces por noche.
-- ============================================================

BEGIN;

-- ── 1. Reemplazar el cron de captura ──
--
-- `solicitar_captura_tasa` dispara la cadena con respaldos. Es la que
-- conviene: si er-api falla, prueba la siguiente sin intervención.
SELECT cron.unschedule('tasa-bcv-procesar')
 WHERE EXISTS (SELECT 1 FROM cron.job WHERE jobname = 'tasa-bcv-procesar');

SELECT cron.schedule(
    'tasa-bcv-procesar',
    '40 2 * * 1-5',   -- 02:40 UTC = 22:40 hora Venezuela, día anterior
    $$ SELECT public.resolver_captura_tasa(); $$
);

-- ── 2. er-api primero: es la que adelanta y la que coincide con el BCV ──
--
-- La cadena arrancaba por dolarapi, que devuelve la tasa que YA RIGE y
-- etiqueta la fecha a medianoche del día en que rige. Leerla primero hace
-- que el sistema se salte el día anterior y nunca vea la publicación
-- adelantada. er-api trae el valor del día siguiente con su fecha valor
-- calculada desde la hora de publicación.
--
-- OJO: el orden vive en DOS lugares. `capturar_tasa_con_respaldo` arranca la
-- cadena y `resolver_captura_tasa` la retoma cuando un eslabón cae, cada uno
-- con su propio ARRAY. Cambiar solo uno deja un sistema incoherente: el
-- primero pide er-api y el segundo salta a dolarapi en el reintento. Por eso
-- se reescriben los dos.
CREATE OR REPLACE FUNCTION public.capturar_tasa_con_respaldo()
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $function$
DECLARE
    v_req BIGINT;
BEGIN
    -- er-api primero: publica la tasa del día siguiente entre las 20:02 y
    -- las 20:26 hora Venezuela, y sus valores coinciden con el BCV.
    v_req := public._disparar_fuente_tasa('er-api', TRUE);

    RETURN jsonb_build_object(
        'fuente', 'er-api',
        'eslabon', 1,
        'http_id', v_req,
        'success', TRUE
    );
END;
$function$;

COMMENT ON FUNCTION public.capturar_tasa_con_respaldo() IS
    'Arranca la cadena por er-api, que publica la tasa con fecha valor del '
    'día siguiente. dolarapi y currency-api quedan como respaldo.';

-- ── 3. Mismo orden en el reintento ──
--
-- Se reescribe `resolver_captura_tasa` SOLO para cambiar el ARRAY de la
-- cadena. El resto de la lógica queda idéntico, copiado de la versión viva.
CREATE OR REPLACE FUNCTION public.resolver_captura_tasa()
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $function$
DECLARE
    v_ult   RECORD;
    v_lect  JSONB;
    v_res   JSONB;
    v_sig   TEXT;
    v_sig_principal BOOLEAN;
    v_eslabon INTEGER;
    v_cadena TEXT[] := ARRAY['er-api','dolarapi','currency-api'];
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
        RETURN jsonb_build_object(
            'success', false,
            'error', 'La cadena terminó sin ninguna fuente servible hoy',
            'intentos', (SELECT count(*) FROM tasa_intento
                          WHERE disparado_en::DATE = CURRENT_DATE)
        );
    END IF;

    -- ── (b1) Leer la respuesta del último disparo ──
    v_lect := public._leer_respuesta_tasa(v_ult.http_id, v_ult.fuente);

    IF (v_lect->>'servible')::BOOLEAN THEN
        v_res := public.procesar_respuesta_tasa(v_ult.http_id);
        RETURN jsonb_build_object(
            'success', true,
            'eslabon', array_position(v_cadena, v_ult.fuente),
            'fuente', v_ult.fuente,
            'resultado', v_res
        );
    END IF;

    -- ── (b2) No sirve: marcar y probar el siguiente ──
    UPDATE tasa_intento
       SET estado = 'cayo',
           detalle = COALESCE(v_lect->>'motivo', 'no servible')
     WHERE id = v_ult.id;

    v_eslabon := array_position(v_cadena, v_ult.fuente);

    IF v_eslabon IS NULL OR v_eslabon >= array_length(v_cadena, 1) THEN
        RETURN jsonb_build_object(
            'success', false,
            'error', 'Se agotaron las fuentes',
            'fuente', v_ult.fuente,
            'motivo', v_lect->>'motivo'
        );
    END IF;

    v_sig           := v_cadena[v_eslabon + 1];
    v_sig_principal := (v_sig = 'er-api');

    RETURN jsonb_build_object(
        'success', true,
        'cayo', v_ult.fuente,
        'siguiente', v_sig,
        'http_id', public._disparar_fuente_tasa(v_sig, v_sig_principal)
    );
END;
$function$;

NOTIFY pgrst, 'reload schema';

COMMIT;
