-- ============================================================
-- 20261021_05_rls_cierre_lectura.sql
--
-- Cierra la fuga más grave del sistema: hoy las 23 policies son
-- USING (true), así que con la anon key (que es pública por diseño y está
-- escrita en supabase-config.js) cualquiera lee, sin autenticarse:
--
--   usuarios.password_hash   (bcrypt de los 3 usuarios)
--   config.admin_password    (texto plano: '654321')
--
-- Verificado desde la consola del navegador: `from('usuarios')
-- .select('password_hash')` devuelve 2 filas con el hash incluido.
--
-- POR QUÉ LA MIGRACIÓN 03 NO SIRVE TAL CUAL
--
-- La 03 define `rol_actual()` como:
--     SELECT rol FROM usuarios WHERE id::TEXT = auth.uid()::TEXT
--
-- Eso compara `usuarios.id` (que es TEXT con forma `user_<uuid>_<n>`) contra
-- `auth.uid()`, que es el UUID de auth.users. Nunca coinciden, así que
-- `rol_actual()` devolvía NULL para todos — incluido el admin — y aplicar
-- esa migración habría dejado las tres apps sin acceso.
--
-- PERO SÍ HAY SESIÓN REAL. La Edge Function `login` crea un usuario en
-- auth.users y guarda el id de nuestra tabla en la metadata:
--
--   raw_user_meta_data->>'custom_user_id' = usuarios.id
--   raw_user_meta_data->>'rol'            = usuarios.rol
--
-- Los dos usuarios vivos lo tienen puesto (admin y cajero1). O sea: el
-- vínculo que faltaba está en la metadata, no en una columna.
--
-- Este archivo corrige `rol_actual()` para leer de ahí y aplica un cierre
-- de lectura por capas, de forma que nada se rompa:
--
--   capa 1  vistas públicas sin secretos (usuarios_publicos, config_publica)
--   capa 2  escritura de datos sensibles solo con rol
--   capa 3  lectura de datos sensibles solo con rol
--
-- Es idempotente: se puede aplicar más de una vez.
-- ============================================================

BEGIN;


-- ============================================================
-- 0. Helpers de rol — corregidos contra la metadata de auth.users
-- ============================================================

CREATE OR REPLACE FUNCTION public.rol_actual()
RETURNS TEXT
LANGUAGE sql
STABLE
SECURITY DEFINER          -- lee usuarios sin recursión de RLS
SET search_path = public, auth
AS $$
    SELECT COALESCE(
        -- 1) fuente principal: la metadata que escribe la Edge Function login
        (SELECT NULLIF(a.raw_user_meta_data->>'rol', '')
           FROM auth.users a
          WHERE a.id = auth.uid()
          LIMIT 1),
        -- 2) respaldo: cruzar el custom_user_id contra nuestra tabla
        (SELECT u.rol
           FROM auth.users a
           JOIN usuarios u ON u.id::TEXT = a.raw_user_meta_data->>'custom_user_id'
          WHERE a.id = auth.uid()
            AND u.activo = true
          LIMIT 1)
    );
$$;

CREATE OR REPLACE FUNCTION public.es_admin()
RETURNS BOOLEAN
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public
AS $$ SELECT public.rol_actual() = 'admin' $$;

-- El admin también es cajero: comparten las mismas facultades operativas.
CREATE OR REPLACE FUNCTION public.es_cajero_o_admin()
RETURNS BOOLEAN
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public
AS $$ SELECT public.rol_actual() IN ('cajero','admin') $$;

CREATE OR REPLACE FUNCTION public.es_mesonero()
RETURNS BOOLEAN
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public
AS $$ SELECT public.rol_actual() = 'mesonero' $$;

GRANT EXECUTE ON FUNCTION public.rol_actual()        TO anon, authenticated;
GRANT EXECUTE ON FUNCTION public.es_admin()          TO anon, authenticated;
GRANT EXECUTE ON FUNCTION public.es_cajero_o_admin() TO anon, authenticated;
GRANT EXECUTE ON FUNCTION public.es_mesonero()       TO anon, authenticated;


-- ============================================================
-- 1. VISTAS PÚBLICAS SIN SECRETOS
--    El frontend lee estas vistas en vez de las tablas crudas.
-- ============================================================

-- Usuarios sin hash. Es lo que el login necesita para listar administradores.
CREATE OR REPLACE VIEW public.usuarios_publicos AS
SELECT id, nombre, username, rol, activo, foto, created_at, updated_at
  FROM usuarios;

GRANT SELECT ON public.usuarios_publicos TO anon, authenticated;

-- Config sin la contraseña de administración.
CREATE OR REPLACE VIEW public.config_publica AS
SELECT id, tasa_cambio, tasa_efectiva, aumento_diario, aumento_acumulado,
       aumento_activo, aumento_semanal, aumento_detenido,
       aumento_desde, aumento_hasta, aumento_indefinido,
       fecha_ultimo_aumento, ultima_actualizacion,
       recovery_email, alerta_stock_minimo
  FROM config;

GRANT SELECT ON public.config_publica TO anon, authenticated;

-- Las vistas corren con los permisos de su dueño salvo que se marquen como
-- security_invoker. En Postgres 15+ conviene dejarlas como invoker para que
-- respeten el RLS de la tabla base según quién consulta; pero eso volvería
-- a exigir permiso sobre `config`, que estamos cerrando. Se dejan como
-- definer (comportamiento por defecto) a propósito: la vista ES la interfaz
-- pública, y filtra las columnas sensibles por construcción.


-- ============================================================
-- 2. QUITAR LAS POLICIES PERMISIVAS
--    Se recorre el catálogo para no depender de recordar los nombres.
-- ============================================================

DO $$
DECLARE r RECORD;
BEGIN
    FOR r IN SELECT policyname, tablename FROM pg_policies WHERE schemaname = 'public'
    LOOP
        EXECUTE format('DROP POLICY IF EXISTS %I ON public.%I', r.policyname, r.tablename);
    END LOOP;
END $$;

-- Asegurar RLS activo en todas las tablas
DO $$
DECLARE r RECORD;
BEGIN
    FOR r IN SELECT tablename FROM pg_tables WHERE schemaname = 'public'
    LOOP
        EXECUTE format('ALTER TABLE public.%I ENABLE ROW LEVEL SECURITY', r.tablename);
    END LOOP;
END $$;


-- ============================================================
-- 3. CATÁLOGO PÚBLICO — menú, inventario, QR
--    El cliente sin cuenta tiene que poder ver el menú y calcular
--    disponibilidad. Escritura: solo admin.
-- ============================================================

CREATE POLICY "menu_lectura_publica" ON menu
    FOR SELECT TO anon, authenticated USING (true);

CREATE POLICY "menu_escritura_admin" ON menu
    FOR ALL TO authenticated
    USING (public.es_admin()) WITH CHECK (public.es_admin());

CREATE POLICY "inventario_lectura_publica" ON inventario
    FOR SELECT TO anon, authenticated USING (true);

CREATE POLICY "inventario_escritura_admin" ON inventario
    FOR ALL TO authenticated
    USING (public.es_admin()) WITH CHECK (public.es_admin());

-- El QR identifica la mesa y se lee sin cuenta.
CREATE POLICY "qr_lectura_publica" ON codigos_qr
    FOR SELECT TO anon, authenticated USING (true);

CREATE POLICY "qr_escritura_admin" ON codigos_qr
    FOR ALL TO authenticated
    USING (public.es_admin()) WITH CHECK (public.es_admin());


-- ============================================================
-- 4. CONFIG
--    Lectura pública SOLO por la vista. La tabla cruda queda para
--    cajero y admin, que son los que ven la tasa efectiva y editan.
--    `admin_password` deja de ser legible incluso para el cajero.
-- ============================================================

CREATE POLICY "config_lectura_cajero_admin" ON config
    FOR SELECT TO authenticated
    USING (public.es_cajero_o_admin());

CREATE POLICY "config_escritura_cajero_admin" ON config
    FOR UPDATE TO authenticated
    USING (public.es_cajero_o_admin()) WITH CHECK (public.es_cajero_o_admin());


-- ============================================================
-- 5. USUARIOS
--    Nadie lee la tabla cruda salvo el admin. El resto usa la vista.
--    Escritura: solo admin. Sin esto, cualquiera podía insertarse un
--    usuario con rol admin.
-- ============================================================

CREATE POLICY "usuarios_lectura_admin" ON usuarios
    FOR SELECT TO authenticated
    USING (public.es_admin());

CREATE POLICY "usuarios_escritura_admin" ON usuarios
    FOR ALL TO authenticated
    USING (public.es_admin()) WITH CHECK (public.es_admin());


-- ============================================================
-- 6. PEDIDOS Y NOTIFICACIONES
--    El cliente anónimo ve lo suyo; cajero y admin ven todo.
--    La creación real va por la RPC SECURITY DEFINER (migración 01),
--    que no pasa por estas policies.
-- ============================================================

CREATE POLICY "pedidos_lectura_propios" ON pedidos
    FOR SELECT TO anon, authenticated
    USING (
        public.es_cajero_o_admin()
        OR session_id = auth.uid()::TEXT
    );

CREATE POLICY "pedidos_escritura_cajero" ON pedidos
    FOR UPDATE TO authenticated
    USING (public.es_cajero_o_admin()) WITH CHECK (public.es_cajero_o_admin());

CREATE POLICY "pedidos_borrar_admin" ON pedidos
    FOR DELETE TO authenticated USING (public.es_admin());

CREATE POLICY "notificaciones_lectura_propias" ON notificaciones
    FOR SELECT TO anon, authenticated
    USING (
        public.es_cajero_o_admin()
        OR session_id = auth.uid()::TEXT
    );

CREATE POLICY "notificaciones_escritura_cajero" ON notificaciones
    FOR UPDATE TO anon, authenticated
    USING (
        public.es_cajero_o_admin()
        OR session_id = auth.uid()::TEXT
    )
    WITH CHECK (true);

CREATE POLICY "notificaciones_borrar_admin" ON notificaciones
    FOR DELETE TO authenticated USING (public.es_admin());


-- ============================================================
-- 7. PERSONAL — ventas, entregas, propinas
--    Solo cajero y admin. El mesonero nunca escribe propinas:
--    las recibe físicamente y el cajero las registra.
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

CREATE POLICY "mesoneros_lectura_personal" ON mesoneros
    FOR SELECT TO authenticated USING (true);

CREATE POLICY "mesoneros_escritura_admin" ON mesoneros
    FOR ALL TO authenticated
    USING (public.es_admin()) WITH CHECK (public.es_admin());

CREATE POLICY "deliverys_lectura_personal" ON deliverys
    FOR SELECT TO authenticated USING (true);

CREATE POLICY "deliverys_escritura_admin" ON deliverys
    FOR ALL TO authenticated
    USING (public.es_admin()) WITH CHECK (public.es_admin());

CREATE POLICY "push_propias" ON push_subscriptions
    FOR ALL TO authenticated
    USING (session_id = auth.uid()::TEXT OR public.es_cajero_o_admin())
    WITH CHECK (true);


-- ============================================================
-- 8. TABLAS SIN ACCESO PÚBLICO
--    Se dejan cerradas; las usa el backend o nadie.
-- ============================================================

CREATE POLICY "recipe_admin" ON recipe_ingredients
    FOR ALL TO authenticated
    USING (public.es_admin()) WITH CHECK (public.es_admin());

CREATE POLICY "tokens_admin" ON recuperacion_tokens
    FOR ALL TO authenticated
    USING (public.es_admin()) WITH CHECK (public.es_admin());

CREATE POLICY "sesiones_cajero_admin" ON sesiones_activas
    FOR ALL TO authenticated
    USING (public.es_cajero_o_admin()) WITH CHECK (public.es_cajero_o_admin());


-- ---------- recargar el cache de PostgREST ----------
NOTIFY pgrst, 'reload schema';

COMMIT;
