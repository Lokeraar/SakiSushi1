-- ============================================================================
-- 44 — Reconciliar identidad de cliente y registro push
-- ============================================================================
--
-- QUÉ PASÓ
--
-- Las migraciones 42 y 43 definían `registrar_push_cliente` con firmas
-- distintas:
--
--   42  ->  (p_session_id, p_endpoint, p_p256dh, p_auth, p_user_agent)
--   43  ->  (p_ficha,      p_endpoint, p_p256dh, p_auth, p_user_agent)
--
-- PostgreSQL NO reemplaza una función cuando cambia el nombre o el tipo de un
-- parámetro: crea una sobrecarga nueva. Y como la 42 se aplicó después de la
-- 43, la que quedó viva en la base fue la de 42, con `p_session_id`.
--
-- El cliente ya manda `p_ficha`, así que PostgREST no encontraba la función y
-- el registro de push del visitante fallaba en silencio. El síntoma era el de
-- siempre: permiso concedido, sin suscripción y sin ningún error visible.
--
-- Al intentar cambiar el nombre del parámetro directamente, PostgreSQL
-- responde:
--
--   cannot change name of input parameter "p_session_id"
--
-- porque eso cambia la firma. La única forma limpia es borrar y recrear.
--
-- LA DECISIÓN
--
-- Una sola puerta para el cliente: `registrar_push_cliente(p_ficha, ...)`.
-- El rol lo deduce la base, como ya estaba resuelto en la 42, y la identidad
-- sale de la ficha firmada o de la sesión de Auth.
--
-- `registrar_push(...)` se conserva intacta porque la usan el admin y el
-- cajero, que sí tienen sesión de Supabase Auth y mandan su propio
-- identificador de sesión.
-- ============================================================================

BEGIN;

-- Se borran TODAS las variantes de la firma vieja y de la firma nueva, para
-- que no quede ninguna sobrecarga huérfana que PostgREST pueda elegir.
DROP FUNCTION IF EXISTS public.registrar_push_cliente(TEXT, TEXT, TEXT, TEXT, TEXT);

-- Función única para el visitante.
--
-- No recibe el rol: lo deduce. Un anónimo con ficha válida es siempre
-- 'cliente', y no hay parámetro que permita pedir otra cosa.
CREATE OR REPLACE FUNCTION public.registrar_push_cliente(
    p_ficha      TEXT,
    p_endpoint   TEXT,
    p_p256dh     TEXT,
    p_auth       TEXT,
    p_user_agent TEXT DEFAULT NULL
)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
    v_id  TEXT;
    v_row public.push_subscriptions;
BEGIN
    v_id := public.cliente_actual(p_ficha);

    IF v_id IS NULL THEN
        RETURN jsonb_build_object('success', false, 'error', 'ficha_invalida');
    END IF;

    INSERT INTO public.push_subscriptions AS ps
        (session_id, endpoint, p256dh, auth, user_agent, rol)
    VALUES
        (v_id, btrim(p_endpoint), p_p256dh, p_auth, p_user_agent, 'cliente')
    ON CONFLICT (endpoint) DO UPDATE
        SET session_id = EXCLUDED.session_id,
            p256dh     = EXCLUDED.p256dh,
            auth       = EXCLUDED.auth,
            rol        = 'cliente',
            last_used  = NOW()
    RETURNING * INTO v_row;

    RETURN jsonb_build_object('success', true, 'id', v_row.id, 'rol', v_row.rol);
END;
$$;

REVOKE ALL ON FUNCTION public.registrar_push_cliente(TEXT, TEXT, TEXT, TEXT, TEXT) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.registrar_push_cliente(TEXT, TEXT, TEXT, TEXT, TEXT) TO anon, authenticated;

COMMIT;
