-- ============================================================
-- 20261021_13_secciones_del_menu.sql
--
-- Mueve las secciones de la carta DESDE el código HACIA la base.
--
-- EL PROBLEMA
--
-- Hoy la carta tiene dos listas que deben coincidir y nada las obliga:
--
--   EN EL CÓDIGO (cliente-menu.js)   EN LA BASE (menu.categoria)
--   -----------------------------    -----------------------
--   Entradas, Sushi, Rolls,          Rolls (4 platos)
--   Tragos, Pokes, Ensaladas,        Sushi (2 platos)
--   Comida China, Comida Japonesa,
--   Ofertas, Para Niños,
--   Combo Ejecutivo, Favoritos,
--   Todos  (13 secciones)
--
-- Coinciden de casualidad. Si el admin renombra "Rolls" a "Rolls de Autor",
-- los cuatro platos DESAPARECEN de la carta: el filtro del cliente busca un
-- nombre que ya no existe y no queda ningún cartel que avise. La sección se
-- ve vacía para siempre.
--
-- Peor: 11 de las 13 secciones no tienen ni un plato. El cliente ya está
-- tocando botones que llevan a "No hay platillos".
--
-- QUÉ CREA ESTA MIGRACIÓN
--
-- Tabla `secciones` con jerarquía madre -> hija, como pidió el dueño
-- ("Comida China" es madre; "Arroz Chino", "Chopsuey", etc. son hijas).
--
-- El menú sigue guardando `categoria` y `subcategoria` como TEXTO, a
-- propósito: cambiar eso por ids rompería la RPC de pedidos y los reportes
-- del cajero, que ya están probados. La tabla `secciones` es la fuente de
-- verdad de QUÉ secciones existen, en qué orden y cuáles se ven. El nombre
-- sigue siendo el vínculo, y el aviso del admin (paso 4) evita el renombre
-- a ciegas.
--
-- CAMPOS DE VISIBILIDAD POR HORARIO
--
-- El dueño pidió poder ocultar "Tragos" fuera del horario legal. En
-- Venezuela el horario lo fija cada municipio, no la nación, así que el
-- valor va en la base y se configura desde el admin.
--
-- Arranca en 11:00 -> 01:00, que es el horario de consumo para restaurantes
-- de la Alcaldía de Caracas. NO es una verdad legal: es un valor inicial
-- que el dueño tiene que confirmar con SU municipio.
--
-- ADVERTENCIA DEJADA EN EL CÓDIGO: vender alcohol por delivery y servirlo
-- en el local son categorías distintas y pueden tener horarios distintos.
--
-- Idempotente.
-- ============================================================

BEGIN;

-- ============================================================
-- 1. La tabla
-- ============================================================

CREATE TABLE IF NOT EXISTS secciones (
    id              TEXT PRIMARY KEY,
    nombre          TEXT NOT NULL,
    -- La madre. NULL significa que es una sección de primer nivel.
    madre_id        TEXT REFERENCES secciones(id) ON DELETE CASCADE,
    -- Orden de aparición en la carta. Menor primero.
    orden           INTEGER NOT NULL DEFAULT 0,
    icono           TEXT,
    -- Nombre del ícono de FontAwesome, sin el prefijo "fa-".
    visible         BOOLEAN NOT NULL DEFAULT TRUE,
    -- Visibilidad por horario. NULL/NULL = siempre visible.
    hora_desde      TIME,
    hora_hasta      TIME,
    -- Aclaración para el admin sobre por qué existe el horario.
    nota_horario    TEXT,
    created_at      TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at      TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_secciones_madre ON secciones(madre_id);
CREATE INDEX IF NOT EXISTS idx_secciones_orden ON secciones(orden);

COMMENT ON TABLE secciones IS
    'Secciones de la carta. Fuente de verdad de qué existe, en qué orden y cuándo se ve.';
COMMENT ON COLUMN secciones.hora_desde IS
    'Hora local desde la que la sección es visible. NULL = sin restricción.';
COMMENT ON COLUMN secciones.nota_horario IS
    'Motivo del horario, para que el admin no lo cambie sin saber por qué estaba.';


-- ============================================================
-- 2. Cargar las secciones reales
--
--    Se cargan las 13 que el cliente ya ve, en el mismo orden, para que el
--    paso 2 (leer de la base) no cambie NADA a la vista. Si el paso 2
--    cambiara la carta, no se podría saber si el error es de la migración o
--    del renombre.
-- ============================================================

INSERT INTO secciones (id, nombre, madre_id, orden, icono, nota_horario) VALUES
    ('todos',    'Todos los platillos', NULL,  1, 'utensils',      NULL),
    ('favoritos','⭐ Favoritos',        NULL,  2, 'star',          NULL),
    ('entradas', 'Entradas',            NULL,  3, 'leaf',          NULL),
    ('sushi',    'Sushi',               NULL,  4, 'fish',          NULL),
    ('rolls',    'Rolls',               NULL,  5, 'egg',           NULL),
    ('tragos',   'Tragos y bebidas',    NULL,  6, 'wine-glass-alt',
        'Horario legal de expendio de alcohol. Varía por municipio: confirmar con el municipio del local. Vender por delivery puede tener otro horario.'),
    ('pokes',    'Pokes',               NULL,  7, 'bowl-food',     NULL),
    ('ensaladas','Ensaladas',           NULL,  8, 'carrot',        NULL),
    ('china',    'Comida China',        NULL,  9, 'dragon',        NULL),
    ('japonesa', 'Comida Japonesa',     NULL, 10, 'sun',           NULL),
    ('ofertas',  'OFERTAS ESPECIALES',  NULL, 11, 'fire',          NULL),
    ('ninos',    'Para Niños',          NULL, 12, 'child',         NULL),
    ('ejecutivo','Combo Ejecutivo',     NULL, 13, 'briefcase',     NULL)
ON CONFLICT (id) DO NOTHING;

-- Hijas de Rolls
INSERT INTO secciones (id, nombre, madre_id, orden, icono) VALUES
    ('rolls-frios',   'Rolls Fríos de 10 piezas',  'rolls', 1, NULL),
    ('rolls-tempura', 'Rolls Tempura de 12 piezas','rolls', 2, NULL)
ON CONFLICT (id) DO NOTHING;

-- Hijas de Comida China
INSERT INTO secciones (id, nombre, madre_id, orden, icono) VALUES
    ('china-arroz-chino', 'Arroz Chino',           'china',  1, NULL),
    ('china-cantones',    'Arroz Cantones',        'china',  2, NULL),
    ('china-chopsuey',    'Chopsuey',              'china',  3, NULL),
    ('china-lomey',       'Lomey',                 'china',  4, NULL),
    ('china-chow-mein',   'Chow Mein',             'china',  5, NULL),
    ('china-fideos',      'Fideos de Arroz',       'china',  6, NULL),
    ('china-tallarines',  'Tallarines Cantones',   'china',  7, NULL),
    ('china-mariscos',    'Mariscos',              'china',  8, NULL),
    ('china-foo-yong',    'Foo Yong',              'china',  9, NULL),
    ('china-sopas',       'Sopas',                 'china', 10, NULL),
    ('china-entremeses',  'Entremeses',            'china', 11, NULL)
ON CONFLICT (id) DO NOTHING;

-- Hijas de Comida Japonesa
INSERT INTO secciones (id, nombre, madre_id, orden, icono) VALUES
    ('jap-yakimeshi', 'Yakimeshi',       'japonesa', 1, NULL),
    ('jap-yakisoba',  'Yakisoba',        'japonesa', 2, NULL),
    ('jap-udon',      'Pasta Udon',      'japonesa', 3, NULL),
    ('jap-churrasco', 'Churrasco',       'japonesa', 4, NULL)
ON CONFLICT (id) DO NOTHING;

-- Horario inicial de "Tragos y bebidas": 11:00 -> 01:00.
-- Se pone con UPDATE, no en el INSERT, para no pisar un valor que el dueño
-- ya haya configurado si esta migración se corre dos veces.
UPDATE secciones
   SET hora_desde = '11:00'::TIME,
       hora_hasta = '01:00'::TIME,
       updated_at = NOW()
 WHERE id = 'tragos'
   AND hora_desde IS NULL
   AND hora_hasta IS NULL;


-- ============================================================
-- 3. Qué secciones tienen platos HOY
--
--    El dueño pidió que todas se vean por igual. Pero esto deja a la vista
--    cuántas están vacías, que es información que el admin necesita ver.
-- ============================================================

CREATE OR REPLACE VIEW secciones_con_conteo AS
SELECT s.id,
       s.nombre,
       s.madre_id,
       s.orden,
       s.visible,
       s.hora_desde,
       s.hora_hasta,
       (SELECT COUNT(*) FROM menu m
         WHERE m.categoria = s.nombre
            OR (s.madre_id IS NOT NULL AND m.subcategoria = s.nombre)
       ) AS platos
  FROM secciones s;

COMMENT ON VIEW secciones_con_conteo IS
    'Secciones con cuántos platos tiene cada una. Las de 0 son botones que llevan a una carta vacía.';

GRANT SELECT ON secciones TO anon, authenticated;
GRANT SELECT ON secciones_con_conteo TO anon, authenticated;

-- Escritura solo para admin. Se hace con la función de la migración 05.
ALTER TABLE secciones ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS secciones_lectura_publica ON secciones;
CREATE POLICY secciones_lectura_publica ON secciones
    FOR SELECT TO anon, authenticated USING (true);

DROP POLICY IF EXISTS secciones_escritura_admin ON secciones;
CREATE POLICY secciones_escritura_admin ON secciones
    FOR ALL TO authenticated
    USING (public.es_admin()) WITH CHECK (public.es_admin());


NOTIFY pgrst, 'reload schema';

COMMIT;
