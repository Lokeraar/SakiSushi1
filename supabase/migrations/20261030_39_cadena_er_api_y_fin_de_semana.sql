-- ============================================================
-- 39 — La captura volvía a fallar, y la fecha valor caía en sábado
-- ============================================================
--
-- QUÉ PROBLEMA RESUELVE (son dos, encadenados)
--
-- 1. LA CADENA ROTA
--
--    La migración 36 reescribió `capturar_tasa_con_respaldo` y
--    `resolver_captura_tasa`, y la segunda quedó llamando a
--    `procesar_respuesta_tasa`. Esa función solo entiende el formato de
--    dolarapi (`promedio` y `fechaActualizacion`). Cuando la cadena arranca
--    por er-api —como la 36 misma ordena— la respuesta no tiene esos campos y
--    devuelve "Faltan datos en la respuesta".
--
--    La versión correcta de `resolver_captura_tasa` es la de la migración 24:
--    lee con `_leer_respuesta_tasa`, que sí entiende las tres fuentes, y
--    registra con `registrar_tasa_bcv`, que recibe valor y fecha ya
--    normalizados. Se restaura esa, sin tocar el resto de la 36.
--
--    Medido el viernes 30/10 a las 22:27 VE: er-api devolvía 889,5754 —igual
--    al BCV— y la cadena lo descartaba. `tasa_intento` quedaba en 'en_curso'
--    y la tasa del lunes nunca entraba.
--
-- 2. LA FECHA VALOR CAÍA EN SÁBADO
--
--    La 35 calcula la fecha valor como `publicación + 1 día`. Funciona de
--    domingo a jueves. Un viernes da sábado, que no es día de publicación:
--    el BCV publica el viernes para el LUNES.
--
--    La regla del dueño: "el BCV publica también los viernes por la noche para
--    el lunes. Únicamente no publica sábados, domingo, lunes bancarios y días
--    feriados."
--
--    Con `publicación + 1` un viernes 30/10 daba fecha valor sábado 31/10, que
--    nunca rige, así que la captura quedaba invisible para siempre. Ahora se
--    salta el fin de semana: la del viernes 30/10 pasa a regir el lunes 02/11.
--
--    Los lunes bancarios y feriados siguen sin resolverse acá, y es correcto:
--    no hay dato publicable para saberlo. Si el lunes no hay publicación, la
--    vigente sigue siendo la del viernes anterior, que es exactamente lo que
--    hay que cobrar.
--
-- IDEMPOTENTE.
-- ============================================================

BEGIN;

-- ── 1. Restaurar el resolver que entiende las tres fuentes ──
CREATE OR REPLACE FUNCTION public.resolver_captura_tasa()
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $$
DECLARE
    v_cadena    TEXT[] := ARRAY['er-api', 'dolarapi', 'currency-api'];
    v_ult       RECORD;
    v_lect      JSONB;
    v_res       JSONB;
    v_eslabon   INT;
    v_sig       TEXT;
    v_sig_principal BOOLEAN;
BEGIN
    -- ── (a) Si no hay nada en curso, disparar el primero ──
    IF NOT EXISTS (
        SELECT 1 FROM tasa_intento
         WHERE disparado_en::DATE = CURRENT_DATE AND estado = 'en_curso'
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

    v_lect := public._leer_respuesta_tasa(v_ult.http_id, v_ult.fuente);

    -- ── (b1) Sirve: registrar con la fecha valor ya normalizada ──
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
            'eslabon', array_position(v_cadena, v_ult.fuente),
            'fuente', v_ult.fuente,
            'registro', v_res,
            'fecha_valor_confiable', (v_lect->>'confiable')::BOOLEAN
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
$$;

-- ── 2. La fecha valor de er-api salta el fin de semana ──
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

            v_pub := COALESCE(v_crudo::TIMESTAMPTZ::DATE, CURRENT_DATE);

            -- La publicación del día D rige el día siguiente hábil.
            --
            -- De domingo a jueves eso es D+1. Un viernes rige el lunes: el BCV
            -- no publica el fin de semana, y un +1 daría sábado, una fecha que
            -- nunca llega a regir y deja la captura invisible para siempre.
            v_fecha := CASE EXTRACT(ISODOW FROM v_pub)
                            WHEN 5 THEN v_pub + 3   -- viernes -> lunes
                            WHEN 6 THEN v_pub + 2   -- sábado  -> lunes
                            WHEN 7 THEN v_pub + 1   -- domingo -> lunes
                            ELSE v_pub + 1
                       END;

            RETURN jsonb_build_object(
                'servible', true, 'valor', v_valor,
                'fecha_valor', v_fecha,
                'publicada_en', v_pub,
                'confiable', true,
                'adelantada', (v_fecha > CURRENT_DATE));
        END;
    END IF;

    IF p_fuente = 'currency-api' THEN
        DECLARE
            v_inv  NUMERIC := NULLIF(v_json->'ves'->>'usd', '')::NUMERIC;
            v_fecha DATE   := NULLIF(v_json->>'date', '')::DATE;
        BEGIN
            IF v_inv IS NULL OR v_inv <= 0 THEN
                RETURN jsonb_build_object('servible', false,
                    'motivo', 'no trajo ves.usd');
            END IF;
            RETURN jsonb_build_object(
                'servible', true,
                'valor', ROUND(1 / v_inv, 4),
                'fecha_valor', v_fecha,
                'confiable', true);
        END;
    END IF;

    RETURN jsonb_build_object('servible', false, 'motivo', 'fuente desconocida');
END;
$function$;

COMMIT;
