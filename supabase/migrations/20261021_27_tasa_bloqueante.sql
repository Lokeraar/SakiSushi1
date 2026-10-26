-- ============================================================
-- 20261021_27_tasa_bloqueante.sql
--
-- LA TASA ES INDISPENSABLE: SIN DECISIÓN DEL DÍA, NO SE OPERA
--
-- LO QUE ESTABA MAL
--
-- En la migración 25 se endureció `necesita_revision` para que solo pidiera
-- revisión cuando el dato tuviera un día o menos de antigüedad. La idea era
-- no molestar con datos viejos.
--
-- Eso confundió dos cosas distintas:
--
--   "el BCV no publicó una tasa nueva"   -> no urge, es informativo
--   "nadie confirmó la tasa de HOY"      -> urge, el local no debe operar
--
-- Con la regla del día, un lunes con la tasa del viernes anterior el sistema
-- NO pide nada: cobra y sigue. Nadie firma. Y sin tasa confirmada, el
-- restaurante está trabajando a ciegas.
--
-- Regla del dueño, textual:
--   "si no se escoge ninguna el modal queda persistente hasta completarlo y
--    no se puede acceder a nada del panel porque es algo indispensable para
--    el funcionamiento correcto del restaurante"
--
-- ENTONCES
--
-- `necesita_revision` = no hay decisión registrada para HOY y hay alguna tasa
-- del BCV capturada. Sin importar cuántos días tenga el dato. Lo que falta no
-- es un dato nuevo: es la firma de alguien.
--
-- La antigüedad se sigue informando (`antiguedad_dias`, `dato_viejo`) para
-- que la ventana la muestre. Pero ya no decide si la ventana aparece.
--
-- IDEMPOTENTE.
-- ============================================================

BEGIN;

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

        -- BLOQUEANTE: si hoy nadie firmó y hay una tasa capturada, se pide.
        -- La antigüedad NO importa: un dato de hace tres días también necesita
        -- que alguien diga "sí, con esta trabajo". Sin esa firma el local no
        -- debería abrir.
        'necesita_revision', (v_rev.dia IS NULL AND v_bcv IS NOT NULL),

        -- Cuántos días tiene el dato. La ventana lo muestra siempre que sea
        -- mayor a 0, para que quien firma sepa qué está firmando.
        'antiguedad_dias',   COALESCE(v_dias, NULL),
        'dato_viejo',        COALESCE(v_dias, 0) > 1,
        'captura_fallo_hoy', v_fallo_hoy,

        'fuente_bcv',    v_bcv->>'fuente',
        'fecha_valor',   v_bcv->>'fecha_valor',
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

-- ============================================================
-- Registrar la decisión, con el nombre de quien la tomó
-- ============================================================
--
-- Se agrega `p_nota` ya existía. Lo que se agrega es que el nombre se resuelve
-- también desde el claim `user_metadata`, que es lo que lleva el JWT del login
-- (no siempre hay fila en `usuarios` vinculada).
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

    -- Nombre: primero la metadata del JWT (siempre está), después la tabla.
    SELECT COALESCE(
        (SELECT NULLIF(a.raw_user_meta_data->>'nombre', '')
           FROM auth.users a WHERE a.id = auth.uid() LIMIT 1),
        (SELECT u.nombre FROM auth.users a
           JOIN usuarios u ON u.id::TEXT = a.raw_user_meta_data->>'custom_user_id'
          WHERE a.id = auth.uid() LIMIT 1)
    ) INTO v_quien;

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
-- Historial de firmas, para auditar quién abrió cada día
-- ============================================================
CREATE OR REPLACE VIEW public.tasa_firmas_diarias AS
SELECT dia, revisada_por, accion, tasa_aplicada, tasa_bcv, fecha_valor_bcv,
       nota, revisada_en
  FROM tasa_revision_diaria
 ORDER BY dia DESC;

COMMENT ON VIEW public.tasa_firmas_diarias IS
    'Quién firmó la tasa cada día y qué decidió. Es el registro que responde "por qué ese día se cobró con esa tasa".';

GRANT SELECT ON public.tasa_firmas_diarias TO authenticated;
REVOKE ALL ON public.tasa_firmas_diarias FROM PUBLIC, anon;

NOTIFY pgrst, 'reload schema';

COMMIT;
