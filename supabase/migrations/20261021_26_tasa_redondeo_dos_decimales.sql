-- ============================================================
-- 20261021_26_tasa_redondeo_dos_decimales.sql
--
-- EL REDONDEO ES A 2 DECIMALES, Y ESO ES LO QUE DEFINE "ES LA MISMA TASA"
--
-- `config.tasa_cambio` es `numeric(10,2)`. El BCV publica 4 decimales
-- (886,2271) y el sistema guarda 2 (886,23). Preguntar "¿es la misma tasa?"
-- tiene que comparar lo que SE COBRA, no la diferencia cruda.
--
-- Lo que había era una tolerancia de 0,01 Bs por dólar:
--
--     v_es_igual := ABS(v_dif_bs) < 0.01
--
-- Esa tolerancia miente en los bordes. Medido:
--
--     BCV 886,2249 | base 886,23 | dif 0,0051
--     tolerancia dice IGUAL  ->  pero 886,2249 redondea a 886,22, no a 886,23
--
-- O sea: el panel decía "la diferencia es de redondeo" cuando en realidad la
-- tasa del BCV, llevada a los 2 decimales que se cobran, era OTRA.
--
-- La regla correcta es una sola y no tiene parámetros: redondear las dos a
-- 2 decimales y comparar.
--
-- IDEMPOTENTE.
-- ============================================================

BEGIN;

-- ============================================================
-- `tasa_panel()`: la comparación pasa a ser por redondeo
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
    v_bcv_valor    NUMERIC;
    v_dif_bs       NUMERIC;
    v_dif_pct      NUMERIC;
    v_signo        TEXT;
    v_es_igual     BOOLEAN := FALSE;
    v_capturas     JSONB;
    v_por_confirmar JSONB;
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
        v_bcv_valor := (v_bcv->>'valor')::NUMERIC;
        v_dif_bs    := v_bcv_valor - v_base;
        v_dif_pct   := ROUND(((v_dif_bs) / v_base * 100)::NUMERIC, 4);

        -- La regla: ¿la tasa del BCV, llevada a los 2 decimales que se cobran,
        -- es la misma que se está cobrando? Nada de tolerancias.
        v_es_igual := (ROUND(v_bcv_valor, 2) = ROUND(v_base, 2));

        v_signo := CASE WHEN v_es_igual THEN 'igual'
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
            -- Se expone el valor del BCV ya redondeado: es el número que se
            -- cobraría si se elige, y el frontend lo muestra tal cual para que
            -- no aparezca un 886,2271 que después se guarda como 886,23.
            'bcv_redondeado',     CASE WHEN v_bcv IS NOT NULL
                                       THEN ROUND((v_bcv->>'valor')::NUMERIC, 2)
                                       ELSE NULL END,
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

-- ============================================================
-- El nivel de confirmación también razona en 2 decimales
-- ============================================================
--
-- Si la tasa nueva, redondeada, es la misma que la actual, no hay nada que
-- decidir: nivel 0, sin preguntas. Antes esto dependía de una tolerancia.
CREATE OR REPLACE FUNCTION public._nivel_confirmacion_tasa(
    p_valor NUMERIC,
    p_origen TEXT,
    p_fecha_valor DATE
)
RETURNS INTEGER
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path TO 'public'
AS $$
DECLARE
    v_base_anterior NUMERIC;
    v_salto_pct     NUMERIC;
    v_umbral        NUMERIC := 0.5;
    v_brusco        NUMERIC := 50;
BEGIN
    SELECT tasa_cambio INTO v_base_anterior FROM config WHERE id = 1;

    -- Adelantar la fecha valor SIEMPRE pide confirmación: no es fricción, es
    -- una decisión con consecuencia y tiene que quedar registrada.
    IF p_fecha_valor IS NOT NULL AND p_fecha_valor > CURRENT_DATE THEN
        RETURN 1;
    END IF;

    IF COALESCE(v_base_anterior, 0) <= 0 THEN
        RETURN 0;
    END IF;

    -- A 2 decimales es la misma tasa: no hay nada que decidir.
    IF ROUND(p_valor, 2) = ROUND(v_base_anterior, 2) THEN
        RETURN 0;
    END IF;

    v_salto_pct := ABS(p_valor - v_base_anterior) / v_base_anterior * 100;

    IF v_salto_pct < v_umbral THEN
        RETURN 0;
    END IF;

    IF v_salto_pct > v_brusco THEN
        RETURN 2;
    END IF;

    IF p_origen = 'manual' THEN
        RETURN 0;
    END IF;

    RETURN 1;
END;
$$;

-- ============================================================
-- `estado_revision_tasa()`: los textos que pidió el dueño
-- ============================================================
--
-- No cambia la lógica: cambia lo que la base informa para que el frontend
-- pueda escribir "La tasa sigue siendo la de ayer, BCV no publicó nueva".
-- El texto se arma en el navegador, pero la base tiene que entregar la
-- comparación ya hecha, para que no haya dos lugares que decidan lo mismo.
CREATE OR REPLACE FUNCTION public.estado_revision_tasa()
RETURNS JSONB
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path TO 'public'
AS $$
DECLARE
    v_rev       RECORD;
    v_bcv       JSONB;
    v_base      NUMERIC;
    v_dias      INTEGER;
    v_cadena    JSONB;
    v_fallo_hoy BOOLEAN := FALSE;
BEGIN
    SELECT * INTO v_rev FROM tasa_revision_diaria WHERE dia = CURRENT_DATE;
    v_bcv := public.tasa_bcv_vigente_json();
    SELECT tasa_cambio INTO v_base FROM config WHERE id = 1;

    v_dias := (v_bcv->>'dias_atras')::INTEGER;

    SELECT jsonb_agg(jsonb_build_object('fuente', fuente, 'estado', estado, 'detalle', detalle))
      INTO v_cadena
      FROM tasa_intento
     WHERE disparado_en::DATE = CURRENT_DATE;

    IF v_cadena IS NOT NULL THEN
        v_fallo_hoy := NOT EXISTS (
            SELECT 1 FROM tasa_intento
             WHERE disparado_en::DATE = CURRENT_DATE AND estado = 'ok'
        ) AND NOT EXISTS (
            SELECT 1 FROM tasa_intento
             WHERE disparado_en::DATE = CURRENT_DATE AND estado = 'en_curso'
        );
    END IF;

    RETURN jsonb_build_object(
        'ya_revisada',   v_rev.dia IS NOT NULL,
        'revisada_por',  v_rev.revisada_por,
        'accion',        v_rev.accion,
        'revisada_en',   v_rev.revisada_en,

        -- Solo se pide revisión si hay algo NUEVO que decidir.
        'necesita_revision', (
            v_rev.dia IS NULL
            AND v_bcv IS NOT NULL
            AND COALESCE(v_dias, 99) <= 1
        ),

        'antiguedad_dias',   COALESCE(v_dias, NULL),
        'dato_viejo',        COALESCE(v_dias, 0) > 1,
        'captura_fallo_hoy', v_fallo_hoy,

        -- Datos para que el frontend arme los dos textos nuevos sin recalcular
        -- nada:
        --   "La tasa sigue siendo la de ayer, BCV no publicó nueva"
        --   "Este es el BCV de <fuente> del <fecha>, ¿lo eliges?"
        'fuente_bcv',    v_bcv->>'fuente',
        'fecha_valor',   v_bcv->>'fecha_valor',
        -- true cuando la tasa del BCV, a 2 decimales, es la que ya se cobra.
        'misma_tasa',    CASE
                             WHEN v_bcv IS NULL OR COALESCE(v_base, 0) <= 0 THEN NULL
                             ELSE (ROUND((v_bcv->>'valor')::NUMERIC, 2) = ROUND(v_base, 2))
                         END,

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

NOTIFY pgrst, 'reload schema';

COMMIT;
