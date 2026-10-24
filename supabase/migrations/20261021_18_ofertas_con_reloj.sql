-- ============================================================
-- 20261021_18_ofertas_con_reloj.sql
--
-- Ofertas con fecha y hora, que se apagan SOLAS desde el servidor.
--
-- QUÉ PIDIÓ EL DUEÑO
--
-- Poder cargar una rebaja por tiempo limitado (temporada, mundial, Halloween,
-- martes de locos...) y que el admin NO tenga que acordarse de quitarla.
-- El sistema calcula solo cuándo está vigente.
--
-- LOS TRES DATOS QUE CARGA EL ADMIN
--
--   precio_oferta   el precio rebajado (en USD, igual que `precio`)
--   oferta_desde    desde cuándo
--   oferta_hasta    hasta cuándo
--
-- El PORCENTAJE de descuento NO lo carga nadie: lo calcula el sistema. Si el
-- admin cambia el precio normal, el descuento se recalcula solo y nunca queda
-- un cartel que diga "-20%" cuando en realidad es -15%.
--
-- POR QUÉ SE CALCULA EN LA BASE Y NO EN EL NAVEGADOR (forma A)
--
-- Si el cliente calculara "¿ya venció?", cada teléfono tendría su propia
-- respuesta según su reloj. Un cliente con la hora mal configurada vería la
-- oferta cuando ya terminó, o al revés.
--
-- Con la vigencia calculada en la base, el cliente, el cajero y los reportes
-- ven EXACTAMENTE lo mismo: lo que dice el servidor. Y no hace falta que nadie
-- abra el admin para que la oferta expire.
--
-- SE GUARDA LA OFERTA VENCIDA (no se borra)
--
-- Decisión del dueño: una oferta de Halloween que terminó queda guardada,
-- apagada, para poder reactivarla el año que viene sin volver a cargarla.
-- Por eso son columnas y no una tabla aparte que se vacía.
--
-- Idempotente.
-- ============================================================

BEGIN;

-- ============================================================
-- 1. Las tres columnas
-- ============================================================

ALTER TABLE menu ADD COLUMN IF NOT EXISTS precio_oferta NUMERIC;
ALTER TABLE menu ADD COLUMN IF NOT EXISTS oferta_desde  TIMESTAMPTZ;
ALTER TABLE menu ADD COLUMN IF NOT EXISTS oferta_hasta  TIMESTAMPTZ;

COMMENT ON COLUMN menu.precio_oferta IS
    'Precio rebajado en USD. NULL = el plato no tiene oferta cargada.';
COMMENT ON COLUMN menu.oferta_desde IS
    'Desde cuándo rige la oferta. NULL = sin límite de inicio.';
COMMENT ON COLUMN menu.oferta_hasta IS
    'Hasta cuándo rige la oferta. NULL = sin límite de fin.';

-- Índice para la consulta más frecuente: "¿qué ofertas están activas ahora?"
CREATE INDEX IF NOT EXISTS idx_menu_oferta_vigente
    ON menu(oferta_desde, oferta_hasta)
    WHERE precio_oferta IS NOT NULL;


-- ============================================================
-- 2. Una sola regla de vigencia, escrita UNA vez
--
--    Se usa una función y no se repite la condición en cada consulta.
--    Si mañana cambia la regla (por ejemplo, que la oferta empiece a las
--    00:00 del día siguiente), se cambia acá y todos los consumidores quedan
--    alineados.
-- ============================================================

CREATE OR REPLACE FUNCTION public.oferta_vigente(
    p_precio_oferta NUMERIC,
    p_desde         TIMESTAMPTZ,
    p_hasta         TIMESTAMPTZ
)
RETURNS BOOLEAN
LANGUAGE sql
STABLE
AS $$
    SELECT p_precio_oferta IS NOT NULL
       AND p_precio_oferta > 0
       AND (p_desde IS NULL OR p_desde <= NOW())
       AND (p_hasta IS NULL OR p_hasta > NOW());
$$;

COMMENT ON FUNCTION public.oferta_vigente(NUMERIC, TIMESTAMPTZ, TIMESTAMPTZ) IS
    'La única definición de "la oferta está activa ahora". La usan la vista pública y el admin.';


-- ============================================================
-- 3. Vista pública con el precio y el descuento ya resueltos
--
--    El navegador NO calcula nada: lee `precio_vigente` y `descuento_pct`.
--    Así el cliente y el cajero nunca pueden ver cosas distintas.
--
--    Ojo: `precio` sigue siendo el precio normal. La oferta no lo pisa,
--    porque si el admin borra el campo de oferta el plato tiene que volver
--    a su precio de siempre sin que nadie deshaga nada.
-- ============================================================

CREATE OR REPLACE VIEW menu_con_oferta AS
SELECT m.id,
       m.nombre,
       m.categoria,
       m.subcategoria,
       m.descripcion,
       m.imagen,
       m.ingredientes,
       m.disponible,
       m.precio                                   AS precio_normal,
       m.precio_oferta,
       m.oferta_desde,
       m.oferta_hasta,
       public.oferta_vigente(m.precio_oferta, m.oferta_desde, m.oferta_hasta)
                                                  AS oferta_activa,
       CASE
           WHEN public.oferta_vigente(m.precio_oferta, m.oferta_desde, m.oferta_hasta)
               THEN m.precio_oferta
           ELSE m.precio
       END                                        AS precio_vigente,
       CASE
           WHEN public.oferta_vigente(m.precio_oferta, m.oferta_desde, m.oferta_hasta)
                AND m.precio > 0
               THEN ROUND((1 - (m.precio_oferta / m.precio)) * 100)
           ELSE 0
       END                                        AS descuento_pct
  FROM menu m;

COMMENT ON VIEW menu_con_oferta IS
    'El menú con el precio y el descuento ya resueltos por el servidor. El navegador no calcula ofertas.';

GRANT SELECT ON menu_con_oferta TO anon, authenticated;


-- ============================================================
-- 4. Cargar, cambiar y quitar una oferta (solo admin)
-- ============================================================

CREATE OR REPLACE FUNCTION public.guardar_oferta_platillo(
    p_platillo_id   TEXT,
    p_precio_oferta NUMERIC,
    p_desde         TIMESTAMPTZ DEFAULT NULL,
    p_hasta         TIMESTAMPTZ DEFAULT NULL
)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
    v_precio NUMERIC;
BEGIN
    IF COALESCE(public.es_admin(), false) IS NOT TRUE THEN
        RAISE EXCEPTION 'Solo un administrador puede cargar ofertas'
            USING ERRCODE = '42501';
    END IF;

    SELECT precio INTO v_precio FROM menu WHERE id = p_platillo_id;
    IF v_precio IS NULL THEN
        RETURN jsonb_build_object('success', false, 'error', 'El platillo no existe');
    END IF;

    -- Quitar la oferta: dejar el plato como estaba. Es una acción válida y
    -- es lo que hace el botón "quitar oferta" del admin.
    IF p_precio_oferta IS NULL THEN
        UPDATE menu
           SET precio_oferta = NULL,
               oferta_desde  = NULL,
               oferta_hasta  = NULL,
               updated_at    = NOW()
         WHERE id = p_platillo_id;
        RETURN jsonb_build_object('success', true, 'oferta_activa', false);
    END IF;

    IF p_precio_oferta <= 0 THEN
        RETURN jsonb_build_object('success', false,
            'error', 'El precio de oferta tiene que ser mayor que cero');
    END IF;

    -- Una "oferta" más cara que el precio normal no es una oferta: es un
    -- error de tipeo, y en el menú se vería como un descuento negativo.
    IF p_precio_oferta >= v_precio THEN
        RETURN jsonb_build_object('success', false,
            'error', 'El precio de oferta (' || p_precio_oferta ||
                     ') tiene que ser menor que el precio normal (' || v_precio || ')');
    END IF;

    IF p_desde IS NOT NULL AND p_hasta IS NOT NULL AND p_hasta <= p_desde THEN
        RETURN jsonb_build_object('success', false,
            'error', 'La fecha de fin tiene que ser posterior a la de inicio');
    END IF;

    UPDATE menu
       SET precio_oferta = p_precio_oferta,
           oferta_desde  = p_desde,
           oferta_hasta  = p_hasta,
           updated_at    = NOW()
     WHERE id = p_platillo_id;

    RETURN jsonb_build_object(
        'success',        true,
        'oferta_activa',  public.oferta_vigente(p_precio_oferta, p_desde, p_hasta),
        'precio_normal',  v_precio,
        'precio_oferta',  p_precio_oferta,
        'descuento_pct',  ROUND((1 - (p_precio_oferta / v_precio)) * 100)
    );
END;
$$;

REVOKE ALL ON FUNCTION public.guardar_oferta_platillo(TEXT, NUMERIC, TIMESTAMPTZ, TIMESTAMPTZ) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.guardar_oferta_platillo(TEXT, NUMERIC, TIMESTAMPTZ, TIMESTAMPTZ) TO authenticated;


-- ============================================================
-- 5. Vista para el admin: todas las ofertas, con su estado
--
--    Le permite ver de un vistazo qué está activo, qué venció y qué está
--    programado para más adelante, sin abrir platillo por platillo.
-- ============================================================

CREATE OR REPLACE VIEW ofertas_admin AS
SELECT m.id,
       m.nombre,
       m.precio            AS precio_normal,
       m.precio_oferta,
       m.oferta_desde,
       m.oferta_hasta,
       CASE
           WHEN m.precio_oferta IS NULL              THEN 'sin_oferta'
           WHEN public.oferta_vigente(m.precio_oferta, m.oferta_desde, m.oferta_hasta) THEN 'activa'
           WHEN m.oferta_desde IS NOT NULL AND m.oferta_desde > NOW() THEN 'programada'
           ELSE 'vencida'
       END                 AS estado,
       CASE
           WHEN m.precio > 0 AND m.precio_oferta IS NOT NULL
               THEN ROUND((1 - (m.precio_oferta / m.precio)) * 100)
           ELSE 0
       END                 AS descuento_pct
  FROM menu m
 WHERE m.precio_oferta IS NOT NULL;

COMMENT ON VIEW ofertas_admin IS
    'Todas las ofertas con su estado: activa, programada, vencida o sin oferta.';

GRANT SELECT ON ofertas_admin TO authenticated;

NOTIFY pgrst, 'reload schema';

COMMIT;
