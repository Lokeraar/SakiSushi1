-- ============================================================
-- 20261021_14_secciones_admin_y_huerfanos.sql
--
-- Da al admin las herramientas para administrar la carta, y hace VISIBLES
-- los platillos que quedan sin sección.
--
-- LO QUE PIDIO EL DUEÑO
--
-- 1. Renombrar una sección mueve sus platillos con ella, y tiene que ser
--    TODO O NADA: o se mueven los 4, o no se mueve ninguno. Un renombre a
--    medias dejaría 2 platos con el nombre nuevo y 2 con el viejo, y los
--    viejos desaparecerían de la carta.
--
-- 2. Borrar una sección SÍ puede dejar platillos huérfanos. No se bloquea.
--    Pero el huérfano tiene que GRITAR en el admin: en el tablero, junto a
--    las alertas de inventario bajo, y en la lista de platillos.
--
-- POR QUE TODO O NADA IMPORTA
--
-- menu.categoria es TEXTO y no tiene clave foránea: nada impide que un plato
-- apunte a una categoría que ya no existe. Esa es justamente la razón por la
-- que los huérfanos son posibles. La función de renombre toca dos tablas
-- (secciones y menu) y por eso va dentro de una transacción: si falla una
-- parte, Postgres deshace la otra.
--
-- Idempotente.
-- ============================================================

BEGIN;


-- ============================================================
-- 1. Qué platillos están huérfanos
--
--    Un platillo es huérfano cuando su categoria no coincide con el nombre
--    de ninguna sección madre, o cuando tiene subcategoria y esa subcategoría
--    no existe como sección hija.
--
--    Vista, no tabla: se calcula al vuelo y nunca queda desactualizada.
-- ============================================================

CREATE OR REPLACE VIEW platillos_huerfanos AS
SELECT m.id,
       m.nombre,
       m.categoria,
       m.subcategoria,
       CASE
           WHEN NOT EXISTS (
               SELECT 1 FROM secciones s
                WHERE s.madre_id IS NULL AND s.nombre = m.categoria
           ) THEN 'seccion_inexistente'
           WHEN m.subcategoria IS NOT NULL AND NOT EXISTS (
               SELECT 1 FROM secciones s
                WHERE s.madre_id IS NOT NULL AND s.nombre = m.subcategoria
           ) THEN 'subseccion_inexistente'
           ELSE 'ok'
       END AS motivo
  FROM menu m
 WHERE NOT EXISTS (
           SELECT 1 FROM secciones s
            WHERE s.madre_id IS NULL AND s.nombre = m.categoria
       )
    OR (m.subcategoria IS NOT NULL AND NOT EXISTS (
           SELECT 1 FROM secciones s
            WHERE s.madre_id IS NOT NULL AND s.nombre = m.subcategoria
       ));

COMMENT ON VIEW platillos_huerfanos IS
    'Platillos cuya categoría o subcategoría ya no existe como sección. No se ven en ninguna parte de la carta del cliente.';

GRANT SELECT ON platillos_huerfanos TO anon, authenticated;


-- ============================================================
-- 2. Crear una sección
-- ============================================================

CREATE OR REPLACE FUNCTION public.crear_seccion(
    p_nombre     TEXT,
    p_madre_id   TEXT DEFAULT NULL,
    p_icono      TEXT DEFAULT NULL
)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
    v_id    TEXT;
    v_orden INTEGER;
BEGIN
    IF COALESCE(public.es_admin(), false) IS NOT TRUE THEN
        RAISE EXCEPTION 'Solo un administrador puede crear secciones'
            USING ERRCODE = '42501';
    END IF;

    IF COALESCE(TRIM(p_nombre), '') = '' THEN
        RETURN jsonb_build_object('success', false, 'error', 'La sección necesita un nombre');
    END IF;

    -- Los nombres son el vínculo con menu.categoria: dos secciones con el
    -- mismo nombre harían que un plato aparezca en las dos.
    IF EXISTS (SELECT 1 FROM secciones WHERE LOWER(nombre) = LOWER(TRIM(p_nombre))) THEN
        RETURN jsonb_build_object('success', false,
            'error', 'Ya existe una sección con ese nombre');
    END IF;

    IF p_madre_id IS NOT NULL AND NOT EXISTS (
        SELECT 1 FROM secciones WHERE id = p_madre_id AND madre_id IS NULL
    ) THEN
        RETURN jsonb_build_object('success', false,
            'error', 'La sección madre no existe o ella misma es una subsección');
    END IF;

    -- Se agrega al final de su grupo
    SELECT COALESCE(MAX(orden), 0) + 1 INTO v_orden
      FROM secciones
     WHERE madre_id IS NOT DISTINCT FROM p_madre_id;

    v_id := 'sec_' || gen_random_uuid()::text;

    INSERT INTO secciones (id, nombre, madre_id, orden, icono)
    VALUES (v_id, TRIM(p_nombre), p_madre_id, v_orden, p_icono);

    RETURN jsonb_build_object('success', true, 'id', v_id, 'orden', v_orden);
END;
$$;


-- ============================================================
-- 3. Renombrar: TODO O NADA
--
--    Si la sección tiene platos, se mueven con ella. Si algo falla, no se
--    renombra nada: la función entera corre en una transacción.
-- ============================================================

CREATE OR REPLACE FUNCTION public.renombrar_seccion(
    p_id        TEXT,
    p_nuevo     TEXT,
    p_confirmar BOOLEAN DEFAULT FALSE
)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
    v_actual   RECORD;
    v_nombre   TEXT := TRIM(COALESCE(p_nuevo, ''));
    v_afectados INTEGER := 0;
BEGIN
    IF COALESCE(public.es_admin(), false) IS NOT TRUE THEN
        RAISE EXCEPTION 'Solo un administrador puede renombrar secciones'
            USING ERRCODE = '42501';
    END IF;

    SELECT * INTO v_actual FROM secciones WHERE id = p_id;
    IF v_actual.id IS NULL THEN
        RETURN jsonb_build_object('success', false, 'error', 'La sección no existe');
    END IF;

    IF v_nombre = '' THEN
        RETURN jsonb_build_object('success', false, 'error', 'El nombre no puede quedar vacío');
    END IF;

    IF v_nombre = v_actual.nombre THEN
        RETURN jsonb_build_object('success', true, 'sin_cambios', true, 'afectados', 0);
    END IF;

    IF EXISTS (SELECT 1 FROM secciones WHERE LOWER(nombre) = LOWER(v_nombre) AND id <> p_id) THEN
        RETURN jsonb_build_object('success', false,
            'error', 'Ya existe otra sección con ese nombre');
    END IF;

    -- Cuántos platillos se mueven (para el aviso previo del admin)
    IF v_actual.madre_id IS NULL THEN
        SELECT COUNT(*) INTO v_afectados FROM menu WHERE categoria = v_actual.nombre;
    ELSE
        SELECT COUNT(*) INTO v_afectados FROM menu WHERE subcategoria = v_actual.nombre;
    END IF;

    -- Sin confirmación: no se toca nada, solo se informa qué se movería.
    -- Esto es lo que permite al admin ver la lista ANTES de aceptar.
    IF p_confirmar IS NOT TRUE THEN
        RETURN jsonb_build_object(
            'success',       false,
            'requiere_confirmacion', true,
            'afectados',     v_afectados,
            'nombre_viejo',  v_actual.nombre,
            'nombre_nuevo',  v_nombre
        );
    END IF;

    -- ---- Desde acá, todo o nada ----

    UPDATE secciones
       SET nombre = v_nombre, updated_at = NOW()
     WHERE id = p_id;

    IF v_actual.madre_id IS NULL THEN
        UPDATE menu
           SET categoria = v_nombre, updated_at = NOW()
         WHERE categoria = v_actual.nombre;
    ELSE
        UPDATE menu
           SET subcategoria = v_nombre, updated_at = NOW()
         WHERE subcategoria = v_actual.nombre;
    END IF;

    RETURN jsonb_build_object(
        'success',      true,
        'afectados',    v_afectados,
        'nombre_viejo', v_actual.nombre,
        'nombre_nuevo', v_nombre
    );
END;
$$;


-- ============================================================
-- 4. Qué se movería al borrar (aviso previo)
-- ============================================================

CREATE OR REPLACE FUNCTION public.detalle_borrado_seccion(p_id TEXT)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
    v_sec       RECORD;
    v_platos    INTEGER := 0;
    v_hijas     INTEGER := 0;
    v_nombres   JSONB := '[]'::JSONB;
BEGIN
    IF COALESCE(public.es_admin(), false) IS NOT TRUE THEN
        RAISE EXCEPTION 'Solo un administrador puede consultar esto'
            USING ERRCODE = '42501';
    END IF;

    SELECT * INTO v_sec FROM secciones WHERE id = p_id;
    IF v_sec.id IS NULL THEN
        RETURN jsonb_build_object('success', false, 'error', 'La sección no existe');
    END IF;

    SELECT COUNT(*) INTO v_hijas FROM secciones WHERE madre_id = p_id;

    IF v_sec.madre_id IS NULL THEN
        SELECT COUNT(*), COALESCE(jsonb_agg(nombre ORDER BY nombre), '[]'::JSONB)
          INTO v_platos, v_nombres
          FROM menu WHERE categoria = v_sec.nombre;
    ELSE
        SELECT COUNT(*), COALESCE(jsonb_agg(nombre ORDER BY nombre), '[]'::JSONB)
          INTO v_platos, v_nombres
          FROM menu WHERE subcategoria = v_sec.nombre;
    END IF;

    RETURN jsonb_build_object(
        'success',        true,
        'nombre',         v_sec.nombre,
        'platos',         v_platos,
        'nombres_platos', v_nombres,
        'subsecciones',   v_hijas
    );
END;
$$;


-- ============================================================
-- 5. Borrar una sección
--
--    Permitido aunque tenga platos: esos quedan huérfanos a propósito, y la
--    vista platillos_huerfanos los señala. El admin tiene que confirmar
--    habiendo visto cuántos son.
-- ============================================================

CREATE OR REPLACE FUNCTION public.eliminar_seccion(
    p_id        TEXT,
    p_confirmar BOOLEAN DEFAULT FALSE
)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
    v_detalle JSONB;
BEGIN
    IF COALESCE(public.es_admin(), false) IS NOT TRUE THEN
        RAISE EXCEPTION 'Solo un administrador puede eliminar secciones'
            USING ERRCODE = '42501';
    END IF;

    v_detalle := public.detalle_borrado_seccion(p_id);
    IF (v_detalle->>'success')::BOOLEAN IS NOT TRUE THEN
        RETURN v_detalle;
    END IF;

    IF p_confirmar IS NOT TRUE THEN
        RETURN jsonb_build_object(
            'success',               false,
            'requiere_confirmacion', true,
            'detalle',               v_detalle
        );
    END IF;

    -- Las subsecciones se van con ella (ON DELETE CASCADE en madre_id),
    -- pero sus platillos NO se tocan: quedan huérfanos y avisados.
    DELETE FROM secciones WHERE id = p_id;

    RETURN jsonb_build_object(
        'success', true,
        'detalle', v_detalle
    );
END;
$$;


-- ============================================================
-- 6. Reordenar y visibilidad
-- ============================================================

CREATE OR REPLACE FUNCTION public.reordenar_secciones(p_orden JSONB)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
    v_par RECORD;
    v_n   INTEGER := 0;
BEGIN
    IF COALESCE(public.es_admin(), false) IS NOT TRUE THEN
        RAISE EXCEPTION 'Solo un administrador puede reordenar secciones'
            USING ERRCODE = '42501';
    END IF;

    -- p_orden llega como [{"id":"sushi","orden":4}, ...]
    FOR v_par IN SELECT * FROM jsonb_array_elements(p_orden)
    LOOP
        UPDATE secciones
           SET orden = (v_par.value->>'orden')::INTEGER, updated_at = NOW()
         WHERE id = v_par.value->>'id';
        v_n := v_n + 1;
    END LOOP;

    RETURN jsonb_build_object('success', true, 'actualizadas', v_n);
END;
$$;

CREATE OR REPLACE FUNCTION public.cambiar_visibilidad_seccion(
    p_id      TEXT,
    p_visible BOOLEAN,
    p_desde   TIME DEFAULT NULL,
    p_hasta   TIME DEFAULT NULL
)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
    IF COALESCE(public.es_admin(), false) IS NOT TRUE THEN
        RAISE EXCEPTION 'Solo un administrador puede cambiar la visibilidad'
            USING ERRCODE = '42501';
    END IF;

    UPDATE secciones
       SET visible    = COALESCE(p_visible, visible),
           hora_desde = p_desde,
           hora_hasta = p_hasta,
           updated_at = NOW()
     WHERE id = p_id;

    RETURN jsonb_build_object('success', true);
END;
$$;


-- ---------- permisos ----------

REVOKE ALL ON FUNCTION public.crear_seccion(TEXT, TEXT, TEXT) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.renombrar_seccion(TEXT, TEXT, BOOLEAN) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.detalle_borrado_seccion(TEXT) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.eliminar_seccion(TEXT, BOOLEAN) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.reordenar_secciones(JSONB) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.cambiar_visibilidad_seccion(TEXT, BOOLEAN, TIME, TIME) FROM PUBLIC;

GRANT EXECUTE ON FUNCTION public.crear_seccion(TEXT, TEXT, TEXT) TO authenticated;
GRANT EXECUTE ON FUNCTION public.renombrar_seccion(TEXT, TEXT, BOOLEAN) TO authenticated;
GRANT EXECUTE ON FUNCTION public.detalle_borrado_seccion(TEXT) TO authenticated;
GRANT EXECUTE ON FUNCTION public.eliminar_seccion(TEXT, BOOLEAN) TO authenticated;
GRANT EXECUTE ON FUNCTION public.reordenar_secciones(JSONB) TO authenticated;
GRANT EXECUTE ON FUNCTION public.cambiar_visibilidad_seccion(TEXT, BOOLEAN, TIME, TIME) TO authenticated;

NOTIFY pgrst, 'reload schema';

COMMIT;
