-- ============================================================
-- 49 — Reclamar los pedidos anónimos al registrarse
-- ============================================================
--
-- QUÉ PROBLEMA RESUELVE
--
-- Un cliente pide tres veces como anónimo (con su ficha) y después crea una
-- cuenta. Sin este paso esos tres pedidos quedan colgados del identificador
-- anónimo para siempre: al entrar con su cuenta ve el historial vacío y
-- parece que la app perdió sus pedidos.
--
-- CÓMO FUNCIONA
--
--   `reclamar_pedidos_anonimos(p_ficha)` se llama justo después de crear la
--   cuenta o de iniciar sesión. Mueve a `auth.uid()` los pedidos y las
--   notificaciones que pertenecían a la ficha.
--
-- POR QUÉ NO ALCANZA CON "MOVER TODO LO DE ESTE TELÉFONO"
--
--   Solo se mueve lo que prueba ser de este cliente: la ficha viaja firmada
--   por el servidor. Sin firma válida no se mueve nada, igual que no se
--   devuelve nada en `pedidos_de_cliente`.
--
-- QUÉ PASA SI EL CLIENTE YA TENÍA PEDIDOS CON SU CUENTA
--
--   No se pierde nada: la reclamación solo AGREGA los anónimos a los que ya
--   tenía. Nunca borra ni sobrescribe.
--
-- QUÉ PASA SI SE REGISTRA DESDE OTRO TELÉFONO
--
--   La ficha de ese otro teléfono es distinta, así que sus pedidos anónimos
--   no se mueven: se reclamarían solo si abre la app en ese teléfono y entra
--   con la misma cuenta. Es el comportamiento correcto; se documenta acá
--   para que no sorprenda.
--
-- POR QUÉ NO SE PUEDE LLAMAR DOS VECES PARA ROBAR PEDIDOS AJENOS
--
--   La función exige sesión (`auth.uid()` no nulo) Y una ficha válida. La
--   ficha la emite el servidor con HMAC de 256 bits, así que no se puede
--   inventar. Además, después de reclamar, los pedidos ya están en
--   `auth.uid()` y la ficha ya no los ve, así que una segunda llamada no
--   encuentra nada que mover.
-- ============================================================

BEGIN;

CREATE OR REPLACE FUNCTION public.reclamar_pedidos_anonimos(p_ficha TEXT)
 RETURNS JSONB
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'pg_temp'
AS $function$
DECLARE
    v_ficha_id   TEXT;
    v_uid        TEXT;
    v_pedidos    INT := 0;
    v_notifs     INT := 0;
    v_push       INT := 0;
BEGIN
    -- 1. Tiene que haber sesión. Reclamar es pasar cosas A una cuenta.
    v_uid := auth.uid()::TEXT;
    IF v_uid IS NULL THEN
        RETURN jsonb_build_object(
            'success', false,
            'error', 'sin_sesion',
            'mensaje', 'Necesitas iniciar sesión para recuperar tus pedidos.'
        );
    END IF;

    -- 2. La ficha tiene que ser válida. Sin esto, cualquiera con una sesión
    --    podría reclamar los pedidos de cualquier identificador adivinado.
    v_ficha_id := public.ficha_valida(p_ficha);
    IF v_ficha_id IS NULL THEN
        RETURN jsonb_build_object(
            'success', false,
            'error', 'ficha_invalida',
            'mensaje', 'No se pudo verificar este dispositivo.'
        );
    END IF;

    -- 3. Si la ficha ya es esta misma cuenta, no hay nada que mover.
    --    Pasa si el cliente se registró y volvió a abrir la app.
    IF v_ficha_id = v_uid THEN
        RETURN jsonb_build_object(
            'success', true,
            'pedidos', 0,
            'notificaciones', 0,
            'ya_era_suyo', true
        );
    END IF;

    -- 4. Mover los pedidos.
    WITH movidos AS (
        UPDATE public.pedidos
           SET session_id = v_uid
         WHERE session_id = v_ficha_id
        RETURNING 1
    )
    SELECT count(*) INTO v_pedidos FROM movidos;

    -- 5. Mover las notificaciones (la campanita).
    WITH movidas AS (
        UPDATE public.notificaciones
           SET session_id = v_uid
         WHERE session_id = v_ficha_id
        RETURNING 1
    )
    SELECT count(*) INTO v_notifs FROM movidas;

    -- 6. Mover las suscripciones push, para que las notificaciones sigan
    --    llegando a este teléfono después de registrarse.
    --
    --    `rol` no se toca: sigue siendo 'cliente'. Lo único que cambia es a
    --    quién pertenece la suscripción.
    WITH movidas AS (
        UPDATE public.push_subscriptions
           SET session_id = v_uid
         WHERE session_id = v_ficha_id
           AND rol = 'cliente'
        RETURNING 1
    )
    SELECT count(*) INTO v_push FROM movidas;

    RETURN jsonb_build_object(
        'success', true,
        'pedidos', v_pedidos,
        'notificaciones', v_notifs,
        'push', v_push,
        'desde', v_ficha_id,
        'hacia', v_uid
    );
END;
$function$;

COMMENT ON FUNCTION public.reclamar_pedidos_anonimos(TEXT) IS
    'Pasa los pedidos, notificaciones y suscripciones push de una ficha '
    'anónima válida a la cuenta con sesión activa. Se llama al registrarse o '
    'al iniciar sesión, y es idempotente: la segunda vez no encuentra nada.';

GRANT EXECUTE ON FUNCTION public.reclamar_pedidos_anonimos(TEXT) TO authenticated;

-- Un anónimo NO puede llamarla: sin sesión no hay a quién reclamar.
REVOKE EXECUTE ON FUNCTION public.reclamar_pedidos_anonimos(TEXT) FROM anon;

-- ── Verificación: la función quedó instalada como una sola versión ──
--
-- `CREATE OR REPLACE` con una firma distinta crea una sobrecarga en vez de
-- reemplazar. Ya pasó en la migración 43. Se comprueba acá.
DO $$
DECLARE
    v_n INT;
BEGIN
    SELECT count(*) INTO v_n
      FROM pg_proc
     WHERE proname = 'reclamar_pedidos_anonimos';
    IF v_n <> 1 THEN
        RAISE EXCEPTION 'Se esperaba 1 versión de reclamar_pedidos_anonimos, hay %', v_n;
    END IF;
END $$;

COMMIT;
