-- ============================================================
-- 20261021_21_restaurar_es_admin.sql
--
-- DEFECTO CRITICO ENCONTRADO: un mock de pruebas quedó olvidado en la base.
--
-- `es_admin()` llamaba a `_t()`, y `_t()` estaba definida así:
--
--     SELECT 'admin'
--
-- O sea: devolvía 'admin' SIEMPRE, sin importar quién consultara. Efecto:
-- `es_admin()` daba verdadero para cualquier visitante, incluido un anónimo
-- sin sesión. Todo lo que se protege con es_admin() quedaba abierto.
--
-- Se detectó al probar el cierre del local: la función se negaba a cerrar sin
-- sesión de admin, pero lo cerró igual. El candado estaba bien escrito; el
-- que mentía era es_admin().
--
-- Se restaura la definición correcta y se elimina el mock.
--
-- Idempotente.
-- ============================================================

BEGIN;

-- 1) es_admin() vuelve a preguntar por el rol real.
CREATE OR REPLACE FUNCTION public.es_admin()
RETURNS boolean
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path TO 'public'
AS $$ SELECT public.rol_actual() = 'admin' $$;

-- 2) El mock se borra. Si algo más lo llamaba, es mejor que falle ruidosamente
--    a que siga mintiendo en silencio.
DROP FUNCTION IF EXISTS public._t();

-- 3) Verificación: en una conexión directa (sin JWT) es_admin() DEBE dar
--    false. Si diera true, el agujero sigue abierto.
DO $$
BEGIN
    IF public.es_admin() IS TRUE THEN
        RAISE EXCEPTION 'es_admin() sigue devolviendo true sin sesión: el agujero NO está cerrado';
    END IF;
    RAISE NOTICE 'es_admin() corregido: sin sesión devuelve %, como corresponde', public.es_admin();
END $$;

COMMIT;
