-- ============================================================
-- 33 — "Conservar" debe ofrecer la última tasa VIGENTE, no la de `config`
-- ============================================================
--
-- QUÉ PROBLEMA RESUELVE
--
-- En la ventana de la tasa, el botón decía:
--
--     "Conservar 886.23 del jueves 29/10"
--
-- y las dos partes de esa frase estaban mal por su cuenta:
--
--   1. El MONTO salía de `config.tasa_cambio`. Pero `config` es la caja
--      registradora, no el registro oficial: `aplicar_tasas_vencidas` marca
--      la tasa como 'aplicada' en `tasa_bcv` y NO escribe `config`. Con el
--      cron de las 7 am moviendo tasas todos los días, `config` se queda
--      atrás. Ese día decía 886.23 (del 23/10) cuando la vigente real ya
--      era 888.89 (del 29/10).
--
--   2. La FECHA salía de `bcv.fecha_valor`, o sea la de la captura más
--      reciente. Así, un monto viejo aparecía firmado con la fecha de hoy.
--      Peor que un número viejo: un número viejo que parece nuevo.
--
-- LA REGLA DEL DUEÑO
--
-- "Nos regimos siempre por la última o la próxima, nunca menos."
--
-- Con dos precisiones que ya estaban resueltas en otro lado y se respetan:
--
--   - El corte de las 7 am ya existe: el cron de las 11:00 UTC pasa de
--     'pendiente' a 'aplicada' lo que llegó a su fecha valor. Antes de esa
--     hora, la de hoy todavía no rige y se conserva la de ayer.
--   - Sábados, domingos, feriados y lunes bancarios no traen publicación
--     nueva. Como acá solo se mira lo que tiene `fecha_valor <= HOY`, esos
--     días se sigue conservando la última vigente, sin inventar nada.
--
-- QUÉ HACE ESTA MIGRACIÓN
--
-- `estado_revision_tasa()` gana dos campos: `vigente` (monto, fecha y
-- fuente de la tasa que de verdad rige) y `conservar` (el monto que hay que
-- ofrecer al tocar el botón). Se calculan con `tasa_vigente()`, que es la
-- única función que ya resolvía esto bien.
--
-- `conservar` nunca puede ser menor que la vigente: si no hay ninguna
-- vigente (base recién instalada), cae a `config` para no romper el arranque.
-- ============================================================

BEGIN;

CREATE OR REPLACE FUNCTION public.estado_revision_tasa()
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $function$
DECLARE
    v_rev     RECORD;
    v_bcv     JSONB;
    v_prox    JSONB;
    v_base    NUMERIC;
    v_dias    INTEGER;
    v_vigente RECORD;
    v_cons    NUMERIC;
    v_cons_f  DATE;
BEGIN
    SELECT tasa_cambio INTO v_base FROM config WHERE id = 1;

    SELECT * INTO v_rev
      FROM tasa_revision_diaria
     WHERE dia = CURRENT_DATE;

    v_bcv  := public.tasa_bcv_vigente_json();
    v_prox := public.tasa_bcv_proxima_json();
    v_dias := (v_bcv->>'dias_atras')::INTEGER;

    -- La tasa que de verdad rige hoy: la capturada con fecha valor de hoy o
    -- anterior, marcada como aplicada, la más nueva de todas.
    SELECT * INTO v_vigente FROM public.tasa_vigente();

    -- Qué se ofrece al tocar "Conservar". Siempre la vigente. Si todavía no
    -- hay ninguna (instalación nueva), se usa `config` para no dejar el
    -- botón sin número.
    IF v_vigente.valor IS NOT NULL THEN
        v_cons   := v_vigente.valor;
        v_cons_f := v_vigente.fecha_valor;
    ELSE
        v_cons   := v_base;
        v_cons_f := NULL;
    END IF;

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
        -- La tasa que rige de verdad, con su fecha. `aplicada` se mantiene
        -- por compatibilidad, pero ya no es la que manda en la decisión.
        'vigente',
            CASE WHEN v_vigente.valor IS NULL THEN NULL
                 ELSE jsonb_build_object(
                        'valor',       v_vigente.valor,
                        'fecha_valor', v_vigente.fecha_valor,
                        'fuente',      v_vigente.fuente) END,
        -- Lo que hay que ofrecer en el botón, con el monto y la fecha
        -- pegados a la misma tasa. Nunca se arma la fecha con otra captura.
        'conservar',
            jsonb_build_object(
                'valor',       v_cons,
                'fecha_valor', v_cons_f,
                'fuente',      CASE WHEN v_vigente.valor IS NULL THEN 'config'
                                    ELSE v_vigente.fuente END),
        'fuente_bcv',        v_bcv->>'fuente',
        'fecha_valor',       v_bcv->>'fecha_valor',
        -- La captura de hoy falló (o no corrió) y lo que hay es de antes.
        'dato_viejo',        COALESCE(v_dias, 0) > 0,
        'antiguedad_dias',   v_dias,
        'captura_fallo_hoy', COALESCE(v_dias, 0) > 0,
        -- La comparación se hace contra la vigente, que es lo que se cobra.
        'misma_tasa',
            CASE
                WHEN v_bcv IS NULL OR COALESCE(v_cons, 0) <= 0 THEN NULL
                ELSE (ROUND((v_bcv->>'valor')::NUMERIC, 2) = ROUND(v_cons, 2))
            END,
        'diferencia_bolivares',
            CASE
                WHEN v_bcv IS NOT NULL AND COALESCE(v_cons, 0) > 0
                THEN ROUND(((v_bcv->>'valor')::NUMERIC - v_cons)::NUMERIC, 4)
                ELSE NULL
            END,
        'diferencia_porcentaje',
            CASE
                WHEN v_bcv IS NOT NULL AND COALESCE(v_cons, 0) > 0
                THEN ROUND((((v_bcv->>'valor')::NUMERIC - v_cons) / v_cons * 100)::NUMERIC, 4)
                ELSE NULL
            END,
        'bcv',     v_bcv,
        'proxima', v_prox
    );
END;
$function$;

COMMENT ON FUNCTION public.estado_revision_tasa() IS
    'Estado de la revisión diaria. "conservar" trae el monto y la fecha de la '
    'tasa vigente real (tasa_vigente()), no de config, para que el botón no '
    'ofrezca un número viejo con la fecha de hoy.';

NOTIFY pgrst, 'reload schema';

COMMIT;
