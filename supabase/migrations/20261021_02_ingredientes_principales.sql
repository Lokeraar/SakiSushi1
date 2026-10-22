-- ============================================================
-- 20261021_02_ingredientes_principales.sql
--
-- Agrega la marca "principal" a los ingredientes de cada receta.
--
-- REGLA DE NEGOCIO (decidida 22-oct-2026):
--   - Si falta un ingrediente PRINCIPAL  -> el platillo NO se puede preparar.
--     Se bloquea: tarjeta grisácea, "Agotado", sin botón de agregar.
--   - Si falta uno SECUNDARIO            -> el platillo SÍ es ordenable.
--     Se avisa al cliente, pero no se impide la compra.
--
-- El stock de un platillo se DERIVA de sus ingredientes:
--   disponibles = min( floor((inventario.stock - inventario.reservado) / cantidad_receta) )
-- Este campo "principal" no cambia ese cálculo, solo decide qué faltante bloquea.
--
-- Idempotente: se puede correr varias veces sin daño.
-- ============================================================

BEGIN;

-- ---------- 1. función auxiliar: marcar un ingrediente como principal ----------

CREATE OR REPLACE FUNCTION public.marcar_ingrediente_principal(
    p_platillo TEXT,
    p_prefijo_ing TEXT
) RETURNS INT
LANGUAGE plpgsql
AS $$
DECLARE
    v_nuevo JSONB;
    v_afectados INT;
BEGIN
    UPDATE menu m
       SET ingredientes = COALESCE((
            SELECT jsonb_object_agg(
                       key,
                       CASE WHEN key LIKE p_prefijo_ing || '%'
                            THEN value || '{"principal": true}'::jsonb
                            ELSE COALESCE(value, '{}'::jsonb) || '{"principal": false}'::jsonb
                       END
                   )
              FROM jsonb_each(m.ingredientes)
           ), '{}'::jsonb)
     WHERE m.nombre = p_platillo;

    GET DIAGNOSTICS v_afectados = ROW_COUNT;
    RETURN v_afectados;
END;
$$;

-- Garantiza que todos los ingredientes tengan la clave (false por defecto)
UPDATE menu
   SET ingredientes = COALESCE((
        SELECT jsonb_object_agg(key, COALESCE(value,'{}'::jsonb) || '{"principal": false}'::jsonb)
          FROM jsonb_each(ingredientes)
       ), '{}'::jsonb)
 WHERE ingredientes IS NOT NULL
   AND EXISTS (
        SELECT 1 FROM jsonb_each(ingredientes) e
         WHERE NOT (e.value ? 'principal')
   );

-- ---------- 2. asignar los principales reales ----------
--
-- Criterio: el principal es el ingrediente que DEFINE el platillo para el
-- cliente. Sin él, el platillo no es ese platillo.
-- El arroz y el alga son base de todo roll: van como principales porque sin
-- arroz no hay roll, aunque el que nombra al platillo sea el relleno.

-- Criterio: el principal es el ingrediente que DEFINE el platillo para el
-- cliente. Sin él, el platillo no es ese platillo. El arroz y el alga son
-- base de todo roll: se marcan principales porque sin arroz no hay roll,
-- aunque quien nombre al platillo sea el relleno.
--
-- Se hace con una sola sentencia por platillo: marcar por nombre de
-- ingrediente, que es estable y legible. (Antes usaba jsonb_object_keys en
-- un UPDATE, que Postgres no permite.)

-- California Roll: cangrejo + arroz + alga
UPDATE menu SET ingredientes = (
    SELECT jsonb_object_agg(key,
             CASE WHEN value->>'nombre' IN ('Arroz para sushi','Alga nori','Cangrejo (imitación)')
                  THEN value || '{"principal": true}'::jsonb
                  ELSE value || '{"principal": false}'::jsonb END)
      FROM jsonb_each(ingredientes))
 WHERE nombre = 'California Roll';

-- Philadelphia Roll: salmón + arroz + alga
UPDATE menu SET ingredientes = (
    SELECT jsonb_object_agg(key,
             CASE WHEN value->>'nombre' IN ('Arroz para sushi','Alga nori','Salmón fresco')
                  THEN value || '{"principal": true}'::jsonb
                  ELSE value || '{"principal": false}'::jsonb END)
      FROM jsonb_each(ingredientes))
 WHERE nombre = 'Philadelphia Roll';

-- Spicy Tuna Roll: atún + arroz + alga
UPDATE menu SET ingredientes = (
    SELECT jsonb_object_agg(key,
             CASE WHEN value->>'nombre' IN ('Arroz para sushi','Alga nori','Atún fresco')
                  THEN value || '{"principal": true}'::jsonb
                  ELSE value || '{"principal": false}'::jsonb END)
      FROM jsonb_each(ingredientes))
 WHERE nombre = 'Spicy Tuna Roll';

-- Dragon Roll: anguila + arroz + alga
UPDATE menu SET ingredientes = (
    SELECT jsonb_object_agg(key,
             CASE WHEN value->>'nombre' IN ('Arroz para sushi','Alga nori','Anguila')
                  THEN value || '{"principal": true}'::jsonb
                  ELSE value || '{"principal": false}'::jsonb END)
      FROM jsonb_each(ingredientes))
 WHERE nombre = 'Dragon Roll';

-- Sashimi: el salmón es TODO el platillo
UPDATE menu SET ingredientes = (
    SELECT jsonb_object_agg(key, value || '{"principal": true}'::jsonb)
      FROM jsonb_each(ingredientes))
 WHERE nombre = 'Sashimi de Salmón (5 pcs)';

-- Nigiri: arroz y atún, ambos imprescindibles
UPDATE menu SET ingredientes = (
    SELECT jsonb_object_agg(key, value || '{"principal": true}'::jsonb)
      FROM jsonb_each(ingredientes))
 WHERE nombre = 'Nigiri de Atún (2 pcs)';

DROP FUNCTION public.marcar_ingrediente_principal(TEXT, TEXT);

-- ---------- 3. función: ¿se puede preparar este platillo? ----------
--
-- Devuelve:
--   disponible_principal : false si falta un ingrediente principal -> BLOQUEA
--   faltantes_secundarios: lista de secundarios que faltan -> solo avisa
--   maximo_preparables   : cuántas unidades se pueden armar

CREATE OR REPLACE FUNCTION public.disponibilidad_platillo(p_platillo_id TEXT)
RETURNS JSONB
LANGUAGE plpgsql
STABLE
AS $$
DECLARE
    v_ingredientes JSONB;
    v_clave        TEXT;
    v_info         JSONB;
    v_total        NUMERIC;
    v_libre        NUMERIC;
    v_cant         NUMERIC;
    v_platos       NUMERIC;
    v_minimo       NUMERIC := NULL;
    v_es_principal BOOLEAN;
    v_faltan_princ TEXT[] := ARRAY[]::TEXT[];
    v_faltan_sec   TEXT[] := ARRAY[]::TEXT[];
BEGIN
    SELECT ingredientes INTO v_ingredientes FROM menu WHERE id = p_platillo_id;

    IF v_ingredientes IS NULL OR jsonb_typeof(v_ingredientes) <> 'object' THEN
        RETURN jsonb_build_object(
            'disponible', false,
            'maximo_preparables', 0,
            'faltan_principales', jsonb_build_array('sin receta'),
            'faltan_secundarios', '[]'::jsonb
        );
    END IF;

    FOR v_clave, v_info IN SELECT key, value FROM jsonb_each(v_ingredientes)
    LOOP
        v_cant         := COALESCE((v_info->>'cantidad')::NUMERIC, 0);
        v_es_principal := COALESCE((v_info->>'principal')::BOOLEAN, false);

        SELECT (stock - reservado) INTO v_total FROM inventario WHERE id = v_clave;

        IF NOT FOUND THEN
            -- ingrediente de la receta que no existe en inventario
            IF v_es_principal THEN
                v_faltan_princ := array_append(v_faltan_princ, COALESCE(v_info->>'nombre', v_clave));
            ELSE
                v_faltan_sec := array_append(v_faltan_sec, COALESCE(v_info->>'nombre', v_clave));
            END IF;
            v_platos := 0;
        ELSE
            v_libre := GREATEST(0, v_total);
            IF v_cant > 0 THEN
                v_platos := floor(v_libre / v_cant);
            ELSE
                v_platos := 999999;
            END IF;

            IF v_platos <= 0 THEN
                IF v_es_principal THEN
                    v_faltan_princ := array_append(v_faltan_princ, COALESCE(v_info->>'nombre', v_clave));
                ELSE
                    v_faltan_sec := array_append(v_faltan_sec, COALESCE(v_info->>'nombre', v_clave));
                END IF;
            END IF;
        END IF;

        v_minimo := LEAST(COALESCE(v_minimo, v_platos), v_platos);
    END LOOP;

    RETURN jsonb_build_object(
        'disponible',          COALESCE(array_length(v_faltan_princ,1), 0) = 0,
        'maximo_preparables',  COALESCE(v_minimo, 0),
        'faltan_principales',  to_jsonb(v_faltan_princ),
        'faltan_secundarios',  to_jsonb(v_faltan_sec)
    );
END;
$$;

-- Vista para que el frontend traiga todo de una sola consulta
CREATE OR REPLACE VIEW public.menu_disponibilidad AS
SELECT m.id,
       m.nombre,
       public.disponibilidad_platillo(m.id) AS disponibilidad
  FROM menu m;

GRANT SELECT ON public.menu_disponibilidad TO anon, authenticated;
GRANT EXECUTE ON FUNCTION public.disponibilidad_platillo(TEXT) TO anon, authenticated;

COMMIT;
