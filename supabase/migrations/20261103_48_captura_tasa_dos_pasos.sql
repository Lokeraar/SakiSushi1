-- ============================================================
-- 48 — La captura de la tasa nunca terminaba: el cron hacía un solo disparo
-- ============================================================
--
-- QUÉ PROBLEMA RESUELVE
--
-- El panel ofrecía el martes 03/11 la tasa del LUNES 02/11 (889,58) cuando el
-- BCV ya había publicado la del martes (891,1054) y la del miércoles. Dos días
-- sin capturar.
--
-- La cadena de captura tiene DOS pasos y el cron la llamaba UNA vez al día:
--
--   1. `_disparar_fuente_tasa()` encola un `net.http_get` y devuelve un id.
--   2. `resolver_captura_tasa()` lee esa respuesta en una llamada POSTERIOR.
--
-- La migración 38 dejó el cron en un único disparo diario (02:40 UTC) con el
-- razonamiento "a esa hora la publicación ya ocurrió, un solo disparo alcanza".
-- Es cierto para no martillar las APIs, pero se olvidó de que la respuesta hay
-- que leerla: cada noche disparaba la consulta y se iba sin leerla.
--
-- Evidencia medida el 03/11/2026 a las 18:37 VE: `tasa_intento` tenía las
-- filas 30 (01/11) y 31 (02/11) en `en_curso` —disparadas y nunca leídas—,
-- y `tasa_bcv` se detenía en la fecha valor 02/11.
--
-- SEGUNDO FALLO: el orden de las comprobaciones
--
-- `resolver_captura_tasa` miraba primero "¿no hay nada en curso?" y disparaba.
-- La comprobación de "¿ya terminó hoy?" quedaba AFTER, así que era inalcanzable:
-- con cualquier llamada repetida volvía a disparar. Con un cron diario no se
-- notaba; con reintentos habría martillado las APIs.
--
-- TERCER FALLO: 'cayo' no existe en la tabla
--
-- Al agotar un eslabón el código escribía `estado = 'cayo'`, pero el CHECK de
-- `tasa_intento.estado` solo admite ('en_curso', 'ok', 'fallido'). La cadena de
-- respaldos reventaba con una violación de constraint en vez de pasar a la
-- siguiente fuente.
--
-- CUARTO FALLO: una respuesta que aún no llegó se trataba como fuente caída
--
-- Si `_leer_respuesta_tasa` no encontraba la respuesta devolvía
-- `servible: false, motivo: 'sin respuesta'`, y el llamador marcaba la fuente
-- como caída y saltaba a la siguiente. Con un solo disparo diario eso ofrecía
-- una tasa de respaldo MENOS confiable solo porque la red tardó un segundo.
-- Ahora "sin respuesta" significa ESPERAR y reintentar, no descartar.
--
-- EL HORARIO NO CAMBIA
--
-- Las 22:40 hora Venezuela siguen siendo el centro de la ventana: er-api
-- publica entre las 20:02 y las 20:26 VE y a esa hora ya hay dato con margen
-- de sobra. Lo que cambia es que la ventana ahora se recorre varias veces para
-- poder leer lo que se disparó.
-- ============================================================

BEGIN;

-- ── 1. El estado 'cayo' nunca fue válido ──
UPDATE tasa_intento
   SET estado = 'fallido',
       detalle = COALESCE(detalle, 'marcado como fallido por la migración 48')
 WHERE estado = 'en_curso'
   AND http_id NOT IN (SELECT id FROM net._http_response);

-- ── 2. Reescribir el resolutor con el orden correcto ──
CREATE OR REPLACE FUNCTION public.resolver_captura_tasa()
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
    v_cadena     TEXT[] := ARRAY['er-api', 'dolarapi', 'currency-api'];
    v_ult        RECORD;
    v_lect       JSONB;
    v_res        JSONB;
    v_eslabon    INT;
    v_sig        TEXT;
    v_intentos   INT;
BEGIN
    -- ── (1) Ya resuelto hoy: no disparar de nuevo ──
    --
    -- Va PRIMERO. En la versión anterior esta comprobación estaba después de
    -- la de "no hay nada en curso", así que nunca se alcanzaba: cada llamada
    -- volvía a disparar.
    IF EXISTS (
        SELECT 1 FROM tasa_intento
         WHERE disparado_en::DATE = CURRENT_DATE AND estado = 'ok'
    ) THEN
        RETURN jsonb_build_object('success', true, 'ya_resuelto', true);
    END IF;

    -- ── (2) Hay un intento de hoy sin leer: leerlo ──
    --
    -- OJO con la comprobación de "¿encontré algo?". NO se puede usar
    -- `IF v_ult IS NOT NULL`: sobre una variable RECORD eso significa "todos
    -- sus campos son no nulos", así que una fila real con `detalle` en NULL
    -- se evalúa como falsa. La función se saltaba entera esta rama y volvía a
    -- disparar en cada llamada. Se usa FOUND, que es lo que de verdad informa
    -- si el SELECT INTO encontró una fila.
    SELECT * INTO v_ult
      FROM tasa_intento
     WHERE disparado_en::DATE = CURRENT_DATE
       AND estado = 'en_curso'
     ORDER BY disparado_en DESC
     LIMIT 1;

    IF FOUND THEN
        v_lect := public._leer_respuesta_tasa(v_ult.http_id, v_ult.fuente);

        -- (2a) La respuesta todavía no llegó: esperar, NO descartar.
        --
        -- `net.http_get` es asíncrono. Si se consulta en el mismo instante del
        -- disparo todavía no hay respuesta, y tratarla como "fuente caída"
        -- hacía saltar a un respaldo menos confiable por pura impaciencia.
        --
        -- Pero esperar para siempre tampoco sirve: si la petición se perdió y
        -- la respuesta no llega nunca, la cadena no avanzaría al respaldo y
        -- el día se quedaría sin tasa. Pasado el plazo se da por caída.
        --
        -- El plazo es holgado a propósito: la petición se dispara con
        -- timeout de 15 s, así que a los 4 minutos no hay respuesta que valga.
        IF v_lect->>'motivo' = 'sin respuesta'
           AND v_ult.disparado_en > NOW() - INTERVAL '4 minutes' THEN
            RETURN jsonb_build_object(
                'success', true,
                'esperando', true,
                'fuente', v_ult.fuente,
                'intento', v_ult.id
            );
        END IF;

        IF v_lect->>'motivo' = 'sin respuesta' THEN
            v_lect := jsonb_build_object(
                'servible', false,
                'motivo', 'la fuente no respondió en 4 minutos'
            );
        END IF;

        -- (2b) Sirve: registrar con la fecha valor ya normalizada.
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

        -- (2c) No sirve: marcarlo y disparar el siguiente eslabón.
        UPDATE tasa_intento
           SET estado = 'fallido',
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

        v_sig := v_cadena[v_eslabon + 1];

        RETURN jsonb_build_object(
            'success', true,
            'cayo', v_ult.fuente,
            'siguiente', v_sig,
            'http_id', public._disparar_fuente_tasa(v_sig, v_sig = 'er-api')
        );
    END IF;

    -- ── (3) La cadena ya se recorrió entera hoy sin éxito ──
    --
    -- Sin esta comprobación, agotadas las tres fuentes no habría ningún
    -- intento en curso y el paso (4) volvería a empezar la cadena,
    -- martillando las APIs en cada reintento.
    SELECT count(*) INTO v_intentos
      FROM tasa_intento
     WHERE disparado_en::DATE = CURRENT_DATE;

    IF v_intentos >= array_length(v_cadena, 1) THEN
        RETURN jsonb_build_object(
            'success', false,
            'error', 'Se agotaron las fuentes',
            'intentos', v_intentos
        );
    END IF;

    -- ── (4) No hay nada en curso: arrancar la cadena ──
    RETURN public.capturar_tasa_con_respaldo();
END;
$function$;

COMMENT ON FUNCTION public.resolver_captura_tasa() IS
    'Avanza la captura de la tasa un paso por llamada: dispara si no hay nada '
    'en curso, lee la respuesta si la hay, y salta al respaldo si la fuente '
    'falló. Espera (no descarta) mientras la respuesta HTTP no haya llegado. '
    'Se llama varias veces seguidas dentro de la ventana de las 22:40 VE.';

-- ── 3. La ventana recorre la captura varias veces ──
--
-- 22:40-22:58 y 23:01-23:10 hora Venezuela = 02:40-02:58 y 03:01-03:10 UTC.
-- Cada 3 minutos: alcanza para disparar, leer y encadenar los tres respaldos,
-- sin martillar las APIs el resto del día.
SELECT cron.unschedule('tasa-bcv-procesar')
 WHERE EXISTS (SELECT 1 FROM cron.job WHERE jobname = 'tasa-bcv-procesar');

SELECT cron.schedule(
    'tasa-bcv-procesar',
    '40,43,46,49,52,55,58 2 * * 1-6',   -- 22:40-22:58 VE, noche dom-vie
    $$ SELECT public.resolver_captura_tasa(); $$
);

SELECT cron.unschedule('tasa-bcv-procesar-cola')
 WHERE EXISTS (SELECT 1 FROM cron.job WHERE jobname = 'tasa-bcv-procesar-cola');

SELECT cron.schedule(
    'tasa-bcv-procesar-cola',
    '1,4,7,10 3 * * 1-6',               -- 23:01-23:10 VE, cierre de la ventana
    $$ SELECT public.resolver_captura_tasa(); $$
);

COMMIT;
