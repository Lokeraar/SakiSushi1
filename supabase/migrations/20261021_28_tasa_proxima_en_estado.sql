-- 20261021_28_tasa_proxima_en_estado.sql
--
-- POR QUÉ EXISTE
--
-- El dueño pidió que la ventana del día ofrezca tres opciones, y la del medio
-- es "establecer la próxima conocida (la publicada con fecha de día/días
-- siguiente/siguientes)".
--
-- Esa opción NO necesita lógica nueva: `aplicar_tasa_elegida()` ya acepta
-- p_origen = 'proxima' desde la migración 23, y `_nivel_confirmacion_tasa()`
-- ya la trata como corresponde:
--
--     -- Adelantar la fecha valor SIEMPRE pide confirmación: no es fricción,
--     -- es una decisión con consecuencia y tiene que quedar registrada.
--     IF p_fecha_valor IS NOT NULL AND p_fecha_valor > CURRENT_DATE THEN
--         RETURN 1;
--     END IF;
--
-- Lo único que faltaba era que la ventana supiera QUE hay una próxima. Hoy
-- `estado_revision_tasa()` solo devuelve el bloque `bcv`, y ese bloque está
-- filtrado a `fecha_valor <= CURRENT_DATE` con `estado = 'aplicada'`. O sea:
-- una captura con fecha valor futura existe en la tabla, se ve pendiente en
-- el panel, pero la ventana no la nombra y el admin no tiene cómo elegirla.
--
-- Esta migración agrega `tasa_bcv_proxima_json()` y la expone como `proxima`
-- dentro de `estado_revision_tasa()`.
--
-- OJO CON EL ESTADO: la próxima entra con estado 'pendiente' a propósito
-- (migración 24: un respaldo NUNCA queda aplicada solo). Elegirla desde la
-- ventana NO cambia su estado a 'aplicada': se aplica a `config` con
-- p_origen='proxima' y queda registrada en `tasa_intento`. Eso es deliberado:
-- "aplicada" significa "es la tasa que rige", y una fecha futura no rige
-- todavía. Si el día llega, la aplica el paso normal.

-- ============================================================
-- La próxima captura conocida (fecha valor futura, la más cercana)
-- ============================================================
CREATE OR REPLACE FUNCTION public.tasa_bcv_proxima_json()
RETURNS jsonb
LANGUAGE sql
STABLE SECURITY DEFINER
SET search_path TO 'public'
AS $function$
    SELECT jsonb_build_object(
        'valor',        t.valor,
        'fecha_valor',  t.fecha_valor,
        'fuente',       t.fuente,
        'estado',       t.estado,
        'capturada_en', t.capturada_en,
        -- Días que faltan para que esa fecha llegue. Negativo no puede pasar
        -- porque el WHERE ya filtra el futuro; se deja igual por claridad.
        'dias_adelante', (t.fecha_valor - CURRENT_DATE)
    )
      FROM tasa_bcv t
     WHERE t.fecha_valor > CURRENT_DATE
       AND t.estado = 'pendiente'
     ORDER BY t.fecha_valor ASC, t.capturada_en DESC
     LIMIT 1;
$function$;

COMMENT ON FUNCTION public.tasa_bcv_proxima_json() IS
    'Captura del BCV con fecha valor futura más cercana. Devuelve NULL si no hay. '
    'Es la que la ventana del día ofrece como "establecer la próxima conocida".';

REVOKE ALL ON FUNCTION public.tasa_bcv_proxima_json() FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.tasa_bcv_proxima_json() TO authenticated;

-- ============================================================
-- estado_revision_tasa(): + bloque `proxima`
-- ============================================================
CREATE OR REPLACE FUNCTION public.estado_revision_tasa()
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $function$
DECLARE
    v_rev   RECORD;
    v_bcv   JSONB;
    v_prox  JSONB;
    v_base  NUMERIC;
    v_dias  INTEGER;
BEGIN
    SELECT tasa_cambio INTO v_base FROM config WHERE id = 1;

    SELECT * INTO v_rev
      FROM tasa_revision_diaria
     WHERE dia = CURRENT_DATE;

    v_bcv  := public.tasa_bcv_vigente_json();
    v_prox := public.tasa_bcv_proxima_json();
    v_dias := (v_bcv->>'dias_atras')::INTEGER;

    RETURN jsonb_build_object(
        -- ¿Hay que firmar hoy? Sí cuando no hay firma del día y hay alguna
        -- captura. La antigüedad del dato NO decide (migración 27): un dato
        -- de tres días también exige que alguien lo confirme.
        'necesita_revision', (v_rev.dia IS NULL AND v_bcv IS NOT NULL),
        'ya_revisada',       (v_rev.dia IS NOT NULL),
        'revisada_por',      v_rev.revisada_por,
        'revisada_en',       v_rev.revisada_en,
        'accion',            v_rev.accion,
        'aplicada',          v_base,
        'fuente_bcv',        v_bcv->>'fuente',
        'fecha_valor',       v_bcv->>'fecha_valor',
        -- La captura de hoy falló (o no corrió) y lo que hay es de antes.
        'dato_viejo',        COALESCE(v_dias, 0) > 0,
        'antiguedad_dias',   v_dias,
        'captura_fallo_hoy', COALESCE(v_dias, 0) > 0,
        'misma_tasa',
            CASE
                WHEN v_bcv IS NULL OR COALESCE(v_base, 0) <= 0 THEN NULL
                ELSE (ROUND((v_bcv->>'valor')::NUMERIC, 2) = ROUND(v_base, 2))
            END,
        'diferencia_bolivares',
            CASE
                WHEN v_bcv IS NOT NULL AND COALESCE(v_base, 0) > 0
                THEN ROUND(((v_bcv->>'valor')::NUMERIC - v_base)::NUMERIC, 4)
                ELSE NULL
            END,
        'diferencia_porcentaje',
            CASE
                WHEN v_bcv IS NOT NULL AND COALESCE(v_base, 0) > 0
                THEN ROUND((((v_bcv->>'valor')::NUMERIC - v_base) / v_base * 100)::NUMERIC, 4)
                ELSE NULL
            END,
        'bcv',     v_bcv,
        -- NUEVO: la publicación con fecha valor futura, si existe. La ventana
        -- la ofrece como segunda opción; el admin puede adelantarla a
        -- sabiendas y queda registrada como origen 'proxima'.
        'proxima', v_prox
    );
END;
$function$;

COMMENT ON FUNCTION public.estado_revision_tasa() IS
    'Estado del día para la ventana de tasa. `bcv` es la vigente (fecha valor '
    'pasada o de hoy); `proxima` es la publicada con fecha futura, si hay.';
