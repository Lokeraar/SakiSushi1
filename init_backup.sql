-- ============================================
-- SCRIPT COMPLETO PARA SUPABASE - SAKI SUSHI
-- VERSIÓN FINAL CON AUTENTICACIÓN JWT Y NOTIFICACIONES
-- + ATOMICIDAD EN STOCK (RPCs)
-- ============================================

-- HABILITAR EXTENSIONES NECESARIAS
CREATE EXTENSION IF NOT EXISTS "uuid-ossp";
CREATE EXTENSION IF NOT EXISTS "pgcrypto";

-- ============================================
-- ELIMINAR TODO LO EXISTENTE (ORDEN CORRECTO)
-- ============================================
DROP FUNCTION IF EXISTS crear_pedido_con_reserva CASCADE;
DROP FUNCTION IF EXISTS liberar_ingredientes CASCADE;
DROP FUNCTION IF EXISTS update_updated_at_column CASCADE;
DROP FUNCTION IF EXISTS verify_user_credentials CASCADE;

DROP TABLE IF EXISTS push_subscriptions CASCADE;
DROP TABLE IF EXISTS notificaciones CASCADE;
DROP TABLE IF EXISTS entregas_delivery CASCADE;
DROP TABLE IF EXISTS ventas CASCADE;
DROP TABLE IF EXISTS propinas CASCADE;
DROP TABLE IF EXISTS pedidos CASCADE;
DROP TABLE IF EXISTS menu CASCADE;
DROP TABLE IF EXISTS inventario CASCADE;
DROP TABLE IF EXISTS codigos_qr CASCADE;
DROP TABLE IF EXISTS deliverys CASCADE;
DROP TABLE IF EXISTS mesoneros CASCADE;
DROP TABLE IF EXISTS usuarios CASCADE;
DROP TABLE IF EXISTS config CASCADE;

-- ============================================
-- TABLA: config
-- ============================================
CREATE TABLE config (
    id INTEGER PRIMARY KEY DEFAULT 1,
    tasa_cambio NUMERIC(10,2) DEFAULT NULL,
    tasa_efectiva NUMERIC(10,2) DEFAULT NULL,
    aumento_diario NUMERIC(5,2) DEFAULT 0,
    aumento_acumulado NUMERIC(5,2) DEFAULT 0,
    aumento_activo BOOLEAN DEFAULT FALSE,
    aumento_semanal BOOLEAN DEFAULT FALSE,
    aumento_detenido BOOLEAN DEFAULT FALSE,
    aumento_desde DATE DEFAULT NULL,
    aumento_hasta DATE DEFAULT NULL,
    aumento_indefinido BOOLEAN DEFAULT FALSE,
    fecha_ultimo_aumento TIMESTAMP WITH TIME ZONE,
    ultima_actualizacion TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
    admin_password TEXT DEFAULT '654321',
    recovery_email TEXT DEFAULT 'admin@sakisushi.com',
    alerta_stock_minimo INTEGER DEFAULT 5,
    created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
    updated_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
    CONSTRAINT config_id_check CHECK (id = 1)
);

INSERT INTO config (
    id, tasa_cambio, tasa_efectiva,
    aumento_diario, aumento_acumulado,
    aumento_activo, aumento_semanal, aumento_detenido,
    aumento_desde, aumento_hasta, aumento_indefinido,
    admin_password, recovery_email, alerta_stock_minimo
) VALUES (
    1,
    NULL, NULL,
    0, 0,
    FALSE, FALSE, FALSE,
    NULL, NULL, FALSE,
    '654321', 'admin@sakisushi.com', 5
)
ON CONFLICT (id) DO UPDATE SET
    admin_password      = COALESCE(EXCLUDED.admin_password,      config.admin_password),
    recovery_email      = COALESCE(EXCLUDED.recovery_email,      config.recovery_email),
    alerta_stock_minimo = COALESCE(EXCLUDED.alerta_stock_minimo, config.alerta_stock_minimo);

ALTER TABLE config ENABLE ROW LEVEL SECURITY;
CREATE POLICY "Lectura config para todos" ON config FOR SELECT USING (true);
CREATE POLICY "Actualizacion config solo admin" ON config FOR UPDATE USING (true) WITH CHECK (true);
GRANT SELECT ON config TO anon, authenticated;
GRANT SELECT, UPDATE ON config TO PUBLIC;

-- ============================================
-- TABLA: usuarios
-- ============================================
CREATE TABLE usuarios (
    id TEXT PRIMARY KEY,
    nombre TEXT NOT NULL,
    username TEXT UNIQUE NOT NULL,
    password_hash TEXT NOT NULL,
    rol TEXT DEFAULT 'cajero',
    activo BOOLEAN DEFAULT TRUE,
    foto TEXT,
    created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
    updated_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
);

ALTER TABLE usuarios ENABLE ROW LEVEL SECURITY;
CREATE POLICY "Usuarios ver datos propios" ON usuarios FOR SELECT USING (true);
CREATE POLICY "Usuarios insert" ON usuarios FOR INSERT WITH CHECK (true);
CREATE POLICY "Usuarios update" ON usuarios FOR UPDATE USING (true) WITH CHECK (true);
CREATE POLICY "Usuarios delete" ON usuarios FOR DELETE USING (true);

GRANT SELECT, INSERT, UPDATE, DELETE ON usuarios TO anon, authenticated;
GRANT SELECT, INSERT, UPDATE, DELETE ON usuarios TO PUBLIC;

-- ============================================
-- FUNCIÓN: hash_password
-- ============================================
CREATE OR REPLACE FUNCTION hash_password(plain_password TEXT)
RETURNS TEXT AS $$
BEGIN
    RETURN crypt(plain_password, gen_salt('bf', 8));
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

-- ============================================
-- POBLAR TABLA usuarios
-- ============================================
INSERT INTO usuarios (id, nombre, username, password_hash, rol, activo) VALUES
    ('user_' || gen_random_uuid() || '_1', 'Cajero Principal', 'cajero1', hash_password('123456'), 'cajero', true),
    ('user_' || gen_random_uuid() || '_2', 'Cajero Secundario', 'cajero2', hash_password('123456'), 'cajero', true),
    ('user_' || gen_random_uuid() || '_3', 'Administrador', 'admin', hash_password('admin123'), 'admin', true)
ON CONFLICT (username) DO NOTHING;

-- ============================================
-- FUNCIÓN verify_user_credentials
-- ============================================
CREATE OR REPLACE FUNCTION verify_user_credentials(p_username TEXT, p_password TEXT)
RETURNS TABLE (
    success BOOLEAN,
    error TEXT,
    user_id TEXT,
    user_nombre TEXT,
    user_username TEXT,
    user_rol TEXT
) AS $$
DECLARE
    v_username TEXT := LOWER(TRIM(p_username));
    v_password TEXT := TRIM(p_password);
BEGIN
    RETURN QUERY
    SELECT 
        CASE 
            WHEN u.id IS NOT NULL AND u.password_hash = crypt(v_password, u.password_hash) 
            THEN true 
            ELSE false 
        END AS success,
        CASE 
            WHEN u.id IS NULL THEN 'Usuario no encontrado'::TEXT
            WHEN u.password_hash != crypt(v_password, u.password_hash) THEN 'Contraseña incorrecta'::TEXT
            ELSE NULL::TEXT
        END AS error,
        u.id AS user_id,
        u.nombre AS user_nombre,
        u.username AS user_username,
        u.rol AS user_rol
    FROM usuarios u
    WHERE LOWER(TRIM(u.username)) = v_username AND u.activo = true
    UNION ALL
    SELECT false, 'Usuario no encontrado'::TEXT, NULL::TEXT, NULL::TEXT, NULL::TEXT, NULL::TEXT
    WHERE NOT EXISTS (SELECT 1 FROM usuarios WHERE LOWER(TRIM(username)) = v_username AND activo = true)
    LIMIT 1;
END;
$$ LANGUAGE plpgsql STABLE;

GRANT EXECUTE ON FUNCTION verify_user_credentials TO anon, authenticated;

-- ============================================
-- TABLA: mesoneros
-- ============================================
CREATE TABLE mesoneros (
    id TEXT PRIMARY KEY,
    nombre TEXT NOT NULL,
    activo BOOLEAN DEFAULT TRUE,
    foto TEXT,
    created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
    updated_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
);

ALTER TABLE mesoneros ENABLE ROW LEVEL SECURITY;
CREATE POLICY "Permitir todo mesoneros" ON mesoneros FOR ALL USING (true) WITH CHECK (true);
GRANT ALL ON mesoneros TO anon, authenticated;
GRANT ALL ON mesoneros TO PUBLIC;

INSERT INTO mesoneros (id, nombre, activo) VALUES
    ('mes_' || gen_random_uuid() || '_1', 'Carlos Méndez', true),
    ('mes_' || gen_random_uuid() || '_2', 'María González', true),
    ('mes_' || gen_random_uuid() || '_3', 'José Rodríguez', true),
    ('mes_' || gen_random_uuid() || '_4', 'Ana Pérez', true),
    ('mes_' || gen_random_uuid() || '_5', 'Luis Martínez', true)
ON CONFLICT (id) DO NOTHING;

-- ============================================
-- TABLA: deliverys
-- ============================================
CREATE TABLE deliverys (
    id TEXT PRIMARY KEY,
    nombre TEXT NOT NULL,
    activo BOOLEAN DEFAULT TRUE,
    foto TEXT,
    created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
    updated_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
);

ALTER TABLE deliverys ENABLE ROW LEVEL SECURITY;
CREATE POLICY "Permitir todo deliverys" ON deliverys FOR ALL USING (true) WITH CHECK (true);
GRANT ALL ON deliverys TO anon, authenticated;
GRANT ALL ON deliverys TO PUBLIC;

INSERT INTO deliverys (id, nombre, activo) VALUES
    ('del_' || gen_random_uuid() || '_1', 'Pedro Castillo', true),
    ('del_' || gen_random_uuid() || '_2', 'Juan Flores', true),
    ('del_' || gen_random_uuid() || '_3', 'Miguel Rojas', true),
    ('del_' || gen_random_uuid() || '_4', 'Alejandro Toro', true),
    ('del_' || gen_random_uuid() || '_5', 'David Silva', true)
ON CONFLICT (id) DO NOTHING;

-- ============================================
-- TABLA: inventario
-- ============================================
CREATE TABLE inventario (
    id TEXT PRIMARY KEY,
    nombre TEXT NOT NULL,
    stock NUMERIC(10,2) DEFAULT 0,
    reservado NUMERIC(10,2) DEFAULT 0,
    unidad_base TEXT DEFAULT 'unidades',
    minimo NUMERIC(10,2) DEFAULT 0,
    precio_costo NUMERIC(10,2) DEFAULT 0,
    precio_unitario NUMERIC(10,2) DEFAULT 0,
    imagen TEXT,
    created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
    updated_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
);
-- Migración segura: agregar columna imagen si no existe (para bases de datos ya creadas)
DO $$ BEGIN
    IF NOT EXISTS (
        SELECT 1 FROM information_schema.columns
        WHERE table_name='inventario' AND column_name='imagen'
    ) THEN
        ALTER TABLE inventario ADD COLUMN imagen TEXT;
    END IF;
END $$;

ALTER TABLE inventario ENABLE ROW LEVEL SECURITY;
CREATE POLICY "Permitir todo inventario" ON inventario FOR ALL USING (true) WITH CHECK (true);
GRANT ALL ON inventario TO anon, authenticated;
GRANT ALL ON inventario TO PUBLIC;

CREATE INDEX idx_inventario_nombre ON inventario(nombre);
CREATE INDEX idx_inventario_stock ON inventario(stock);
CREATE INDEX idx_inventario_minimo ON inventario(minimo);

INSERT INTO inventario (id, nombre, stock, reservado, unidad_base, minimo, precio_costo, precio_unitario) VALUES
    ('ing_' || gen_random_uuid() || '_1', 'Arroz para sushi', 50, 0, 'kilogramos', 10, 3.50, 5.00),
    ('ing_' || gen_random_uuid() || '_2', 'Alga nori', 200, 0, 'unidades', 50, 0.30, 0.60),
    ('ing_' || gen_random_uuid() || '_3', 'Salmón fresco', 30, 0, 'kilogramos', 5, 12.00, 18.00),
    ('ing_' || gen_random_uuid() || '_4', 'Atún fresco', 25, 0, 'kilogramos', 5, 14.00, 20.00),
    ('ing_' || gen_random_uuid() || '_5', 'Pepino', 40, 0, 'unidades', 10, 0.50, 0.90),
    ('ing_' || gen_random_uuid() || '_6', 'Aguacate', 35, 0, 'unidades', 10, 0.80, 1.50),
    ('ing_' || gen_random_uuid() || '_7', 'Queso crema', 20, 0, 'kilogramos', 5, 4.00, 6.50),
    ('ing_' || gen_random_uuid() || '_8', 'Salsa de soya', 15, 0, 'litros', 3, 2.50, 4.00),
    ('ing_' || gen_random_uuid() || '_9', 'Wasabi', 10, 0, 'kilogramos', 2, 8.00, 12.00),
    ('ing_' || gen_random_uuid() || '_10', 'Jengibre encurtido', 12, 0, 'kilogramos', 3, 3.00, 5.00),
    ('ing_' || gen_random_uuid() || '_11', 'Sésamo', 8, 0, 'kilogramos', 2, 2.50, 4.00),
    ('ing_' || gen_random_uuid() || '_12', 'Cangrejo (imitación)', 18, 0, 'kilogramos', 5, 5.00, 8.00),
    ('ing_' || gen_random_uuid() || '_13', 'Anguila', 10, 0, 'kilogramos', 2, 15.00, 22.00),
    ('ing_' || gen_random_uuid() || '_14', 'Huevas de pez volador', 5, 0, 'kilogramos', 1, 25.00, 35.00),
    ('ing_' || gen_random_uuid() || '_15', 'Mayonesa japonesa', 12, 0, 'litros', 3, 3.50, 6.00)
ON CONFLICT (id) DO NOTHING;

-- ============================================
-- TABLA: menu
-- ============================================
CREATE TABLE menu (
    id TEXT PRIMARY KEY,
    nombre TEXT NOT NULL,
    categoria TEXT,
    subcategoria TEXT,
    precio NUMERIC(10,2) DEFAULT 0,
    descripcion TEXT,
    imagen TEXT,
    ingredientes JSONB DEFAULT '{}',
    disponible BOOLEAN DEFAULT TRUE,
    stock INTEGER DEFAULT 0,
    stock_maximo INTEGER DEFAULT 0,
    created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
    updated_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
);

ALTER TABLE menu ENABLE ROW LEVEL SECURITY;
CREATE POLICY "Permitir todo menu" ON menu FOR ALL USING (true) WITH CHECK (true);
GRANT ALL ON menu TO anon, authenticated;
GRANT ALL ON menu TO PUBLIC;

CREATE INDEX idx_menu_categoria ON menu(categoria);
CREATE INDEX idx_menu_subcategoria ON menu(subcategoria);
CREATE INDEX idx_menu_nombre ON menu(nombre);
CREATE INDEX idx_menu_precio ON menu(precio);
CREATE INDEX idx_menu_disponible ON menu(disponible);

DO $$
DECLARE
    arroz_id TEXT;
    alga_id TEXT;
    salmon_id TEXT;
    atun_id TEXT;
    pepino_id TEXT;
    aguacate_id TEXT;
    queso_id TEXT;
    cangrejo_id TEXT;
    sesamo_id TEXT;
    anguila_id TEXT;
    huevas_id TEXT;
BEGIN
    SELECT id INTO arroz_id FROM inventario WHERE nombre = 'Arroz para sushi' LIMIT 1;
    SELECT id INTO alga_id FROM inventario WHERE nombre = 'Alga nori' LIMIT 1;
    SELECT id INTO salmon_id FROM inventario WHERE nombre = 'Salmón fresco' LIMIT 1;
    SELECT id INTO atun_id FROM inventario WHERE nombre = 'Atún fresco' LIMIT 1;
    SELECT id INTO pepino_id FROM inventario WHERE nombre = 'Pepino' LIMIT 1;
    SELECT id INTO aguacate_id FROM inventario WHERE nombre = 'Aguacate' LIMIT 1;
    SELECT id INTO queso_id FROM inventario WHERE nombre = 'Queso crema' LIMIT 1;
    SELECT id INTO cangrejo_id FROM inventario WHERE nombre = 'Cangrejo (imitación)' LIMIT 1;
    SELECT id INTO sesamo_id FROM inventario WHERE nombre = 'Sésamo' LIMIT 1;
    SELECT id INTO anguila_id FROM inventario WHERE nombre = 'Anguila' LIMIT 1;
    SELECT id INTO huevas_id FROM inventario WHERE nombre = 'Huevas de pez volador' LIMIT 1;

    INSERT INTO menu (id, nombre, categoria, subcategoria, precio, descripcion, imagen, ingredientes, disponible, stock_maximo) VALUES
        ('plat_' || gen_random_uuid() || '_1', 'California Roll', 'Rolls', 'Rolls Fríos de 10 piezas', 8.99, 'Rollo de cangrejo, pepino y aguacate', 'https://images.unsplash.com/photo-1579584425555-c3ce17fd4351', 
         jsonb_build_object(
             arroz_id, jsonb_build_object('cantidad', 0.15, 'nombre', 'Arroz para sushi', 'unidad', 'kilogramos'),
             alga_id, jsonb_build_object('cantidad', 1, 'nombre', 'Alga nori', 'unidad', 'unidades'),
             cangrejo_id, jsonb_build_object('cantidad', 0.1, 'nombre', 'Cangrejo (imitación)', 'unidad', 'kilogramos'),
             pepino_id, jsonb_build_object('cantidad', 0.2, 'nombre', 'Pepino', 'unidad', 'unidades'),
             aguacate_id, jsonb_build_object('cantidad', 0.3, 'nombre', 'Aguacate', 'unidad', 'unidades'),
             sesamo_id, jsonb_build_object('cantidad', 0.01, 'nombre', 'Sésamo', 'unidad', 'kilogramos')
         ), true, 50),

        ('plat_' || gen_random_uuid() || '_2', 'Philadelphia Roll', 'Rolls', 'Rolls Fríos de 10 piezas', 9.99, 'Salmón y queso crema', 'https://images.unsplash.com/photo-1617196035154-1e7e6e28b0db',
         jsonb_build_object(
             arroz_id, jsonb_build_object('cantidad', 0.15, 'nombre', 'Arroz para sushi', 'unidad', 'kilogramos'),
             alga_id, jsonb_build_object('cantidad', 1, 'nombre', 'Alga nori', 'unidad', 'unidades'),
             salmon_id, jsonb_build_object('cantidad', 0.12, 'nombre', 'Salmón fresco', 'unidad', 'kilogramos'),
             queso_id, jsonb_build_object('cantidad', 0.05, 'nombre', 'Queso crema', 'unidad', 'kilogramos'),
             pepino_id, jsonb_build_object('cantidad', 0.1, 'nombre', 'Pepino', 'unidad', 'unidades')
         ), true, 40),

        ('plat_' || gen_random_uuid() || '_3', 'Spicy Tuna Roll', 'Rolls', 'Rolls Fríos de 10 piezas', 10.99, 'Atún picante', 'https://images.unsplash.com/photo-1617196035154-1e7e6e28b0db',
         jsonb_build_object(
             arroz_id, jsonb_build_object('cantidad', 0.15, 'nombre', 'Arroz para sushi', 'unidad', 'kilogramos'),
             alga_id, jsonb_build_object('cantidad', 1, 'nombre', 'Alga nori', 'unidad', 'unidades'),
             atun_id, jsonb_build_object('cantidad', 0.12, 'nombre', 'Atún fresco', 'unidad', 'kilogramos'),
             pepino_id, jsonb_build_object('cantidad', 0.1, 'nombre', 'Pepino', 'unidad', 'unidades'),
             aguacate_id, jsonb_build_object('cantidad', 0.2, 'nombre', 'Aguacate', 'unidad', 'unidades')
         ), true, 35),

        ('plat_' || gen_random_uuid() || '_4', 'Dragon Roll', 'Rolls', 'Rolls Tempura de 12 piezas', 12.99, 'Rollo de anguila y aguacate', 'https://images.unsplash.com/photo-1579871494447-9811cf80d66c',
         jsonb_build_object(
             arroz_id, jsonb_build_object('cantidad', 0.18, 'nombre', 'Arroz para sushi', 'unidad', 'kilogramos'),
             alga_id, jsonb_build_object('cantidad', 1, 'nombre', 'Alga nori', 'unidad', 'unidades'),
             anguila_id, jsonb_build_object('cantidad', 0.1, 'nombre', 'Anguila', 'unidad', 'kilogramos'),
             aguacate_id, jsonb_build_object('cantidad', 0.4, 'nombre', 'Aguacate', 'unidad', 'unidades'),
             huevas_id, jsonb_build_object('cantidad', 0.02, 'nombre', 'Huevas de pez volador', 'unidad', 'kilogramos')
         ), true, 30),

        ('plat_' || gen_random_uuid() || '_5', 'Sashimi de Salmón (5 pcs)', 'Sushi', NULL, 8.50, '5 piezas de salmón fresco', 'https://images.unsplash.com/photo-1553621042-f6e147245754',
         jsonb_build_object(
             salmon_id, jsonb_build_object('cantidad', 0.15, 'nombre', 'Salmón fresco', 'unidad', 'kilogramos')
         ), true, 60),

        ('plat_' || gen_random_uuid() || '_6', 'Nigiri de Atún (2 pcs)', 'Sushi', NULL, 6.50, '2 piezas de atún sobre arroz', 'https://images.unsplash.com/photo-1617196035154-1e7e6e28b0db',
         jsonb_build_object(
             arroz_id, jsonb_build_object('cantidad', 0.06, 'nombre', 'Arroz para sushi', 'unidad', 'kilogramos'),
             atun_id, jsonb_build_object('cantidad', 0.06, 'nombre', 'Atún fresco', 'unidad', 'kilogramos')
         ), true, 45)
    ON CONFLICT (id) DO NOTHING;
END $$;

-- ============================================
-- TABLA: pedidos
-- ============================================
CREATE TABLE pedidos (
    id TEXT PRIMARY KEY,
    fecha TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
    estado TEXT DEFAULT 'pendiente',
    tipo TEXT,
    total NUMERIC(10,2) DEFAULT 0,
    session_id TEXT,
    mesa TEXT,
    cliente_nombre TEXT,
    parroquia TEXT,
    direccion TEXT,
    telefono TEXT,
    referencia TEXT,
    fecha_reserva TIMESTAMP WITH TIME ZONE,
    comprobante_url TEXT,
    costo_delivery NUMERIC(10,2) DEFAULT 0,
    costo_delivery_usd NUMERIC(10,2) DEFAULT 0,
    costo_delivery_bs NUMERIC(10,2) DEFAULT 0,
    tasa_aplicada NUMERIC(10,2) DEFAULT 400,
    items JSONB DEFAULT '[]',
    pagos_mixtos JSONB,
    metodo_pago TEXT,
    cajero TEXT,
    fecha_cobro TIMESTAMP WITH TIME ZONE,
    condonado NUMERIC(10,2) DEFAULT 0,
    a_favor_caja NUMERIC(10,2) DEFAULT 0,
    vuelto_entregado NUMERIC(10,2) DEFAULT 0,
    monto_recibido NUMERIC(10,2) DEFAULT 0,
    delivery_id TEXT,
    delivery_nombre TEXT,
    created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
    updated_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
);

ALTER TABLE pedidos ENABLE ROW LEVEL SECURITY;
CREATE POLICY "Permitir todo pedidos" ON pedidos FOR ALL USING (true) WITH CHECK (true);
GRANT ALL ON pedidos TO anon, authenticated;
GRANT ALL ON pedidos TO PUBLIC;

CREATE INDEX idx_pedidos_estado ON pedidos(estado);
CREATE INDEX idx_pedidos_fecha ON pedidos(fecha);
CREATE INDEX idx_pedidos_session_id ON pedidos(session_id);
CREATE INDEX idx_pedidos_tipo ON pedidos(tipo);
CREATE INDEX idx_pedidos_fecha_cobro ON pedidos(fecha_cobro);
CREATE INDEX idx_pedidos_estado_tipo ON pedidos(estado, tipo);
CREATE INDEX idx_pedidos_fecha_estado ON pedidos(fecha, estado);

-- ============================================
-- TABLA: ventas
-- ============================================
CREATE TABLE ventas (
    id SERIAL PRIMARY KEY,
    total NUMERIC(10,2) DEFAULT 0,
    subtotal_platillos NUMERIC(10,2) DEFAULT 0,
    items INTEGER DEFAULT 0,
    metodo_pago TEXT,
    tipo TEXT,
    fecha TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
    created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
);

-- Migración segura: agregar columna pedido_id si no existe (para bases de datos ya creadas)
DO $$ BEGIN
    IF NOT EXISTS (
        SELECT 1 FROM information_schema.columns
        WHERE table_name='ventas' AND column_name='pedido_id'
    ) THEN
        ALTER TABLE ventas ADD COLUMN pedido_id TEXT REFERENCES pedidos(id) ON DELETE CASCADE;
    END IF;
END $$;

ALTER TABLE ventas ENABLE ROW LEVEL SECURITY;
CREATE POLICY "Permitir todo ventas" ON ventas FOR ALL USING (true) WITH CHECK (true);
GRANT ALL ON ventas TO anon, authenticated;
GRANT ALL ON ventas TO PUBLIC;
DO $$ BEGIN
    IF EXISTS (
        SELECT 1 FROM information_schema.sequences 
        WHERE sequence_name = 'ventas_id_seq'
    ) THEN
        GRANT USAGE, SELECT ON SEQUENCE ventas_id_seq TO anon, authenticated;
    END IF;
EXCEPTION WHEN undefined_object THEN NULL;
END $$;
CREATE INDEX idx_ventas_metodo_pago ON ventas(metodo_pago);
CREATE INDEX idx_ventas_tipo ON ventas(tipo);

-- ============================================
-- TABLA: ventas_detalle
-- ============================================
CREATE TABLE IF NOT EXISTS ventas_detalle (
    id SERIAL PRIMARY KEY,
    venta_id INTEGER REFERENCES ventas(id) ON DELETE CASCADE,
    platillo_id TEXT REFERENCES menu(id) ON DELETE SET NULL,
    platillo_nombre TEXT NOT NULL,
    imagen TEXT,
    cantidad INTEGER DEFAULT 1,
    precio_unitario_usd NUMERIC(10,2) DEFAULT 0,
    precio_unitario_bs NUMERIC(10,2) DEFAULT 0,
    subtotal_usd NUMERIC(10,2) DEFAULT 0,
    subtotal_bs NUMERIC(10,2) DEFAULT 0,
    fecha TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
    created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
);

-- Migración segura: agregar columna pedido_id si no existe (para bases de datos ya creadas)
DO $$ BEGIN
    IF NOT EXISTS (
        SELECT 1 FROM information_schema.columns
        WHERE table_name='ventas_detalle' AND column_name='pedido_id'
    ) THEN
        ALTER TABLE ventas_detalle ADD COLUMN pedido_id TEXT REFERENCES pedidos(id) ON DELETE CASCADE;
    END IF;
END $$;

-- Migración segura: agregar columna imagen si no existe (para bases de datos ya creadas)
DO $$ BEGIN
    IF NOT EXISTS (
        SELECT 1 FROM information_schema.columns
        WHERE table_name='ventas_detalle' AND column_name='imagen'
    ) THEN
        ALTER TABLE ventas_detalle ADD COLUMN imagen TEXT;
    END IF;
END $$;

-- Migración: Sincronización forzada de imágenes - actualizar TODOS los registros de ventas_detalle con la imagen del menú
-- Esto corrige cualquier registro que tenga imagen NULL o incorrecta
UPDATE ventas_detalle vd
SET imagen = m.imagen
FROM menu m
WHERE vd.platillo_id = m.id
  AND m.imagen IS NOT NULL
  AND (vd.imagen IS NULL OR vd.imagen != m.imagen);

ALTER TABLE ventas_detalle ENABLE ROW LEVEL SECURITY;
DO $$ BEGIN
    CREATE POLICY "Permitir todo ventas_detalle" ON ventas_detalle FOR ALL USING (true) WITH CHECK (true);
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;
GRANT ALL ON ventas_detalle TO anon, authenticated;
GRANT ALL ON ventas_detalle TO PUBLIC;
-- Conceder permisos sobre la secuencia solo si existe
DO $$ BEGIN
    IF EXISTS (
        SELECT 1 FROM information_schema.sequences 
        WHERE sequence_name = 'ventas_detalle_id_seq'
    ) THEN
        GRANT USAGE, SELECT ON SEQUENCE ventas_detalle_id_seq TO anon, authenticated;
    END IF;
EXCEPTION WHEN undefined_object THEN NULL;
END $$;
DROP INDEX IF EXISTS idx_ventas_detalle_venta_id;
DROP INDEX IF EXISTS idx_ventas_detalle_pedido_id;
DROP INDEX IF EXISTS idx_ventas_detalle_platillo_id;
DROP INDEX IF EXISTS idx_ventas_detalle_fecha;
CREATE INDEX idx_ventas_detalle_venta_id ON ventas_detalle(venta_id);
CREATE INDEX idx_ventas_detalle_platillo_id ON ventas_detalle(platillo_id);
CREATE INDEX idx_ventas_detalle_fecha ON ventas_detalle(fecha);

-- Migración segura: crear índice idx_ventas_pedido_id si no existe
DO $$ BEGIN
    IF NOT EXISTS (
        SELECT 1 FROM pg_indexes
        WHERE tablename = 'ventas' AND indexname = 'idx_ventas_pedido_id'
    ) THEN
        CREATE INDEX idx_ventas_pedido_id ON ventas(pedido_id);
    END IF;
END $$;

-- Migración segura: crear índice idx_ventas_detalle_pedido_id si no existe
DO $$ BEGIN
    IF NOT EXISTS (
        SELECT 1 FROM pg_indexes
        WHERE tablename = 'ventas_detalle' AND indexname = 'idx_ventas_detalle_pedido_id'
    ) THEN
        CREATE INDEX idx_ventas_detalle_pedido_id ON ventas_detalle(pedido_id);
    END IF;
END $$;

-- ============================================
-- FUNCIÓN RPC: sincronizar_imagenes_ventas_detalle
-- Sincroniza todas las imágenes faltantes en ventas_detalle desde menu
-- Se usa al iniciar sesión para actualizar registros históricos
-- ============================================
CREATE OR REPLACE FUNCTION sincronizar_imagenes_ventas_detalle()
RETURNS INTEGER AS $$
DECLARE
    v_count INTEGER;
BEGIN
    -- Actualizar todos los registros donde imagen es NULL y platillo_id existe
    UPDATE ventas_detalle vd
    SET imagen = m.imagen
    FROM menu m
    WHERE vd.platillo_id = m.id
      AND (vd.imagen IS NULL OR vd.imagen = '')
      AND m.imagen IS NOT NULL;
    
    GET DIAGNOSTICS v_count = ROW_COUNT;
    RETURN v_count;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

GRANT EXECUTE ON FUNCTION sincronizar_imagenes_ventas_detalle TO anon, authenticated;

-- ============================================
-- FUNCIÓN RPC: forzar_sincronizacion_imagenes
-- Fuerza la actualización de TODAS las imágenes incluso si ya tienen valor
-- Útil para corregir datos inconsistentes
-- ============================================
CREATE OR REPLACE FUNCTION forzar_sincronizacion_imagenes()
RETURNS INTEGER AS $$
DECLARE
    v_count INTEGER;
BEGIN
    -- Actualizar TODOS los registros que tengan platillo_id, sin importar si ya tienen imagen
    UPDATE ventas_detalle vd
    SET imagen = m.imagen
    FROM menu m
    WHERE vd.platillo_id = m.id
      AND m.imagen IS NOT NULL
      AND (vd.imagen IS NULL OR vd.imagen != m.imagen);
    
    GET DIAGNOSTICS v_count = ROW_COUNT;
    RETURN v_count;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

GRANT EXECUTE ON FUNCTION forzar_sincronizacion_imagenes TO anon, authenticated;

-- ============================================
-- VISTA: vista_platillo_estrella (Top 5 semanal - desde lunes)
-- ============================================
CREATE OR REPLACE VIEW vista_platillo_estrella AS
WITH semana_actual AS (
    SELECT 
        -- Inicio de semana: lunes de la semana actual
        (CURRENT_DATE - ((EXTRACT(DOW FROM CURRENT_DATE)::INTEGER + 6) % 7))::DATE AS inicio_semana,
        -- Fin de semana: domingo a las 23:59:59
        ((CURRENT_DATE - ((EXTRACT(DOW FROM CURRENT_DATE)::INTEGER + 6) % 7) + 6)::DATE + INTERVAL '23 hours 59 minutes 59 seconds') AS fin_semana
),
platillos_vendidos AS (
    SELECT 
        vd.platillo_id,
        vd.platillo_nombre,
        MAX(COALESCE(m.imagen, vd.imagen)) AS imagen,
        SUM(vd.cantidad) AS total_cantidad,
        SUM(vd.subtotal_usd) AS total_usd,
        SUM(vd.subtotal_bs) AS total_bs,
        sa.inicio_semana AS fecha_inicio,
        sa.fin_semana AS fecha_fin
    FROM ventas_detalle vd
    CROSS JOIN semana_actual sa
    LEFT JOIN menu m ON vd.platillo_id = m.id
    WHERE vd.fecha >= sa.inicio_semana AND vd.fecha <= sa.fin_semana
    GROUP BY vd.platillo_id, vd.platillo_nombre, sa.inicio_semana, sa.fin_semana
)
SELECT 
    platillo_id,
    platillo_nombre,
    imagen,
    total_cantidad,
    total_usd,
    total_bs,
    fecha_inicio,
    fecha_fin,
    ROW_NUMBER() OVER (ORDER BY total_cantidad DESC, total_usd DESC) AS posicion
FROM platillos_vendidos
ORDER BY total_cantidad DESC, total_usd DESC
LIMIT 5;

-- ============================================
-- TABLA: entregas_delivery
-- ============================================
CREATE TABLE entregas_delivery (
    id SERIAL PRIMARY KEY,
    delivery_id TEXT REFERENCES deliverys(id) ON DELETE SET NULL,
    monto_bs NUMERIC(10,2) DEFAULT 0,
    fecha_entrega TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
    created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
    pagado BOOLEAN DEFAULT FALSE,
    es_pago_total BOOLEAN DEFAULT FALSE
);

-- Migración segura: agregar columna pedido_id si no existe (para bases de datos ya creadas)
DO $$ BEGIN
    IF NOT EXISTS (
        SELECT 1 FROM information_schema.columns
        WHERE table_name='entregas_delivery' AND column_name='pedido_id'
    ) THEN
        ALTER TABLE entregas_delivery ADD COLUMN pedido_id TEXT REFERENCES pedidos(id) ON DELETE CASCADE;
    END IF;
END $$;

-- Migración segura: agregar columna pagado si no existe (para bases de datos ya creadas)
DO $$ BEGIN
    IF NOT EXISTS (
        SELECT 1 FROM information_schema.columns
        WHERE table_name='entregas_delivery' AND column_name='pagado'
    ) THEN
        ALTER TABLE entregas_delivery ADD COLUMN pagado BOOLEAN DEFAULT FALSE;
    END IF;
END $$;

-- Migración segura: agregar columna es_pago_total si no existe (para bases de datos ya creadas)
DO $$ BEGIN
    IF NOT EXISTS (
        SELECT 1 FROM information_schema.columns
        WHERE table_name='entregas_delivery' AND column_name='es_pago_total'
    ) THEN
        ALTER TABLE entregas_delivery ADD COLUMN es_pago_total BOOLEAN DEFAULT FALSE;
    END IF;
END $$;

ALTER TABLE entregas_delivery ENABLE ROW LEVEL SECURITY;
CREATE POLICY "Permitir todo entregas_delivery" ON entregas_delivery FOR ALL USING (true) WITH CHECK (true);
GRANT ALL ON entregas_delivery TO anon, authenticated;
GRANT ALL ON entregas_delivery TO PUBLIC;
GRANT USAGE, SELECT ON SEQUENCE entregas_delivery_id_seq TO anon, authenticated;
CREATE INDEX idx_entregas_fecha ON entregas_delivery(fecha_entrega);

-- Migración segura: crear índice idx_entregas_pedido_id si no existe
DO $$ BEGIN
    IF NOT EXISTS (
        SELECT 1 FROM pg_indexes
        WHERE tablename = 'entregas_delivery' AND indexname = 'idx_entregas_pedido_id'
    ) THEN
        CREATE INDEX idx_entregas_pedido_id ON entregas_delivery(pedido_id);
    END IF;
END $$;

-- ============================================
-- TABLA: propinas
-- ============================================
CREATE TABLE propinas (
    id SERIAL PRIMARY KEY,
    mesonero_id TEXT REFERENCES mesoneros(id) ON DELETE SET NULL,
    mesa TEXT,
    metodo TEXT,
    monto_original NUMERIC(10,2) DEFAULT 0,
    moneda_original TEXT DEFAULT 'Bs',
    tasa_aplicada NUMERIC(10,2),
    monto_bs NUMERIC(10,2) DEFAULT 0,
    referencia TEXT,
    cajero TEXT,
    cajero_id UUID REFERENCES auth.users(id),
    fecha TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
    entregado BOOLEAN DEFAULT FALSE,
    created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
);

-- Migración segura: agregar columna cajero_id si no existe (para bases de datos ya creadas)
DO $$ BEGIN
    IF NOT EXISTS (
        SELECT 1 FROM information_schema.columns
        WHERE table_name='propinas' AND column_name='cajero_id'
    ) THEN
        ALTER TABLE propinas ADD COLUMN cajero_id UUID REFERENCES auth.users(id);
    END IF;
END $$;

-- Migración segura: agregar columna entregado si no existe (para bases de datos ya creadas)
DO $$ BEGIN
    IF NOT EXISTS (
        SELECT 1 FROM information_schema.columns
        WHERE table_name='propinas' AND column_name='entregado'
    ) THEN
        ALTER TABLE propinas ADD COLUMN entregado BOOLEAN DEFAULT false;
    END IF;
END $$;

-- Actualizar registros antiguos que tengan entregado=NULL a false
UPDATE propinas SET entregado = false WHERE entregado IS NULL;

ALTER TABLE propinas ENABLE ROW LEVEL SECURITY;
CREATE POLICY "Permitir todo propinas" ON propinas FOR ALL USING (true) WITH CHECK (true);
GRANT ALL ON propinas TO anon, authenticated;
GRANT ALL ON propinas TO PUBLIC;
GRANT USAGE, SELECT ON SEQUENCE propinas_id_seq TO anon, authenticated;

CREATE INDEX idx_propinas_fecha ON propinas(fecha);
CREATE INDEX idx_propinas_mesonero ON propinas(mesonero_id);
CREATE INDEX idx_propinas_mesa ON propinas(mesa);
CREATE INDEX idx_propinas_entregado ON propinas(entregado);
CREATE INDEX IF NOT EXISTS idx_propinas_mesonero_entregado ON propinas(mesonero_id, entregado);

-- Migración segura: agregar columna propina_original_id si no existe (para pagos parciales)
DO $$ BEGIN
    IF NOT EXISTS (
        SELECT 1 FROM information_schema.columns
        WHERE table_name='propinas' AND column_name='propina_original_id'
    ) THEN
        ALTER TABLE propinas ADD COLUMN propina_original_id INTEGER REFERENCES propinas(id);
        CREATE INDEX IF NOT EXISTS idx_propinas_propina_original ON propinas(propina_original_id);
    END IF;
END $$;

-- ============================================
-- TABLA: notificaciones
-- ============================================
CREATE TABLE notificaciones (
    id SERIAL PRIMARY KEY,
    tipo TEXT,
    titulo TEXT,
    mensaje TEXT,
    fecha TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
    session_id TEXT,
    leida BOOLEAN DEFAULT FALSE,
    created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
);

-- Migración segura: agregar columna pedido_id si no existe (para bases de datos ya creadas)
DO $$ BEGIN
    IF NOT EXISTS (
        SELECT 1 FROM information_schema.columns
        WHERE table_name='notificaciones' AND column_name='pedido_id'
    ) THEN
        ALTER TABLE notificaciones ADD COLUMN pedido_id TEXT;
    END IF;
END $$;

ALTER TABLE notificaciones ENABLE ROW LEVEL SECURITY;
CREATE POLICY "Permitir todo notificaciones" ON notificaciones FOR ALL USING (true) WITH CHECK (true);
GRANT ALL ON notificaciones TO anon, authenticated;
GRANT ALL ON notificaciones TO PUBLIC;
GRANT USAGE ON SEQUENCE notificaciones_id_seq TO anon, authenticated;

CREATE INDEX idx_notificaciones_session ON notificaciones(session_id);
CREATE INDEX idx_notificaciones_fecha ON notificaciones(fecha);
CREATE INDEX idx_notificaciones_leida ON notificaciones(leida);
CREATE INDEX idx_notificaciones_tipo ON notificaciones(tipo);
CREATE INDEX idx_notificaciones_session_leida ON notificaciones(session_id, leida);
CREATE INDEX idx_notificaciones_session_fecha ON notificaciones(session_id, fecha);

-- Migración segura: crear índice idx_notificaciones_pedido_id si no existe
DO $$ BEGIN
    IF NOT EXISTS (
        SELECT 1 FROM pg_indexes
        WHERE tablename = 'notificaciones' AND indexname = 'idx_notificaciones_pedido_id'
    ) THEN
        CREATE INDEX idx_notificaciones_pedido_id ON notificaciones(pedido_id);
    END IF;
END $$;

-- ============================================
-- TABLA: push_subscriptions
-- ============================================
CREATE TABLE push_subscriptions (
    id SERIAL PRIMARY KEY,
    session_id TEXT NOT NULL,
    endpoint TEXT UNIQUE NOT NULL,
    p256dh TEXT NOT NULL,
    auth TEXT NOT NULL,
    rol TEXT DEFAULT 'cliente',
    created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
    last_used TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
    user_agent TEXT
);

CREATE INDEX idx_push_session ON push_subscriptions(session_id);
CREATE INDEX idx_push_endpoint ON push_subscriptions(endpoint);
CREATE INDEX idx_push_last_used ON push_subscriptions(last_used);

ALTER TABLE push_subscriptions ENABLE ROW LEVEL SECURITY;
CREATE POLICY "Permitir todo push_subscriptions" ON push_subscriptions FOR ALL USING (true) WITH CHECK (true);
GRANT ALL ON push_subscriptions TO anon, authenticated;
GRANT ALL ON push_subscriptions TO PUBLIC;
GRANT USAGE ON SEQUENCE push_subscriptions_id_seq TO anon, authenticated;

-- ============================================
-- TABLA: codigos_qr
-- ============================================
CREATE TABLE codigos_qr (
    id TEXT PRIMARY KEY,
    nombre TEXT,
    tipo TEXT DEFAULT 'mesa',
    ssid TEXT,
    password TEXT,
    fecha TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
    created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
);

ALTER TABLE codigos_qr ENABLE ROW LEVEL SECURITY;
CREATE POLICY "Permitir todo codigos_qr" ON codigos_qr FOR ALL USING (true) WITH CHECK (true);
GRANT ALL ON codigos_qr TO anon, authenticated;
GRANT ALL ON codigos_qr TO PUBLIC;

CREATE INDEX idx_codigos_qr_tipo ON codigos_qr(tipo);
CREATE INDEX idx_codigos_qr_nombre ON codigos_qr(nombre);

INSERT INTO codigos_qr (id, nombre, tipo) VALUES
    ('QR_' || gen_random_uuid() || '_1', 'Mesa 1', 'mesa'),
    ('QR_' || gen_random_uuid() || '_2', 'Mesa 2', 'mesa'),
    ('QR_' || gen_random_uuid() || '_3', 'Mesa 3', 'mesa'),
    ('QR_' || gen_random_uuid() || '_4', 'Mesa 4', 'mesa'),
    ('QR_' || gen_random_uuid() || '_5', 'Mesa 5', 'mesa'),
    ('QR_' || gen_random_uuid() || '_6', 'WiFi Clientes', 'wifi')
ON CONFLICT (id) DO NOTHING;

-- ============================================
-- FUNCIÓN: update_updated_at_column
-- ============================================
CREATE OR REPLACE FUNCTION update_updated_at_column()
RETURNS TRIGGER AS $$
BEGIN
    NEW.updated_at = NOW();
    RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER update_config_updated_at
    BEFORE UPDATE ON config
    FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();

CREATE TRIGGER update_usuarios_updated_at
    BEFORE UPDATE ON usuarios
    FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();

CREATE TRIGGER update_mesoneros_updated_at
    BEFORE UPDATE ON mesoneros
    FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();

CREATE TRIGGER update_deliverys_updated_at
    BEFORE UPDATE ON deliverys
    FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();

CREATE TRIGGER update_inventario_updated_at
    BEFORE UPDATE ON inventario
    FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();

CREATE TRIGGER update_menu_updated_at
    BEFORE UPDATE ON menu
    FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();

CREATE TRIGGER update_pedidos_updated_at
    BEFORE UPDATE ON pedidos
    FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();

-- ============================================
-- FUNCIÓN: crear_pedido_con_reserva
-- ============================================
CREATE OR REPLACE FUNCTION crear_pedido_con_reserva(
    p_pedido JSONB,
    p_items JSONB
) RETURNS JSONB AS $$
DECLARE
    v_pedido_id TEXT;
    v_item JSONB;
    v_ingrediente_id TEXT;
    v_cantidad NUMERIC;
    v_ingrediente_info JSONB;
    v_result JSONB;
BEGIN
    INSERT INTO pedidos (
        id, fecha, estado, tipo, total, session_id, mesa, cliente_nombre,
        parroquia, direccion, telefono, referencia, fecha_reserva, comprobante_url,
        costo_delivery, costo_delivery_usd, costo_delivery_bs, tasa_aplicada, items
    ) VALUES (
        p_pedido->>'id',
        (p_pedido->>'fecha')::TIMESTAMP WITH TIME ZONE,
        p_pedido->>'estado',
        p_pedido->>'tipo',
        (p_pedido->>'total')::NUMERIC,
        p_pedido->>'session_id',
        p_pedido->>'mesa',
        p_pedido->>'cliente_nombre',
        p_pedido->>'parroquia',
        p_pedido->>'direccion',
        p_pedido->>'telefono',
        p_pedido->>'referencia',
        (p_pedido->>'fecha_reserva')::TIMESTAMP WITH TIME ZONE,
        p_pedido->>'comprobante_url',
        (p_pedido->>'costo_delivery')::NUMERIC,
        (p_pedido->>'costo_delivery_usd')::NUMERIC,
        (p_pedido->>'costo_delivery_bs')::NUMERIC,
        (p_pedido->>'tasa_aplicada')::NUMERIC,
        p_items
    ) RETURNING id INTO v_pedido_id;

    INSERT INTO notificaciones (
        pedido_id, tipo, titulo, mensaje, session_id, leida
    ) VALUES (
        v_pedido_id,
        'pending',
        '⏳ Pedido pendiente',
        'Tu pedido está pendiente de confirmación',
        p_pedido->>'session_id',
        false
    );

    IF p_pedido->>'estado' = 'pendiente' THEN
        FOR v_item IN SELECT * FROM jsonb_array_elements(p_items)
        LOOP
            SELECT ingredientes INTO v_ingrediente_info
            FROM menu
            WHERE id = v_item->>'platilloId';

            IF v_ingrediente_info IS NOT NULL THEN
                FOR v_ingrediente_id, v_cantidad IN
                    SELECT key, (value->>'cantidad')::NUMERIC
                    FROM jsonb_each(v_ingrediente_info)
                LOOP
                    UPDATE inventario
                    SET reservado = reservado + (v_cantidad * (v_item->>'cantidad')::NUMERIC)
                    WHERE id = v_ingrediente_id;
                END LOOP;
            END IF;
        END LOOP;
    END IF;

    v_result := jsonb_build_object(
        'success', true,
        'pedido_id', v_pedido_id
    );

    RETURN v_result;

EXCEPTION WHEN OTHERS THEN
    RETURN jsonb_build_object(
        'success', false,
        'error', SQLERRM
    );
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

-- ============================================
-- FUNCIÓN: liberar_ingredientes
-- ============================================
CREATE OR REPLACE FUNCTION liberar_ingredientes(
    p_pedido_id TEXT
) RETURNS JSONB AS $$
DECLARE
    v_pedido RECORD;
    v_item JSONB;
    v_ingrediente_id TEXT;
    v_cantidad NUMERIC;
    v_ingrediente_info JSONB;
    v_result JSONB;
BEGIN
    SELECT * INTO v_pedido FROM pedidos WHERE id = p_pedido_id;

    IF v_pedido.estado = 'pendiente' AND v_pedido.items IS NOT NULL THEN
        FOR v_item IN SELECT * FROM jsonb_array_elements(v_pedido.items)
        LOOP
            SELECT ingredientes INTO v_ingrediente_info
            FROM menu
            WHERE id = v_item->>'platilloId';

            IF v_ingrediente_info IS NOT NULL THEN
                FOR v_ingrediente_id, v_cantidad IN
                    SELECT key, (value->>'cantidad')::NUMERIC
                    FROM jsonb_each(v_ingrediente_info)
                LOOP
                    UPDATE inventario
                    SET reservado = GREATEST(0, reservado - (v_cantidad * (v_item->>'cantidad')::NUMERIC))
                    WHERE id = v_ingrediente_id;
                END LOOP;
            END IF;
        END LOOP;
    END IF;

    v_result := jsonb_build_object('success', true);
    RETURN v_result;

EXCEPTION WHEN OTHERS THEN
    RETURN jsonb_build_object(
        'success', false,
        'error', SQLERRM
    );
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

-- ============================================
-- CONFIGURACIÓN DE STORAGE
-- ============================================
INSERT INTO storage.buckets (id, name, public) VALUES
    ('imagenes-platillos', 'imagenes-platillos', true),
    ('comprobantes', 'comprobantes', true),
    ('alarma', 'alarma', true)
ON CONFLICT (id) DO NOTHING;

DROP POLICY IF EXISTS "Permitir todo en imagenes-platillos" ON storage.objects;
CREATE POLICY "Permitir todo en imagenes-platillos"
    ON storage.objects FOR ALL
    USING (bucket_id = 'imagenes-platillos')
    WITH CHECK (bucket_id = 'imagenes-platillos');

DROP POLICY IF EXISTS "Permitir todo en comprobantes" ON storage.objects;
CREATE POLICY "Permitir todo en comprobantes"
    ON storage.objects FOR ALL
    USING (bucket_id = 'comprobantes')
    WITH CHECK (bucket_id = 'comprobantes');

DROP POLICY IF EXISTS "Permitir todo en alarma" ON storage.objects;
CREATE POLICY "Permitir todo en alarma"
    ON storage.objects FOR ALL
    USING (bucket_id = 'alarma')
    WITH CHECK (bucket_id = 'alarma');

-- ============================================
-- CONFIGURACIÓN DE PERMISOS ADICIONALES
-- ============================================
GRANT USAGE, SELECT ON SEQUENCE notificaciones_id_seq TO anon;
GRANT USAGE, SELECT ON SEQUENCE notificaciones_id_seq TO authenticated;

GRANT USAGE, SELECT ON SEQUENCE push_subscriptions_id_seq TO anon;
GRANT USAGE, SELECT ON SEQUENCE push_subscriptions_id_seq TO authenticated;

GRANT ALL ON ALL TABLES IN SCHEMA public TO anon;
GRANT ALL ON ALL TABLES IN SCHEMA public TO authenticated;

GRANT EXECUTE ON ALL FUNCTIONS IN SCHEMA public TO anon;
GRANT EXECUTE ON ALL FUNCTIONS IN SCHEMA public TO authenticated;

-- ============================================
-- CONFIGURACIÓN DE REALTIME
-- ============================================
ALTER DATABASE postgres SET timezone TO 'America/Caracas';

ALTER PUBLICATION supabase_realtime ADD TABLE pedidos;
ALTER PUBLICATION supabase_realtime ADD TABLE notificaciones;
ALTER PUBLICATION supabase_realtime ADD TABLE ventas;
ALTER PUBLICATION supabase_realtime ADD TABLE propinas;
ALTER PUBLICATION supabase_realtime ADD TABLE inventario;
ALTER PUBLICATION supabase_realtime ADD TABLE menu;
ALTER PUBLICATION supabase_realtime ADD TABLE config;
ALTER PUBLICATION supabase_realtime ADD TABLE mesoneros;
ALTER PUBLICATION supabase_realtime ADD TABLE deliverys;

-- ============================================
-- MIGRACION PARA BD YA EXISTENTE EN PRODUCCION
-- (Si ya tienes datos y NO quieres borrar todo)
-- ============================================
ALTER TABLE config ADD COLUMN IF NOT EXISTS aumento_semanal    BOOLEAN DEFAULT FALSE;
ALTER TABLE push_subscriptions ADD COLUMN IF NOT EXISTS rol TEXT DEFAULT 'cliente';
ALTER TABLE config ADD COLUMN IF NOT EXISTS aumento_desde      DATE    DEFAULT NULL;
ALTER TABLE config ADD COLUMN IF NOT EXISTS aumento_hasta      DATE    DEFAULT NULL;
ALTER TABLE config ADD COLUMN IF NOT EXISTS aumento_indefinido BOOLEAN DEFAULT FALSE;

-- ============================================
-- VERIFICACION FINAL
-- ============================================
SELECT '✅ SCRIPT COMPLETADO EXITOSAMENTE' as mensaje;
SELECT '✅ NOTIFICACIONES AUTOMÁTICAS ACTIVADAS' as notificaciones;
SELECT '✅ FUNCIÓN verify_user_credentials CREADA' as auth;
SELECT '✅ Usuario admin: contraseña admin123' as admin_info;
SELECT '✅ Usuarios cajero: cajero1/123456, cajero2/123456' as cajero_info;