-- ============================================
-- SISTEMA DE RECUPERACIÓN DE CONTRASEÑA
-- Para Saki Sushi - Permite emails compartidos
-- ============================================

-- ============================================
-- 1. AGREGAR CAMPO email_recuperacion A TABLA usuarios
-- ============================================

-- Agregar columna email_recuperacion si no existe
ALTER TABLE usuarios 
ADD COLUMN IF NOT EXISTS email_recuperacion TEXT;

-- NOTA: No agregamos UNIQUE porque permitimos emails compartidos
-- Solo creamos índice para búsquedas eficientes
CREATE INDEX IF NOT EXISTS idx_usuarios_email_recuperacion 
ON usuarios(email_recuperacion);

-- Actualizar usuarios existentes con un email por defecto (opcional)
-- UPDATE usuarios SET email_recuperacion = 'admin@sakisushi.com' WHERE email_recuperacion IS NULL;

-- ============================================
-- 2. CREAR TABLA recuperacion_tokens
-- ============================================

CREATE TABLE IF NOT EXISTS recuperacion_tokens (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    usuario_id TEXT NOT NULL REFERENCES usuarios(id) ON DELETE CASCADE,
    token TEXT UNIQUE NOT NULL,
    email TEXT NOT NULL,
    ip_origen TEXT,
    user_agent TEXT,
    creado_en TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
    expira_en TIMESTAMP WITH TIME ZONE NOT NULL,
    usado BOOLEAN DEFAULT FALSE,
    usado_en TIMESTAMP WITH TIME ZONE,
    intentos_fallidos INTEGER DEFAULT 0,
    ultima_intento TIMESTAMP WITH TIME ZONE
);

-- Índices para consultas eficientes
CREATE INDEX IF NOT EXISTS idx_recuperacion_tokens_token ON recuperacion_tokens(token);
CREATE INDEX IF NOT EXISTS idx_recuperacion_tokens_usuario ON recuperacion_tokens(usuario_id);
CREATE INDEX IF NOT EXISTS idx_recuperacion_tokens_expira ON recuperacion_tokens(expira_en);
CREATE INDEX IF NOT EXISTS idx_recuperacion_tokens_email ON recuperacion_tokens(email);

-- Habilitar RLS
ALTER TABLE recuperacion_tokens ENABLE ROW LEVEL SECURITY;

-- Políticas de seguridad (usar DROP IF EXISTS para permitir re-ejecución)
DROP POLICY IF EXISTS "Tokens pueden ser leídos para validación" ON recuperacion_tokens;
CREATE POLICY "Tokens pueden ser leídos para validación" 
ON recuperacion_tokens FOR SELECT 
USING (true);

DROP POLICY IF EXISTS "Inserción de tokens" ON recuperacion_tokens;
CREATE POLICY "Inserción de tokens" 
ON recuperacion_tokens FOR INSERT 
WITH CHECK (true);

DROP POLICY IF EXISTS "Actualización de tokens" ON recuperacion_tokens;
CREATE POLICY "Actualización de tokens" 
ON recuperacion_tokens FOR UPDATE 
USING (true);

-- Grant de permisos
GRANT SELECT, INSERT, UPDATE ON recuperacion_tokens TO anon, authenticated;
GRANT SELECT, INSERT, UPDATE ON recuperacion_tokens TO PUBLIC;

-- ============================================
-- 3. FUNCIÓN: verificar_email_recuperacion
-- Verifica si un email existe y retorna usuarios asociados
-- ============================================

DROP FUNCTION IF EXISTS verificar_email_recuperacion(TEXT);

CREATE OR REPLACE FUNCTION verificar_email_recuperacion(p_email TEXT)
RETURNS TABLE (
    success BOOLEAN,
    error TEXT,
    usuarios JSONB
) AS $$
DECLARE
    v_email TEXT := LOWER(TRIM(p_email));
    v_usuarios JSONB;
BEGIN
    -- Validar formato de email
    IF v_email !~* '^[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Za-z]{2,}$' THEN
        RETURN QUERY SELECT false, 'Formato de email inválido', NULL::JSONB;
        RETURN;
    END IF;

    -- Buscar usuarios con este email de recuperación
    SELECT jsonb_agg(
        jsonb_build_object(
            'id', u.id,
            'nombre', u.nombre,
            'username', u.username,
            'rol', u.rol,
            'activo', u.activo
        )
    ) INTO v_usuarios
    FROM usuarios u
    WHERE LOWER(TRIM(COALESCE(u.email_recuperacion, ''))) = v_email
      AND u.activo = true;

    -- Verificar si se encontraron usuarios
    IF v_usuarios IS NULL OR v_usuarios = '[]'::jsonb THEN
        RETURN QUERY SELECT false, 'No se encontró ningún usuario con este email', NULL::JSONB;
        RETURN;
    END IF;

    RETURN QUERY SELECT true, NULL::TEXT, v_usuarios;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

GRANT EXECUTE ON FUNCTION verificar_email_recuperacion TO anon, authenticated;
GRANT EXECUTE ON FUNCTION verificar_email_recuperacion TO PUBLIC;

-- ============================================
-- 4. FUNCIÓN: generar_token_recuperacion
-- Genera un token único temporal para recuperación
-- ============================================

DROP FUNCTION IF EXISTS generar_token_recuperacion(TEXT, TEXT, TEXT, TEXT);

CREATE OR REPLACE FUNCTION generar_token_recuperacion(
    p_usuario_id TEXT,
    p_email TEXT,
    p_ip_origen TEXT DEFAULT NULL,
    p_user_agent TEXT DEFAULT NULL
)
RETURNS TABLE (
    success BOOLEAN,
    error TEXT,
    token TEXT,
    expira_en_result TIMESTAMP WITH TIME ZONE
) AS $$
DECLARE
    v_token TEXT;
    v_expira_en TIMESTAMP WITH TIME ZONE;
    v_usuario_existe BOOLEAN;
    v_email TEXT := LOWER(TRIM(p_email));
BEGIN
    -- Verificar que el usuario existe y está activo
    SELECT EXISTS(
        SELECT 1 FROM usuarios 
        WHERE id = p_usuario_id 
          AND activo = true
          AND LOWER(TRIM(COALESCE(email_recuperacion, ''))) = v_email
    ) INTO v_usuario_existe;

    IF NOT v_usuario_existe THEN
        RETURN QUERY SELECT false, 'Usuario no encontrado o email no coincide', NULL::TEXT, NULL::TIMESTAMP WITH TIME ZONE;
        RETURN;
    END IF;

    -- Generar token único usando crypto
    v_token := encode(gen_random_bytes(32), 'hex');

    -- Configurar expiración (1 hora desde ahora)
    v_expira_en := NOW() + INTERVAL '1 hour';

    -- Invalidar tokens anteriores no usados del mismo usuario
    UPDATE recuperacion_tokens AS rt
    SET usado = true,
        usado_en = NOW()
    WHERE rt.usuario_id = p_usuario_id
      AND rt.usado = false
      AND rt.expira_en > NOW();

    -- Insertar nuevo token
    INSERT INTO recuperacion_tokens (
        usuario_id,
        token,
        email,
        ip_origen,
        user_agent,
        expira_en
    ) VALUES (
        p_usuario_id,
        v_token,
        v_email,
        p_ip_origen,
        p_user_agent,
        v_expira_en
    );

    RETURN QUERY SELECT 
        true AS success, 
        NULL::TEXT AS error, 
        v_token AS token, 
        v_expira_en AS "expira_en_result";
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

GRANT EXECUTE ON FUNCTION generar_token_recuperacion TO anon, authenticated;
GRANT EXECUTE ON FUNCTION generar_token_recuperacion TO PUBLIC;

-- ============================================
-- 5. FUNCIÓN: validar_token_recuperacion
-- Valida un token y retorna información del usuario
-- ============================================

DROP FUNCTION IF EXISTS validar_token_recuperacion(TEXT);

CREATE OR REPLACE FUNCTION validar_token_recuperacion(p_token TEXT)
RETURNS TABLE (
    success BOOLEAN,
    error TEXT,
    usuario_id TEXT,
    username TEXT,
    nombre TEXT,
    email TEXT,
    puede_usarse BOOLEAN
) AS $$
DECLARE
    v_token_data RECORD;
    v_window_minutes INTEGER := 10; -- Ventana de reuso de 10 minutos
BEGIN
    -- Buscar el token
    SELECT rt.*, u.username, u.nombre
    INTO v_token_data
    FROM recuperacion_tokens rt
    JOIN usuarios u ON rt.usuario_id = u.id
    WHERE rt.token = p_token;

    -- Verificar si el token existe
    IF v_token_data.id IS NULL THEN
        RETURN QUERY SELECT false, 'Token inválido o no existe', NULL::TEXT, NULL::TEXT, NULL::TEXT, NULL::TEXT, false;
        RETURN;
    END IF;

    -- Verificar si el token ya expiró
    IF v_token_data.expira_en < NOW() THEN
        -- Marcar como usado para limpiar
        UPDATE recuperacion_tokens
        SET usado = true, usado_en = NOW()
        WHERE id = v_token_data.id;

        RETURN QUERY SELECT false, 'Token expirado', NULL::TEXT, NULL::TEXT, NULL::TEXT, NULL::TEXT, false;
        RETURN;
    END IF;

    -- Verificar ventana de reuso (10 minutos desde el último uso o creación)
    IF v_token_data.usado THEN
        -- Si ya fue usado, verificar si está dentro de la ventana de 10 minutos
        IF COALESCE(v_token_data.usado_en, v_token_data.creado_en) + 
           (v_window_minutes || ' minutes')::INTERVAL < NOW() THEN
            RETURN QUERY SELECT false, 'Token ya utilizado fuera de la ventana permitida', 
                NULL::TEXT, NULL::TEXT, NULL::TEXT, NULL::TEXT, false;
        END IF;
    END IF;

    -- Incrementar contador de intentos (para logging)
    UPDATE recuperacion_tokens
    SET intentos_fallidos = intentos_fallidos + 1,
        ultima_intento = NOW()
    WHERE id = v_token_data.id;

    -- Token válido
    RETURN QUERY SELECT 
        true AS success,
        NULL::TEXT AS error,
        v_token_data.usuario_id AS usuario_id,
        v_token_data.username AS username,
        v_token_data.nombre AS nombre,
        v_token_data.email AS email,
        true AS puede_usarse;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER STABLE;

GRANT EXECUTE ON FUNCTION validar_token_recuperacion TO anon, authenticated;
GRANT EXECUTE ON FUNCTION validar_token_recuperacion TO PUBLIC;

-- ============================================
-- 6. FUNCIÓN: actualizar_contrasena_con_token
-- Actualiza la contraseña usando un token válido
-- ============================================

DROP FUNCTION IF EXISTS actualizar_contrasena_con_token(TEXT, TEXT);

CREATE OR REPLACE FUNCTION actualizar_contrasena_con_token(
    p_token TEXT,
    p_nueva_password TEXT
)
RETURNS TABLE (
    success BOOLEAN,
    error TEXT,
    usuario_id TEXT
) AS $$
DECLARE
    v_usuario_id TEXT;
    v_password_hash TEXT;
    v_token_valido BOOLEAN;
BEGIN
    -- Validar el token primero
    SELECT can_use, usr_id INTO v_token_valido, v_usuario_id
    FROM (
        SELECT 
            rt.usado = false OR 
            (COALESCE(rt.usado_en, rt.creado_en) + (10 || ' minutes')::INTERVAL >= NOW()) as can_use,
            rt.usuario_id as usr_id
        FROM recuperacion_tokens rt
        WHERE rt.token = p_token
          AND rt.expira_en > NOW()
    ) subquery
    WHERE can_use = true
    LIMIT 1;

    IF v_usuario_id IS NULL THEN
        RETURN QUERY SELECT false, 'Token inválido o expirado', NULL::TEXT;
        RETURN;
    END IF;

    -- Validar fortaleza de contraseña (mínimo 6 caracteres)
    IF LENGTH(TRIM(p_nueva_password)) < 6 THEN
        RETURN QUERY SELECT false, 'La contraseña debe tener al menos 6 caracteres', NULL::TEXT;
        RETURN;
    END IF;

    -- Hashear la nueva contraseña usando bcrypt
    SELECT crypt(p_nueva_password, gen_salt('bf', 8)) INTO v_password_hash;

    -- Actualizar contraseña en la tabla usuarios
    UPDATE usuarios
    SET password_hash = v_password_hash,
        updated_at = NOW()
    WHERE id = v_usuario_id
      AND activo = true;

    IF NOT FOUND THEN
        RETURN QUERY SELECT false, 'No se pudo actualizar la contraseña', NULL::TEXT;
        RETURN;
    END IF;

    -- Marcar token como usado
    UPDATE recuperacion_tokens
    SET usado = true,
        usado_en = NOW()
    WHERE token = p_token;

    -- Invalidar todos los demás tokens activos del mismo usuario
    UPDATE recuperacion_tokens
    SET usado = true,
        usado_en = NOW()
    WHERE usuario_id = v_usuario_id
      AND token != p_token
      AND usado = false;

    RETURN QUERY SELECT 
        true AS success, 
        NULL::TEXT AS error, 
        v_usuario_id AS usuario_id;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

GRANT EXECUTE ON FUNCTION actualizar_contrasena_con_token TO anon, authenticated;
GRANT EXECUTE ON FUNCTION actualizar_contrasena_con_token TO PUBLIC;

-- ============================================
-- 7. FUNCIÓN LIMPIEZA: eliminar_tokens_expirados
-- Función para limpieza periódica de tokens
-- ============================================

DROP FUNCTION IF EXISTS eliminar_tokens_expirados();

CREATE OR REPLACE FUNCTION eliminar_tokens_expirados()
RETURNS INTEGER AS $$
DECLARE
    v_eliminados INTEGER;
BEGIN
    DELETE FROM recuperacion_tokens
    WHERE expira_en < NOW() - INTERVAL '24 hours'
       OR (usado = true AND usado_en < NOW() - INTERVAL '1 hour');

    GET DIAGNOSTICS v_eliminados = ROW_COUNT;
    RETURN v_eliminados;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

GRANT EXECUTE ON FUNCTION eliminar_tokens_expirados TO anon, authenticated;
GRANT EXECUTE ON FUNCTION eliminar_tokens_expirados TO PUBLIC;

-- ============================================
-- 8. FUNCIÓN: obtener_info_usuario_por_id
-- Obtiene información básica de un usuario por ID
-- ============================================

DROP FUNCTION IF EXISTS obtener_info_usuario_por_id(TEXT);

CREATE OR REPLACE FUNCTION obtener_info_usuario_por_id(p_usuario_id TEXT)
RETURNS TABLE (
    success BOOLEAN,
    error TEXT,
    id TEXT,
    nombre TEXT,
    username TEXT,
    rol TEXT,
    email_recuperacion TEXT
) AS $$
BEGIN
    RETURN QUERY
    SELECT 
        true,
        NULL::TEXT,
        u.id,
        u.nombre,
        u.username,
        u.rol,
        u.email_recuperacion
    FROM usuarios u
    WHERE u.id = p_usuario_id
      AND u.activo = true;

    -- Si no se encontró, retornar error
    IF NOT FOUND THEN
        RETURN QUERY SELECT false, 'Usuario no encontrado', NULL::TEXT, NULL::TEXT, NULL::TEXT, NULL::TEXT, NULL::TEXT;
    END IF;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER STABLE;

GRANT EXECUTE ON FUNCTION obtener_info_usuario_por_id TO anon, authenticated;
GRANT EXECUTE ON FUNCTION obtener_info_usuario_por_id TO PUBLIC;

-- ============================================
-- 9. TRIGGER: Limpieza automática de tokens viejos
-- Se ejecuta cada hora (requiere pg_cron o similar en producción)
-- ============================================

-- Nota: Para ejecución automática periódica, configurar pg_cron en Supabase:
-- SELECT cron.schedule(
--     'limpieza-tokens-horaria',
--     '0 * * * *',  -- Cada hora
--     $$SELECT eliminar_tokens_expirados()$$
-- );

-- ============================================
-- 10. DATOS DE PRUEBA (OPCIONAL)
-- ============================================

-- Actualizar algunos usuarios con emails de prueba
-- Descomentar solo si se desea probar con datos específicos
/*
UPDATE usuarios 
SET email_recuperacion = 'admin@sakisushi.com'
WHERE username = 'admin';

UPDATE usuarios 
SET email_recuperacion = 'cajero@sakisushi.com'
WHERE username IN ('cajero1', 'cajero2');
*/

-- ============================================
-- VERIFICACIÓN FINAL
-- ============================================

SELECT '✅ Tabla recuperacion_tokens creada' as estado;
SELECT '✅ Funciones RPC creadas' as estado;
SELECT '✅ Columna email_recuperacion agregada' as estado;
SELECT '✅ Permisos configurados' as estado;

-- Verificar que todo esté correcto
SELECT 
    (SELECT COUNT(*) FROM recuperacion_tokens) as tokens_existentes,
    (SELECT COUNT(*) FROM usuarios WHERE email_recuperacion IS NOT NULL) as usuarios_con_email;
