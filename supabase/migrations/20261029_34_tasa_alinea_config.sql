-- ============================================================
-- 34 — A las 7 am la tasa vigente pasa a `config`, sin preguntar
-- ============================================================
--
-- QUÉ PROBLEMA RESUELVE
--
-- Había dos lugares que decían "cuál es la tasa", y no coincidían:
--
--   - `tasa_bcv`: el registro oficial. El cron de las 11:00 UTC (7 am)
--     marca 'aplicada' lo que llegó a su fecha valor. Bien.
--   - `config`: la caja con la que se muestran precios y se cobra. Nada la
--     actualizaba salvo una firma manual en la ventana.
--
-- Con nadie firmando, `config` quedó congelada en 886.23 (del 23/10)
-- mientras la vigente real era 888.89 (del 29/10). Seis días de desfase
-- entre lo que la base sabía y lo que la caja mostraba.
--
-- LA REGLA DEL DUEÑO
--
-- "Se actualiza a las 7 am y cualquier pedido encolado desde esa hora hasta
--  que admin o cajero confirma la tasa se hace a esa tasa. Si después
--  deciden usar otra, se cobra a esa otra y ya."
--
-- O sea: el cron alinea `config` con la vigente, y la firma manual sigue
-- existiendo para corregir o adelantar. No es una doble confirmación que
-- bloquee: es una tasa que rige sola y una persona que puede cambiarla.
--
-- QUÉ HACE ESTA MIGRACIÓN
--
-- `aplicar_tasas_vencidas()` —el de las 7 am— ahora, después de marcar las
-- pendientes, alinea `config` con `tasa_vigente()`.
--
-- El ajuste respeta lo que `aplicar_tasa_elegida` ya hacía bien: la tasa
-- EFECTIVA conserva el factor del aumento acumulado. Sin eso, alinear la
-- base borraría meses de ajuste de un golpe. Es el mismo cálculo, copiado a
-- propósito: un solo factor, dos caminos que lo respetan.
--
-- Se puede desactivar con `config.aumento_activo = false`, igual que en el
-- resto del sistema: si no hay aumento corriendo, efectiva = tasa.
-- ============================================================

BEGIN;

CREATE OR REPLACE FUNCTION public.aplicar_tasas_vencidas()
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $function$
DECLARE
    v_cuantas   INTEGER;
    v_tasa      RECORD;
    v_base_ant  NUMERIC;
    v_efec_ant  NUMERIC;
    v_ratio     NUMERIC;
    v_efec_new  NUMERIC;
    v_alineada  BOOLEAN := FALSE;
    v_aum_activo BOOLEAN;
    v_aum_semanal BOOLEAN;
    v_aum_detenido BOOLEAN;
    v_con_recargo BOOLEAN;
BEGIN
    UPDATE tasa_bcv
       SET estado = 'aplicada',
           aplicada_en = NOW(),
           motivo_estado = NULL
     WHERE estado = 'pendiente'
       AND fecha_valor <= CURRENT_DATE;

    GET DIAGNOSTICS v_cuantas = ROW_COUNT;

    SELECT * INTO v_tasa FROM public.tasa_vigente();

    -- Alinear la caja con la vigente. Solo si hay vigente y solo si el valor
    -- cambió: si ya coincide, no se toca nada.
    IF v_tasa.valor IS NOT NULL THEN
        SELECT tasa_cambio, tasa_efectiva, aumento_activo, aumento_semanal, aumento_detenido
          INTO v_base_ant, v_efec_ant, v_aum_activo, v_aum_semanal, v_aum_detenido
          FROM config WHERE id = 1
           FOR UPDATE;

        -- Si no hay fila (base rota), no se puede alinear nada. Se informa y
        -- se sale: antes el UPDATE no tocaba ninguna fila y la funcion igual
        -- respondia "alineada", tapando el problema.
        IF NOT FOUND THEN
            RETURN jsonb_build_object(
                'success', FALSE,
                'aplicadas', v_cuantas,
                'config_alineada', FALSE,
                'error', 'No existe la fila config id=1; no se pudo alinear la tasa.');
        END IF;

        -- Hay recargo vigente si el aumento corre (diario o semanal) o si está
        -- DETENIDO. Los tres estados no son dos:
        --   activo   -> sube solo cada día/semana.
        --   detenido -> ya no sube, pero se sigue cobrando lo acumulado.
        --   ninguno  -> se cobra la tasa base, sin recargo.
        --
        -- Tratar "detenido" como "apagado" borraría el acumulado que el dueño
        -- quiere seguir cobrando; tratarlo como "activo" lo haría subir otra
        -- vez. Por eso se conserva el factor en ambos, y sólo se iguala a la
        -- base cuando no hay ningún recargo vigente.
        v_con_recargo := COALESCE(v_aum_activo, FALSE)
                      OR COALESCE(v_aum_semanal, FALSE)
                      OR COALESCE(v_aum_detenido, FALSE);

        IF ROUND(COALESCE(v_base_ant, 0), 2) <> ROUND(v_tasa.valor, 2)
           OR (NOT v_con_recargo
               AND ROUND(COALESCE(v_efec_ant, 0), 2) <> ROUND(v_tasa.valor, 2)) THEN

            -- El factor del recargo se conserva mientras haya recargo vigente,
            -- sea que esté subiendo o detenido. Sin recargo, la efectiva es la
            -- tasa base.
            v_ratio := CASE
                WHEN NOT v_con_recargo THEN 1
                WHEN COALESCE(v_base_ant, 0) > 0
                 AND COALESCE(v_efec_ant, 0) > 0
                THEN v_efec_ant / v_base_ant
                ELSE 1
            END;

            v_efec_new := ROUND(ROUND(v_tasa.valor, 2) * v_ratio, 2);

            UPDATE config
               SET tasa_cambio         = ROUND(v_tasa.valor, 2),
                   tasa_efectiva       = v_efec_new,
                   ultima_actualizacion = NOW()
             WHERE id = 1;

            v_alineada := TRUE;
        END IF;
    END IF;

    RETURN jsonb_build_object(
        'success', TRUE,
        'aplicadas', v_cuantas,
        'config_alineada', v_alineada,
        'tasa_anterior', v_base_ant,
        'vigente', CASE WHEN v_tasa IS NULL THEN NULL
                        ELSE jsonb_build_object(
                            'valor', v_tasa.valor,
                            'fecha_valor', v_tasa.fecha_valor,
                            'fuente', v_tasa.fuente) END
    );
END;
$function$;

COMMENT ON FUNCTION public.aplicar_tasas_vencidas() IS
    'Cron de las 7 am. Marca aplicada lo que llegó a su fecha valor y alinea '
    'config con la tasa vigente, conservando el factor del aumento acumulado. '
    'La firma manual sigue pudiendo corregir o adelantar después.';

NOTIFY pgrst, 'reload schema';

COMMIT;
