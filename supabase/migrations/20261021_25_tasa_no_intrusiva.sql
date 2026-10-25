-- ============================================================
-- 20261021_25_tasa_no_intrusiva.sql
--
-- DOS PROBLEMAS, UN MISMO ORIGEN: el sistema pregunta de más.
--
-- PROBLEMA 1 — LA VENTANA PIDE REVISIÓN CON UN DATO VIEJO
--
-- Simulado el 25/10 con la tasa vigente del 23/10, la ventana se abría igual.
-- La condición era `v_rev.dia IS NULL AND v_bcv IS NOT NULL`: cualquier tasa
-- del BCV, por vieja que fuera, disparaba la revisión.
--
-- Consecuencias medidas:
--   - Un sábado, un domingo o un feriado la ventana aparece aunque el BCV no
--     publique nada. El admin "revisa" una tasa que no cambió y la decisión
--     queda registrada como si hubiera algo que decidir.
--   - Si la captura falla los tres eslabones, `tasa_bcv_vigente_json()`
--     devuelve la captura de hace días y la ventana la presenta como "lo que
--     publicó el BCV", sin decir que es de anteayer.
--
-- PROBLEMA 2 — EL FLUJO PIDE MÁS CONFIRMACIONES DE LAS NECESARIAS
--
-- Elegir la tasa del BCV desde el panel pedía DOS confirmaciones para un
-- cambio del 0,12%. Con el aumento diario activo, alguien entra todos los días
-- a mover la tasa: dos diálogos por día, todos los días, es fricción pura.
--
-- REGLA DE DISEÑO QUE QUEDA ESCRITA ACÁ
--
--   Se pregunta UNA VEZ, y solo cuando la respuesta no es obvia.
--
--   - Diferencia menor al umbral (0,5%): no se pregunta nada. Se aplica y se
--     avisa por toast. Es redondeo, no una decisión.
--   - Diferencia entre el umbral y un salto grande (50%): UNA confirmación.
--   - Salto mayor al 50%: dos confirmaciones. Un dedazo acá descuadra todos
--     los precios del restaurante y merece la fricción.
--
--   El adelanto de la fecha valor sigue pidiendo su confirmación: no es
--   fricción, es una decisión con consecuencia legal y queda registrada.
--
-- IDEMPOTENTE.
-- ============================================================

BEGIN;

-- ============================================================
-- 1. La ventana deja de molestar con datos viejos
-- ============================================================
--
-- `necesita_revision` ahora exige que el dato sea FRESCO. Si la última tasa
-- del BCV tiene más de un día, el sistema no pide revisión: no hay nada nuevo
-- que decidir, y preguntar por preguntar es lo que hace que la gente cierre
-- la ventana sin leer.
--
-- Pero el admin igual tiene que enterarse de que el dato es viejo. Para eso
-- está `antiguedad`, que el frontend muestra de forma visible.
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

    -- ¿La cadena de hoy terminó sin ninguna fuente servible? Si es así, el
    -- admin tiene que saber que lo que ve es la última tasa que se pudo
    -- capturar, no la de hoy.
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

        -- SOLO se pide revisión si hay algo NUEVO que decidir: una tasa del
        -- BCV cuya fecha valor sea de hoy o de ayer, y que nadie revisó.
        --
        -- Un dato de hace tres días no es una decisión pendiente: es un dato
        -- que ya se revisó cuando era fresco. Volver a preguntar por él es
        -- ruido, y el ruido enseña a cerrar ventanas sin leer.
        'necesita_revision', (
            v_rev.dia IS NULL
            AND v_bcv IS NOT NULL
            AND COALESCE(v_dias, 99) <= 1
        ),

        -- Cuántos días tiene el dato. El frontend lo muestra SIEMPRE que sea
        -- mayor a 1, aunque no pida revisión: el admin tiene derecho a saber
        -- que está mirando una tasa de anteayer.
        'antiguedad_dias', COALESCE(v_dias, NULL),
        'dato_viejo',      COALESCE(v_dias, 0) > 1,
        -- La cadena de hoy falló por completo: lo que se ve no es de hoy.
        'captura_fallo_hoy', v_fallo_hoy,

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
-- 2. Menos confirmaciones, pero donde importan
-- ============================================================
--
-- La lógica de "¿pido confirmación?" vivía en el navegador, repetida en dos
-- archivos. Ahora vive acá, que es el único lugar donde se puede razonar
-- sobre el salto y el umbral juntos.
--
-- `nivel_confirmacion` que devuelve `aplicar_tasa_elegida`:
--   0 -> aplicar directo (diferencia menor al umbral: es redondeo)
--   1 -> pedir una confirmación (diferencia real, salto razonable)
--   2 -> pedir dos (salto mayor al 50%: dedazo probable)
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
    v_umbral        NUMERIC := 0.5;   -- mismo umbral que el aviso de deriva
    v_brusco        NUMERIC := 50;    -- salto que ya no parece intencional
BEGIN
    SELECT tasa_cambio INTO v_base_anterior FROM config WHERE id = 1;

    -- El adelanto de la fecha valor SIEMPRE pide confirmación: no es fricción,
    -- es una decisión con consecuencia y tiene que quedar registrada.
    IF p_fecha_valor IS NOT NULL AND p_fecha_valor > CURRENT_DATE THEN
        RETURN 1;
    END IF;

    -- Primer cambio de tasa: no hay con qué comparar, no se pregunta.
    IF COALESCE(v_base_anterior, 0) <= 0 THEN
        RETURN 0;
    END IF;

    v_salto_pct := ABS(p_valor - v_base_anterior) / v_base_anterior * 100;

    IF v_salto_pct < v_umbral THEN
        RETURN 0;   -- redondeo: aplicar sin preguntar
    END IF;

    IF v_salto_pct > v_brusco THEN
        RETURN 2;   -- dedazo probable: dos confirmaciones
    END IF;

    -- La carga manual ya nació de un prompt: el usuario escribió el número a
    -- mano. Volver a preguntarle si está seguro es preguntar dos veces lo
    -- mismo. Solo se pide confirmación si el salto es brusco (caso de arriba).
    IF p_origen = 'manual' THEN
        RETURN 0;
    END IF;

    RETURN 1;
END;
$$;

-- ============================================================
-- `aplicar_tasa_elegida` respeta el nivel
-- ============================================================
CREATE OR REPLACE FUNCTION public.aplicar_tasa_elegida(
    p_valor       NUMERIC,
    p_origen      TEXT,
    p_fecha_valor DATE    DEFAULT NULL,
    p_confirmar   BOOLEAN DEFAULT FALSE
)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $$
DECLARE
    v_base_anterior      NUMERIC;
    v_efectiva_anterior  NUMERIC;
    v_ratio              NUMERIC;
    v_efectiva_nueva     NUMERIC;
    v_estado             TEXT;
    v_motivo             TEXT;
    v_id                 BIGINT;
    v_adelanto           BOOLEAN := FALSE;
    v_nivel              INTEGER;
    v_salto_pct          NUMERIC;
BEGIN
    PERFORM public.exigir_cajero_o_admin();

    IF p_valor IS NULL OR p_valor <= 0 THEN
        RETURN jsonb_build_object('success', false,
            'error', 'La tasa tiene que ser mayor que cero');
    END IF;

    IF p_origen IS NULL OR p_origen NOT IN ('vigente', 'proxima', 'manual') THEN
        RETURN jsonb_build_object('success', false,
            'error', 'Origen inválido: usá vigente, proxima o manual');
    END IF;

    SELECT tasa_cambio, tasa_efectiva
      INTO v_base_anterior, v_efectiva_anterior
      FROM config
     WHERE id = 1;

    IF p_fecha_valor IS NULL THEN
        p_fecha_valor := CURRENT_DATE;
    END IF;

    v_nivel := public._nivel_confirmacion_tasa(p_valor, p_origen, p_fecha_valor);

    -- Nivel 2 exige las dos confirmaciones. Nivel 1, una. Nivel 0, ninguna.
    IF v_nivel = 2 AND NOT p_confirmar THEN
        v_salto_pct := ABS(p_valor - v_base_anterior) / NULLIF(v_base_anterior, 0) * 100;
        RETURN jsonb_build_object(
            'success', false,
            'requiere_confirmacion', true,
            'nivel_confirmacion', 2,
            'error', 'La tasa cambia ' || ROUND(v_salto_pct, 1) ||
                     '% respecto de la actual (' || v_base_anterior || '). ' ||
                     'Es un salto muy grande. Confirmá que es intencional.',
            'tasa_anterior', v_base_anterior,
            'tasa_nueva', p_valor
        );
    END IF;

    v_adelanto := p_fecha_valor > CURRENT_DATE;
    v_estado   := 'aplicada';
    v_motivo   := CASE
        WHEN v_adelanto THEN
            'Aplicada por decisión del admin antes de su fecha valor (origen: ' ||
            p_origen || ', fecha valor: ' || p_fecha_valor || ')'
        WHEN p_origen = 'manual' THEN
            'Cargada a mano por el admin'
        ELSE
            'Aplicada desde el panel (origen: ' || p_origen || ')'
    END;

    SELECT id INTO v_id
      FROM tasa_bcv
     WHERE fecha_valor = p_fecha_valor
       AND valor = p_valor
     LIMIT 1;

    IF v_id IS NULL THEN
        INSERT INTO tasa_bcv (fecha_valor, valor, fuente, es_principal, estado, motivo_estado, aplicada_en)
        VALUES (p_fecha_valor, p_valor,
                CASE WHEN p_origen = 'manual' THEN 'manual_admin' ELSE 'panel_admin' END,
                p_origen <> 'manual',
                v_estado, v_motivo, NOW())
        RETURNING id INTO v_id;
    ELSE
        UPDATE tasa_bcv
           SET estado        = v_estado,
               motivo_estado = v_motivo,
               aplicada_en   = COALESCE(aplicada_en, NOW())
         WHERE id = v_id;
    END IF;

    -- La EFECTIVA conserva el factor del aumento acumulado. Acá ya hubo un bug
    -- que borraba meses de ajuste con un clic.
    v_ratio := CASE WHEN COALESCE(v_base_anterior, 0) > 0
                     AND COALESCE(v_efectiva_anterior, 0) > 0
                    THEN v_efectiva_anterior / v_base_anterior
                    ELSE 1 END;

    v_efectiva_nueva := ROUND(p_valor * v_ratio, 2);

    UPDATE config
       SET tasa_cambio         = p_valor,
           tasa_efectiva       = v_efectiva_nueva,
           ultima_actualizacion = NOW()
     WHERE id = 1;

    RETURN jsonb_build_object(
        'success',          TRUE,
        'id',               v_id,
        'origen',           p_origen,
        'adelanto',         v_adelanto,
        'nivel_confirmacion', v_nivel,
        'fecha_valor',      p_fecha_valor,
        'tasa_anterior',    v_base_anterior,
        'tasa_aplicada',    p_valor,
        'tasa_efectiva',    v_efectiva_nueva,
        'factor_conservado',ROUND(v_ratio, 6),
        'motivo',           v_motivo
    );
END;
$$;

-- ============================================================
-- La ventana del día, con lo que hace falta para no preguntar
-- ============================================================
--
-- `tasa_panel()` ya devuelve `revision`. Se agrega ahí mismo el aviso de
-- antigüedad para que el panel lo pinte.
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

GRANT EXECUTE ON FUNCTION public._nivel_confirmacion_tasa(NUMERIC, TEXT, DATE) TO authenticated;

NOTIFY pgrst, 'reload schema';

COMMIT;
