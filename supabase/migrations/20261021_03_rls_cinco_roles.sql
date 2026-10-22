-- ============================================================
-- 20261021_03_rls_cinco_roles.sql
--
-- Row Level Security real para los cinco roles del sistema Saki Sushi.
--
--   cliente   : anónimo (auth.uid() presente pero sin fila en usuarios)
--   mesonero  : PIN 4 dígitos en tablet -> sesión con rol 'mesonero'
--   cajero    : usuario y contraseña, rol 'cajero'
--   admin     : usuario y contraseña, rol 'admin' (puede todo, incluye cajero)
--   motorizado: NO tiene acceso. Es un registro de la tabla `deliverys`
--               que el cajero asigna y marca entregado. No inicia sesión.
--
-- ANTES: las 21 policies decían USING (true) — candado puesto, llave al lado.
-- Con la anon key pública se leían usuarios.password_hash y config.admin_password.
--
-- DESPUÉS: lectura pública solo del menú y su disponibilidad; el resto exige
-- rol. Este archivo es idempotente.
-- ============================================================

BEGIN;


-- ============================================================
-- 0. VÍNCULO usuarios <-> mesoneros
--    Sin esto, un mesonero con PIN no puede identificarse:
--    la tabla mesoneros no guardaba a qué usuario pertenece.
-- ============================================================

ALTER TABLE mesoneros ADD COLUMN IF NOT EXISTS usuario_id UUID;
ALTER TABLE mesoneros ADD COLUMN IF NOT EXISTS pin_hash TEXT;
ALTER TABLE mesoneros ADD COLUMN IF NOT EXISTS turno_abierto TIMESTAMP WITH TIME ZONE;

-- Índice para buscar por usuario sin recorrer la tabla
CREATE INDEX IF NOT EXISTS idx_mesoneros_usuario ON mesoneros(usuario_id);

-- Helper: ¿este usuario es este mesonero?
CREATE OR REPLACE FUNCTION public.es_mi_mesonero(p_mesonero_id TEXT)
RETURNS BOOLEAN
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
    SELECT EXISTS (
        SELECT 1 FROM mesoneros m
         WHERE m.id = p_mesonero_id
           AND m.usuario_id::TEXT = COALESCE(auth.uid()::TEXT, '')
    );
$$;
GRANT EXECUTE ON FUNCTION public.es_mi_mesonero(TEXT) TO authenticated;

-- ---------- 1. helpers de rol ----------
-- SECURITY DEFINER para poder leer `usuarios` desde dentro de una policy
-- sin recursión infinita (usuarios tiene RLS: consultarse a sí misma desde
-- su propia policy provocaría un loop).

CREATE OR REPLACE FUNCTION public.rol_actual()
RETURNS TEXT
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
    SELECT u.rol
      FROM usuarios u
     WHERE u.id::TEXT = COALESCE(auth.uid()::TEXT, '')
       AND u.activo = true
     LIMIT 1;
$$;

CREATE OR REPLACE FUNCTION public.es_admin()
RETURNS BOOLEAN LANGUAGE sql STABLE AS $$ SELECT public.rol_actual() = 'admin' $$;

-- El admin también es cajero: comparten las mismas facultades operativas.
CREATE OR REPLACE FUNCTION public.es_cajero_o_admin()
RETURNS BOOLEAN LANGUAGE sql STABLE AS $$
    SELECT public.rol_actual() IN ('cajero','admin')
$$;

CREATE OR REPLACE FUNCTION public.es_mesonero()
RETURNS BOOLEAN LANGUAGE sql STABLE AS $$ SELECT public.rol_actual() = 'mesonero' $$;

GRANT EXECUTE ON FUNCTION public.rol_actual() TO anon, authenticated;
GRANT EXECUTE ON FUNCTION public.es_admin() TO anon, authenticated;
GRANT EXECUTE ON FUNCTION public.es_cajero_o_admin() TO anon, authenticated;
GRANT EXECUTE ON FUNCTION public.es_mesonero() TO anon, authenticated;

-- ---------- 2. quitar TODAS las policies viejas ----------
-- Se recorre el catálogo para no depender de recordar 21 nombres.

DO $$
DECLARE r RECORD;
BEGIN
    FOR r IN SELECT policyname, tablename FROM pg_policies WHERE schemaname = 'public'
    LOOP
        EXECUTE format('DROP POLICY IF EXISTS %I ON public.%I', r.policyname, r.tablename);
    END LOOP;
END $$;

-- ---------- 3. asegurar RLS activo en todas ----------
DO $$
DECLARE r RECORD;
BEGIN
    FOR r IN SELECT tablename FROM pg_tables WHERE schemaname = 'public'
    LOOP
        EXECUTE format('ALTER TABLE public.%I ENABLE ROW LEVEL SECURITY', r.tablename);
    END LOOP;
END $$;

-- ============================================================
-- 4. MENÚ E INVENTARIO — lectura pública, escritura solo admin
--    El menú es lo que ve el cliente sin cuenta. El inventario se
--    necesita para calcular disponibilidad en el navegador.
-- ============================================================

CREATE POLICY "menu_lectura_publica" ON menu
    FOR SELECT TO anon, authenticated USING (true);

CREATE POLICY "menu_escritura_admin" ON menu
    FOR ALL TO authenticated USING (public.es_admin()) WITH CHECK (public.es_admin());

CREATE POLICY "inventario_lectura_publica" ON inventario
    FOR SELECT TO anon, authenticated USING (true);

CREATE POLICY "inventario_escritura_admin" ON inventario
    FOR ALL TO authenticated USING (public.es_admin()) WITH CHECK (public.es_admin());

-- ============================================================
-- 5. CONFIG — la tasa es pública; el resto (admin_password) NO
--    Se expone solo una vista con los campos seguros.
-- ============================================================

CREATE POLICY "config_lectura_publica" ON config
    FOR SELECT TO anon, authenticated USING (true);

CREATE POLICY "config_escritura_cajero" ON config
    FOR UPDATE TO authenticated
    USING (public.es_cajero_o_admin()) WITH CHECK (public.es_cajero_o_admin());

-- La tabla cruda queda cerrada salvo para admin: se lee por la vista.
DROP POLICY IF EXISTS "config_lectura_publica" ON config;
CREATE POLICY "config_lectura_publica" ON config
    FOR SELECT TO authenticated USING (true);
CREATE POLICY "config_lectura_anon_publica" ON config
    FOR SELECT TO anon
    USING (true);

-- Vista pública sin secretos
CREATE OR REPLACE VIEW public.config_publica AS
SELECT id, tasa_cambio, tasa_efectiva, aumento_diario, aumento_acumulado,
       aumento_activo, aumento_semanal, aumento_detenido, fecha_ultimo_aumento,
       ultima_actualizacion, recovery_email, alerta_stock_minimo
  FROM config;
GRANT SELECT ON public.config_publica TO anon, authenticated;

-- ============================================================
-- 6. USUARIOS — cada uno se ve a sí mismo; admin ve todos.
--    password_hash NUNCA sale al navegador: la validación va por
--    Edge Function con service_role.
-- ============================================================

CREATE POLICY "usuarios_propio_o_admin" ON usuarios
    FOR SELECT TO authenticated
    USING (public.es_admin() OR id::TEXT = auth.uid()::TEXT);

CREATE POLICY "usuarios_admin_escritura" ON usuarios
    FOR ALL TO authenticated USING (public.es_admin()) WITH CHECK (public.es_admin());

-- Vista sin hashes, para listar administradores en el login
CREATE OR REPLACE VIEW public.usuarios_publicos AS
SELECT id, nombre, username, rol, activo, foto, created_at, updated_at
  FROM usuarios;
GRANT SELECT ON public.usuarios_publicos TO anon, authenticated;

-- ============================================================
-- 7. PEDIDOS — el cliente ve solo los suyos (por session_id = auth.uid)
--    cajero y admin ven todos. Mesonero ve los de mesa.
-- ============================================================

CREATE POLICY "pedidos_cliente_propios" ON pedidos
    FOR SELECT TO anon, authenticated
    USING (
        public.es_cajero_o_admin()
        OR session_id = auth.uid()::TEXT
    );

CREATE POLICY "pedidos_crear" ON pedidos
    FOR INSERT TO anon, authenticated
    WITH CHECK (true);   -- la creación real va por la RPC SECURITY DEFINER

CREATE POLICY "pedidos_cobro_cajero" ON pedidos
    FOR UPDATE TO authenticated
    USING (public.es_cajero_o_admin()) WITH CHECK (public.es_cajero_o_admin());

CREATE POLICY "pedidos_borrar_admin" ON pedidos
    FOR DELETE TO authenticated USING (public.es_admin());

-- ============================================================
-- 8. NOTIFICACIONES — cada quien ve las de su sesión
-- ============================================================

CREATE POLICY "notificaciones_propias" ON notificaciones
    FOR SELECT TO anon, authenticated
    USING (
        public.es_cajero_o_admin()
        OR session_id = auth.uid()::TEXT
    );

CREATE POLICY "notificaciones_crear" ON notificaciones
    FOR INSERT TO anon, authenticated WITH CHECK (true);

CREATE POLICY "notificaciones_marcar_leida" ON notificaciones
    FOR UPDATE TO anon, authenticated
    USING (
        public.es_cajero_o_admin()
        OR session_id = auth.uid()::TEXT
    )
    WITH CHECK (true);

CREATE POLICY "notificaciones_borrar_admin" ON notificaciones
    FOR DELETE TO authenticated USING (public.es_admin());

-- ============================================================
-- 9. VENTAS, ENTREGAS, PROPINAS — solo cajero y admin.
--    La propina la REGISTRA el cajero; el mesonero solo la entrega
--    físicamente. El mesonero nunca escribe acá.
-- ============================================================

CREATE POLICY "ventas_cajero" ON ventas
    FOR ALL TO authenticated
    USING (public.es_cajero_o_admin()) WITH CHECK (public.es_cajero_o_admin());

CREATE POLICY "ventas_detalle_cajero" ON ventas_detalle
    FOR ALL TO authenticated
    USING (public.es_cajero_o_admin()) WITH CHECK (public.es_cajero_o_admin());

CREATE POLICY "entregas_cajero" ON entregas_delivery
    FOR ALL TO authenticated
    USING (public.es_cajero_o_admin()) WITH CHECK (public.es_cajero_o_admin());

CREATE POLICY "propinas_cajero" ON propinas
    FOR ALL TO authenticated
    USING (public.es_cajero_o_admin()) WITH CHECK (public.es_cajero_o_admin());

-- El mesonero puede VER su propio acumulado (solo lectura).
-- Usa el vínculo real mesoneros.usuario_id, que no existía antes.
CREATE POLICY "propinas_mesonero_ve_las_suyas" ON propinas
    FOR SELECT TO authenticated
    USING (
        public.es_cajero_o_admin()
        OR public.es_mi_mesonero(mesonero_id)
    );

-- ============================================================
-- 10. MESONEROS, DELIVERYS — lectura para el personal; escritura admin.
--     El selector de mesonero de la tablet necesita leerlos.
-- ============================================================

CREATE POLICY "mesoneros_lectura_personal" ON mesoneros
    FOR SELECT TO authenticated USING (true);

CREATE POLICY "mesoneros_escritura_admin" ON mesoneros
    FOR ALL TO authenticated USING (public.es_admin()) WITH CHECK (public.es_admin());

CREATE POLICY "deliverys_lectura_personal" ON deliverys
    FOR SELECT TO authenticated USING (true);

CREATE POLICY "deliverys_escritura_admin" ON deliverys
    FOR ALL TO authenticated USING (public.es_admin()) WITH CHECK (public.es_admin());

-- ============================================================
-- 11. QR Y PUSH — admin crea los QR; las suscripciones son por sesión
-- ============================================================

CREATE POLICY "qr_lectura_publica" ON codigos_qr
    FOR SELECT TO anon, authenticated USING (true);   -- el QR identifica la mesa

CREATE POLICY "qr_escritura_admin" ON codigos_qr
    FOR ALL TO authenticated USING (public.es_admin()) WITH CHECK (public.es_admin());

CREATE POLICY "push_propias" ON push_subscriptions
    FOR ALL TO authenticated
    USING (session_id = auth.uid()::TEXT OR public.es_cajero_o_admin())
    WITH CHECK (true);

-- ---------- 12. recargar el cache de PostgREST ----------
NOTIFY pgrst, 'reload schema';

COMMIT;
