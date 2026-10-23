-- ============================================================
-- 20261021_15_asignar_seccion_a_platillo.sql
--
-- Permite resolver un platillo huérfano sin salir de la pantalla.
--
-- QUÉ FALTABA
--
-- El paso 3 avisa de los huérfanos pero no daba forma de arreglarlos: había
-- que entrar a editar el platillo y reescribir la categoría a mano. Un aviso
-- que no lleva a una acción es solo un reproche.
--
-- Esta función hace dos cosas en una transacción:
--   1. Le asigna categoría (y opcionalmente subcategoría) al platillo.
--   2. Valida que esa sección exista de verdad, para no cambiar un huérfano
--      por otro huérfano con otro nombre.
--
-- Idempotente.
-- ============================================================

BEGIN;

CREATE OR REPLACE FUNCTION public.asignar_seccion_a_platillo(
    p_platillo_id TEXT,
    p_categoria   TEXT,
    p_subcategoria TEXT DEFAULT NULL
)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
    v_cat TEXT := NULLIF(TRIM(COALESCE(p_categoria, '')), '');
    v_sub TEXT := NULLIF(TRIM(COALESCE(p_subcategoria, '')), '');
BEGIN
    IF COALESCE(public.es_admin(), false) IS NOT TRUE THEN
        RAISE EXCEPTION 'Solo un administrador puede asignar secciones'
            USING ERRCODE = '42501';
    END IF;

    IF NOT EXISTS (SELECT 1 FROM menu WHERE id = p_platillo_id) THEN
        RETURN jsonb_build_object('success', false, 'error', 'El platillo no existe');
    END IF;

    IF v_cat IS NULL THEN
        RETURN jsonb_build_object('success', false, 'error', 'Falta la sección');
    END IF;

    -- El destino tiene que ser una sección madre real. Si no, el platillo
    -- seguiría siendo huérfano y el aviso no bajaría nunca.
    IF NOT EXISTS (
        SELECT 1 FROM secciones WHERE madre_id IS NULL AND nombre = v_cat
    ) THEN
        RETURN jsonb_build_object('success', false,
            'error', 'La sección "' || v_cat || '" no existe');
    END IF;

    -- Si se indica subcategoría, tiene que ser hija de esa madre.
    IF v_sub IS NOT NULL AND NOT EXISTS (
        SELECT 1
          FROM secciones h
          JOIN secciones m ON m.id = h.madre_id
         WHERE h.nombre = v_sub AND m.nombre = v_cat
    ) THEN
        RETURN jsonb_build_object('success', false,
            'error', 'La subsección "' || v_sub || '" no pertenece a "' || v_cat || '"');
    END IF;

    UPDATE menu
       SET categoria    = v_cat,
           subcategoria = v_sub,
           updated_at   = NOW()
     WHERE id = p_platillo_id;

    RETURN jsonb_build_object(
        'success',       true,
        'platillo_id',   p_platillo_id,
        'categoria',     v_cat,
        'subcategoria',  v_sub,
        -- Cuántos huérfanos quedan después de esto, para que el admin vea
        -- en el acto si ya terminó o le falta alguno.
        'huerfanos_restantes', (SELECT COUNT(*) FROM platillos_huerfanos)
    );
END;
$$;

REVOKE ALL ON FUNCTION public.asignar_seccion_a_platillo(TEXT, TEXT, TEXT) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.asignar_seccion_a_platillo(TEXT, TEXT, TEXT) TO authenticated;

COMMENT ON FUNCTION public.asignar_seccion_a_platillo IS
    'Asigna categoría y subcategoría a un platillo, validando que las secciones existan. Para resolver huérfanos.';

NOTIFY pgrst, 'reload schema';

COMMIT;
