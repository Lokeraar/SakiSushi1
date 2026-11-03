-- ─────────────────────────────────────────────────────────────────────────
-- 47 · La columna `inventario.id` ahora se genera sola
--
-- PROBLEMA
--   `id` es `text NOT NULL` sin valor por defecto. El panel inserta
--   ingredientes sin pasar `id`, así que la base rechaza el guardado:
--
--     ERROR: null value in column "id" of relation "inventario"
--            violates not-null constraint
--
--   Crear un ingrediente nuevo falla desde la interfaz.
--
-- ARREGLO
--   Un valor por defecto que genera un identificador único por fila:
--   `ing_` + un UUID aleatorio. Cada ingrediente nace con el suyo, igual
--   que los que ya existen (`ing_<uuid>_<n>`). No comparten valor.
--
--   El formato imita al existente. El sufijo numérico de los viejos era un
--   contador de la carga inicial; no hace falta para los nuevos, porque el
--   UUID ya garantiza unicidad.
--
-- ALCANCE
--   Solo afecta a los INSERT que no manden `id`. Los ingredientes actuales
--   conservan su identificador intacto: no se reescribe ninguna fila.
--
--   Idempotente: se puede ejecutar dos veces sin efecto adicional.
-- ─────────────────────────────────────────────────────────────────────────

ALTER TABLE public.inventario
    ALTER COLUMN id SET DEFAULT ('ing_' || gen_random_uuid()::text);

COMMENT ON COLUMN public.inventario.id IS
    'Identificador del ingrediente. Se genera solo (ing_<uuid>) cuando el INSERT no lo trae.';
