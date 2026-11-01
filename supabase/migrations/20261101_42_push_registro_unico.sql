-- ============================================================
-- 42 — Una sola puerta para registrar suscripciones push
-- ============================================================
--
-- QUÉ PROBLEMA RESUELVE
--
-- Había tres caminos distintos para escribir en `push_subscriptions`, y los
-- tres fallaban por motivos distintos:
--
--   cliente  hacía `upsert` desde el navegador anónimo. RLS exige permiso de
--            tabla UPDATE y poder LEER la fila para actualizarla; sin SELECT
--            no hay upsert. Devolvía "new row violates row-level security
--            policy", que apunta al lugar equivocado.
--
--   admin    igual, pero con sesión (`authenticated`). Tenía la policy
--   cajero   `push_propias`, que compara `session_id = auth.uid()`: el
--            session_id que manda el panel es un identificador propio de la
--            app, no el uid de Supabase Auth, así que nunca coincidía.
--
-- Los tres comparten la misma necesidad: "guardá MI suscripción". Se resuelve
-- con una sola función.
--
-- EL ROL NO SE RECIBE: SE DEDUCE
-----
-- Este es el punto de seguridad. Si el rol fuera un parámetro, un anónimo
-- podría mandar `'admin'` y quedar suscrito como admin. Acá el rol sale de la
-- sesión:
--
--   · sin sesión            -> 'cliente'   (el visitante de la carta)
--   · sesión de cajero      -> 'cajero'
--   · sesión de admin       -> 'admin'
--   · sesión sin rol claro  -> 'cliente'   (el caso conservador)
--
-- `session_id` sí se recibe porque el visitante anónimo no tiene identidad:
-- lo genera el navegador y lo guarda en localStorage. No otorga permisos,
-- solo agrupa las suscripciones de un mismo dispositivo.
--
-- POR QUÉ NO SE LE DA SELECT A anon
--
-- Sería la salida fácil para el upsert, pero abriría la tabla: anon podría
-- leer los endpoints y las claves de todos los dispositivos suscritos. Sin
-- la privada VAPID no podría enviar push, pero son datos de otros. La función
-- hace el upsert con permisos de dueño y no expone ninguna lectura.
--
-- Compatibilidad: `registrar_push_cliente()` (migración 41) se conserva como
-- envoltorio, para que una pestaña con el JS viejo en caché siga funcionando.
--
-- IDEMPOTENTE.
-- ============================================================

BEGIN;

CREATE OR REPLACE FUNCTION public.registrar_push(
    p_session_id TEXT,
    p_endpoint   TEXT,
    p_p256dh     TEXT,
    p_auth       TEXT,
    p_user_agent TEXT DEFAULT NULL
)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $$
DECLARE
    v_rol TEXT;
    v_id  BIGINT;
BEGIN
    IF p_endpoint IS NULL OR length(btrim(p_endpoint)) = 0 THEN
        RETURN jsonb_build_object('success', false, 'error', 'Falta el endpoint');
    END IF;
    IF p_session_id IS NULL OR length(btrim(p_session_id)) = 0 THEN
        RETURN jsonb_build_object('success', false, 'error', 'Falta el session_id');
    END IF;

    -- El rol se DEDUCE de la sesión, nunca se recibe por parámetro.
    -- `rol_actual()` devuelve NULL sin sesión; `es_admin()`/`es_cajero_o_admin()`
    -- ya existen en el proyecto y respetan el RLS de `usuarios`.
    IF COALESCE(public.es_admin(), false) THEN
        v_rol := 'admin';
    ELSIF COALESCE(public.es_cajero_o_admin(), false) THEN
        v_rol := 'cajero';
    ELSE
        v_rol := 'cliente';
    END IF;

    INSERT INTO push_subscriptions (session_id, endpoint, p256dh, auth, rol, user_agent)
    VALUES (btrim(p_session_id), btrim(p_endpoint), p_p256dh, p_auth, v_rol, p_user_agent)
    ON CONFLICT (endpoint) DO UPDATE
       SET session_id = EXCLUDED.session_id,
           p256dh     = EXCLUDED.p256dh,
           auth       = EXCLUDED.auth,
           user_agent = COALESCE(EXCLUDED.user_agent, push_subscriptions.user_agent),
           -- El rol se actualiza también: un cajero que se suscribe desde el
           -- mismo navegador donde antes era visitante pasa a figurar como
           -- cajero, que es lo correcto para el enrutado de notificaciones.
           rol        = EXCLUDED.rol
    RETURNING id INTO v_id;

    RETURN jsonb_build_object('success', true, 'id', v_id, 'rol', v_rol);
END;
$$;

REVOKE ALL ON FUNCTION public.registrar_push(TEXT, TEXT, TEXT, TEXT, TEXT) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.registrar_push(TEXT, TEXT, TEXT, TEXT, TEXT) TO anon, authenticated;

-- Envoltorio de compatibilidad: el JS viejo que siga llamando a la función de
-- la migración 41 sigue funcionando y termina en la misma implementación.
CREATE OR REPLACE FUNCTION public.registrar_push_cliente(
    p_session_id TEXT,
    p_endpoint   TEXT,
    p_p256dh     TEXT,
    p_auth       TEXT,
    p_user_agent TEXT DEFAULT NULL
)
RETURNS JSONB
LANGUAGE sql
SECURITY DEFINER
SET search_path TO 'public'
AS $$
    SELECT public.registrar_push(p_session_id, p_endpoint, p_p256dh, p_auth, p_user_agent);
$$;

REVOKE ALL ON FUNCTION public.registrar_push_cliente(TEXT, TEXT, TEXT, TEXT, TEXT) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.registrar_push_cliente(TEXT, TEXT, TEXT, TEXT, TEXT) TO anon, authenticated;

COMMIT;
