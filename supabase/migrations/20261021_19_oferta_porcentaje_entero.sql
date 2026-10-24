-- ============================================================
-- 20261021_19_oferta_porcentaje_entero.sql
--
-- El porcentaje de descuento se devuelve como ENTERO.
--
-- Decisión del dueño: el cliente no debe ver decimales. Un cartel que diga
-- "-33,33333%" se lee como un error de la app, no como una oferta.
--
-- Se redondea SOLO para mostrar. El precio real sigue siendo exacto: el
-- cliente paga `precio_vigente`, no un precio calculado con el porcentaje.
-- O sea, que el cartel diga -33% y el descuento real sea 33,4% no afecta en
-- nada lo que se cobra.
--
-- Idempotente.
-- ============================================================

BEGIN;

-- Postgres no permite cambiarle el TIPO a una columna de una vista existente
-- ("cannot change data type of view column"). Como `descuento_pct` pasa de
-- numeric a integer, hay que borrar y recrear. Es seguro: las vistas no
-- guardan datos, se calculan al leer.
DROP VIEW IF EXISTS menu_con_oferta;
DROP VIEW IF EXISTS ofertas_admin;

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
       -- ENTERO a propósito: -30, no -30,0000.
       CASE
           WHEN public.oferta_vigente(m.precio_oferta, m.oferta_desde, m.oferta_hasta)
                AND m.precio > 0
               THEN ROUND((1 - (m.precio_oferta / m.precio)) * 100)::INTEGER
           ELSE 0
       END                                        AS descuento_pct
  FROM menu m;

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
               THEN ROUND((1 - (m.precio_oferta / m.precio)) * 100)::INTEGER
           ELSE 0
       END                 AS descuento_pct
  FROM menu m
 WHERE m.precio_oferta IS NOT NULL;

GRANT SELECT ON menu_con_oferta TO anon, authenticated;
GRANT SELECT ON ofertas_admin TO authenticated;

NOTIFY pgrst, 'reload schema';

COMMIT;
