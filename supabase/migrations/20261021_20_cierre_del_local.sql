-- ============================================================
-- 20261021_20_cierre_del_local.sql
--
-- Bloqueo del local: el comercio no abre, y no se pueden hacer pedidos.
--
-- POR QUE EN LA BASE Y NO EN LA PANTALLA
--
-- Esconder el botón "Agregar" no cierra nada. Un cliente con la página
-- abierta desde ayer, o alguien que escribe la dirección a mano, seguiría
-- pudiendo pedir. Es como poner el cartel de "cerrado" en la puerta y dejar
-- la caja registradora prendida.
--
-- Acá el candado es real: `crear_pedido_con_reserva()` y `crear_reserva()`
-- se niegan a crear nada si el local está cerrado. La pantalla bloqueada es
-- solo la consecuencia visible.
--
-- LA CARTA SE SIGUE VIENDO
--
-- Decisión del dueño: el cliente tiene que poder navegar el menú, tocar las
-- tarjetas, ver los precios del día y hasta el despiece de ingredientes. Lo
-- único que no puede es armar el pedido. Por eso el cierre NO oculta el menú:
-- solo impide confirmar.
--
-- EL AUMENTO NO SE DETIENE
--
-- El local esté cerrado no significa que la inflación se haya detenido. El
-- aumento diario y el acumulado siguen corriendo. Lo que se congela es vender,
-- no la tasa.
--
-- Idempotente.
-- ============================================================

BEGIN;

-- ============================================================
-- Tabla de cierres
-- ============================================================
--
-- Se guarda un REGISTRO por cierre, no un simple booleano:
--
--   · queda el historial de por qué cerró cada vez
--   · se puede programar a futuro (desde/hasta en el futuro)
--   · se puede desactivar sin borrar, y queda quién lo hizo y cuándo
--
-- `desde`/`hasta` en NULL significa "sin límite" por ese lado.
CREATE TABLE IF NOT EXISTS cierre_local (
    id            BIGSERIAL PRIMARY KEY,
    motivo        TEXT        NOT NULL,
    -- Mensaje que ve el visitante. Lo escribe el admin, no está hardcodeado:
    -- "Cerrado por duelo" no se lee igual que "Volvemos el lunes por
    -- inventario", y solo el dueño sabe cuál corresponde.
    mensaje       TEXT        NOT NULL,
    desde         TIMESTAMPTZ,             -- NULL = desde ya
    hasta         TIMESTAMPTZ,             -- NULL = sin fecha de fin
    activo        BOOLEAN     NOT NULL DEFAULT TRUE,
    creado_por    TEXT,
    creado_en     TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    desactivado_por TEXT,
    desactivado_en  TIMESTAMPTZ,
    -- Cuando el admin toca "Desactivar" escribimos acá. Es distinto de
    -- borrar: el historial queda.
    CONSTRAINT cierre_fechas_coherentes
        CHECK (desde IS NULL OR hasta IS NULL OR hasta > desde),
    CONSTRAINT cierre_mensaje_no_vacio
        CHECK (length(btrim(mensaje)) > 0)
);

CREATE INDEX IF NOT EXISTS idx_cierre_local_activo
    ON cierre_local(activo, desde, hasta) WHERE activo = TRUE;

COMMENT ON TABLE cierre_local IS
    'Cierres del local. Si hay una fila activa cuya ventana incluye AHORA, no se pueden crear pedidos.';

-- ============================================================
-- La función que responde "¿está abierto?"
-- ============================================================

CREATE OR REPLACE FUNCTION public.local_esta_abierto(p_momento TIMESTAMPTZ DEFAULT NOW())
RETURNS BOOLEAN
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path TO 'public'
AS $$
    -- Abierto = NO existe ningún cierre activo que cubra este momento.
    --
    -- Un cierre cubre el momento si:
    --   · empezó antes (o no tiene inicio), y
    --   · todavía no terminó (o no tiene fin).
    SELECT NOT EXISTS (
        SELECT 1
          FROM cierre_local c
         WHERE c.activo = TRUE
           AND (c.desde IS NULL OR c.desde <= p_momento)
           AND (c.hasta IS NULL OR c.hasta >= p_momento)
    );
$$;

-- ============================================================
-- Qué mensaje mostrar
-- ============================================================
--
-- Devuelve el cierre vigente, o nada si está abierto. La pantalla del cliente
-- usa esto para pintar la marca y el mensaje del admin.
--
-- Si hubiera más de un cierre vigente (no debería), gana el más reciente.
CREATE OR REPLACE FUNCTION public.cierre_vigente(p_momento TIMESTAMPTZ DEFAULT NOW())
RETURNS TABLE (hay_cierre BOOLEAN, motivo TEXT, mensaje TEXT,
               desde TIMESTAMPTZ, hasta TIMESTAMPTZ)
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path TO 'public'
AS $$
    SELECT TRUE, c.motivo, c.mensaje, c.desde, c.hasta
      FROM cierre_local c
     WHERE c.activo = TRUE
       AND (c.desde IS NULL OR c.desde <= p_momento)
       AND (c.hasta IS NULL OR c.hasta >= p_momento)
     ORDER BY c.creado_en DESC
     LIMIT 1;
$$;

-- ============================================================
-- Crear / desactivar cierres  (SOLO ADMIN)
-- ============================================================

CREATE OR REPLACE FUNCTION public.crear_cierre_local(
    p_motivo  TEXT,
    p_mensaje TEXT,
    p_desde   TIMESTAMPTZ DEFAULT NULL,
    p_hasta   TIMESTAMPTZ DEFAULT NULL
)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $$
DECLARE
    v_id BIGINT;
BEGIN
    -- Solo admin. El cajero NO puede cerrar ni reabrir el local: ese es un
    -- dato del negocio, no de la operación de caja.
    --
    -- `COALESCE(...) IS NOT TRUE` y no `IF NOT ...`: sin sesión, es_admin()
    -- devuelve NULL, y `IF NOT NULL` no entra en la rama. Sería un agujero.
    IF COALESCE(public.es_admin(), false) IS NOT TRUE THEN
        RETURN jsonb_build_object('success', false,
                                  'error', 'Solo un administrador puede cerrar el local');
    END IF;

    IF p_mensaje IS NULL OR length(btrim(p_mensaje)) = 0 THEN
        RETURN jsonb_build_object('success', false,
                                  'error', 'El mensaje para el cliente no puede estar vacío');
    END IF;

    IF p_desde IS NOT NULL AND p_hasta IS NOT NULL AND p_hasta <= p_desde THEN
        RETURN jsonb_build_object('success', false,
                                  'error', 'La fecha de fin tiene que ser posterior a la de inicio');
    END IF;

    INSERT INTO cierre_local (motivo, mensaje, desde, hasta, creado_por)
    VALUES (COALESCE(NULLIF(btrim(p_motivo), ''), 'Cierre del local'),
            btrim(p_mensaje), p_desde, p_hasta, public.rol_actual()::TEXT)
    RETURNING id INTO v_id;

    RETURN jsonb_build_object(
        'success', TRUE,
        'id', v_id,
        'abierto_ahora', public.local_esta_abierto(),
        'desde', p_desde,
        'hasta', p_hasta
    );
END;
$$;

-- "Desactivar" no borra: marca el cierre como inactivo y deja constancia de
-- quién reabrió. Así queda historial de por qué paró el local cada vez.
CREATE OR REPLACE FUNCTION public.desactivar_cierre_local(p_id BIGINT DEFAULT NULL)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $$
DECLARE
    v_cerrados INTEGER;
BEGIN
    IF COALESCE(public.es_admin(), false) IS NOT TRUE THEN
        RETURN jsonb_build_object('success', false,
                                  'error', 'Solo un administrador puede reabrir el local');
    END IF;

    IF p_id IS NULL THEN
        -- Sin id: desactiva TODOS los cierres activos. Es el botón
        -- "Desactivar" del panel, que tiene que dejar el local operativo sí o sí.
        UPDATE cierre_local
           SET activo = FALSE,
               desactivado_por = public.rol_actual()::TEXT,
               desactivado_en  = NOW()
         WHERE activo = TRUE;
    ELSE
        UPDATE cierre_local
           SET activo = FALSE,
               desactivado_por = public.rol_actual()::TEXT,
               desactivado_en  = NOW()
         WHERE id = p_id AND activo = TRUE;
    END IF;

    GET DIAGNOSTICS v_cerrados = ROW_COUNT;

    RETURN jsonb_build_object(
        'success', TRUE,
        'cierres_desactivados', v_cerrados,
        'abierto_ahora', public.local_esta_abierto()
    );
END;
$$;

-- ============================================================
-- El candado: crear_pedido_con_reserva se niega si está cerrado
-- ============================================================
--
-- Se reemplaza la función entera para meter el control al principio. El resto
-- del cuerpo queda igual: no se toca la lógica de stock ni de reserva.
DO $$
DECLARE
    v_def TEXT;
BEGIN
    SELECT pg_get_functiondef(p.oid) INTO v_def
      FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace
     WHERE n.nspname = 'public' AND p.proname = 'crear_pedido_con_reserva';

    IF v_def IS NULL THEN
        RAISE NOTICE 'crear_pedido_con_reserva no existe; se omite el candado';
    ELSIF v_def LIKE '%local_esta_abierto%' THEN
        RAISE NOTICE 'crear_pedido_con_reserva ya tiene el candado';
    ELSE
        -- Insertar el control justo después del BEGIN del cuerpo.
        v_def := replace(v_def, E'BEGIN\n    -- ---------- validaciones ----------',
            E'BEGIN\n'
            || E'    -- ---------- candado del local ----------\n'
            || E'    --\n'
            || E'    -- Si el local está cerrado, no se crea NADA. Va antes que cualquier\n'
            || E'    -- otra validación: no tiene sentido revisar stock de un pedido que\n'
            || E'    -- no debería existir.\n'
            || E'    IF NOT public.local_esta_abierto() THEN\n'
            || E'        RAISE EXCEPTION ''El local está cerrado en este momento''\n'
            || E'            USING ERRCODE = ''P0001'';\n'
            || E'    END IF;\n\n'
            || E'    -- ---------- validaciones ----------');
        EXECUTE v_def;
        RAISE NOTICE 'candado agregado a crear_pedido_con_reserva';
    END IF;
END $$;

DO $$
DECLARE
    v_def TEXT;
BEGIN
    SELECT pg_get_functiondef(p.oid) INTO v_def
      FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace
     WHERE n.nspname = 'public' AND p.proname = 'crear_reserva';

    IF v_def IS NULL THEN
        RAISE NOTICE 'crear_reserva no existe; se omite el candado';
    ELSIF v_def LIKE '%local_esta_abierto%' THEN
        RAISE NOTICE 'crear_reserva ya tiene el candado';
    ELSE
        v_def := replace(v_def, E'BEGIN\n    -- ----------',
            E'BEGIN\n'
            || E'    -- ---------- candado del local ----------\n'
            || E'    -- Reservar es pedir: si el local está cerrado, tampoco se puede.\n'
            || E'    IF NOT public.local_esta_abierto() THEN\n'
            || E'        RAISE EXCEPTION ''El local está cerrado en este momento''\n'
            || E'            USING ERRCODE = ''P0001'';\n'
            || E'    END IF;\n\n'
            || E'    -- ----------');
        IF v_def NOT LIKE '%local_esta_abierto%' THEN
            RAISE NOTICE 'crear_reserva: no se encontró el patrón de anclaje';
        ELSE
            EXECUTE v_def;
            RAISE NOTICE 'candado agregado a crear_reserva';
        END IF;
    END IF;
END $$;

-- ============================================================
-- Permisos
-- ============================================================
--
-- `cierre_vigente` lo lee cualquiera (el cliente necesita el mensaje).
-- Crear y desactivar, solo con sesión; la validación de rol va adentro.
GRANT EXECUTE ON FUNCTION public.local_esta_abierto(TIMESTAMPTZ) TO anon, authenticated;
GRANT EXECUTE ON FUNCTION public.cierre_vigente(TIMESTAMPTZ)      TO anon, authenticated;
GRANT EXECUTE ON FUNCTION public.crear_cierre_local(TEXT, TEXT, TIMESTAMPTZ, TIMESTAMPTZ) TO authenticated;
GRANT EXECUTE ON FUNCTION public.desactivar_cierre_local(BIGINT) TO authenticated;

-- La tabla queda cerrada: se lee y se escribe solo por las funciones.
ALTER TABLE cierre_local ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS cierre_local_solo_admin ON cierre_local;
CREATE POLICY cierre_local_solo_admin ON cierre_local
    FOR ALL TO authenticated
    USING (COALESCE(public.es_admin(), false))
    WITH CHECK (COALESCE(public.es_admin(), false));

NOTIFY pgrst, 'reload schema';

COMMIT;
