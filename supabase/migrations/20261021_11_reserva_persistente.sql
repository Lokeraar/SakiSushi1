-- ============================================================
-- 20261021_11_reserva_persistente.sql
--
-- Hace que la reserva se guarde de verdad.
--
-- EL DEFECTO, TAL COMO ESTABA
--
-- confirmarPedidoReserva() en cliente-delivery.js hacía esto:
--
--     validarFormularioReserva()
--     detenerTimer('reserva')
--     limpiarDatosFormulario()
--     cerrar el modal
--     mostrarToast('✅ Reserva registrada', 'success')
--
-- NUNCA llamaba a ninguna RPC. Ni un INSERT, ni un fetch. Mostraba
-- "✅ Reserva registrada" y cerraba el modal sin tocar la base.
--
-- Prueba de que nunca funcionó: `SELECT count(*) FROM pedidos WHERE
-- tipo='reserva'` devolvía 0 en toda la historia de la base.
--
-- POR QUÉ ES EL PEOR DEFECTO DEL SISTEMA
--
-- El cliente sube su comprobante de pago, ve un tilde verde que le confirma
-- la reserva, y se va tranquilo. No hay reserva. Nadie lo llama. Cuando
-- llega al local no tiene mesa. Es una mentira al cliente con su plata
-- ya transferida.
--
-- QUÉ AGREGA ESTA MIGRACIÓN
--
-- Una RPC propia para reservas, en vez de reusar crear_pedido_con_reserva().
-- El motivo: la reserva necesita campos que esa RPC no acepta
-- (fecha_reserva, referencia, comprobante_url) y además tiene una regla
-- distinta sobre el inventario.
--
-- REGLA DE INVENTARIO EN UNA RESERVA
--
-- Una reserva es para OTRO día. Reservar el inventario de hoy sería un
-- error: bloquearía mesas y platos de hoy por un pedido de la semana que
-- viene, y el barrido de vencidas lo liberaría igual a los 20 minutos,
-- dejando al cliente sin reserva otra vez.
--
-- Por eso: la reserva NO reserva ingredientes. Valida que el menú exista y
-- que el total sea coherente, y guarda el pedido. El inventario se toca
-- cuando la reserva se convierte en pedido real, que es un paso posterior.
--
-- Idempotente.
-- ============================================================

BEGIN;

CREATE OR REPLACE FUNCTION public.crear_reserva(
    p_items            JSONB,
    p_total            NUMERIC,
    p_total_usd        NUMERIC    DEFAULT 0,
    p_cliente_nombre   TEXT       DEFAULT '',
    p_fecha_reserva    TIMESTAMPTZ DEFAULT NULL,
    p_referencia       TEXT       DEFAULT '',
    p_comprobante_url  TEXT       DEFAULT '',
    p_notas            TEXT       DEFAULT ''
)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
    v_pedido_id  TEXT;
    v_session    TEXT;
    v_tasa       NUMERIC;
    v_item       JSONB;
    v_platillo   TEXT;
BEGIN
    -- ---------- 1. validaciones ----------

    IF p_items IS NULL OR jsonb_typeof(p_items) <> 'array' OR jsonb_array_length(p_items) = 0 THEN
        RETURN jsonb_build_object('success', false, 'error', 'La reserva no tiene platillos');
    END IF;

    IF p_fecha_reserva IS NULL THEN
        RETURN jsonb_build_object('success', false, 'error', 'Falta la fecha de la reserva');
    END IF;

    -- Una reserva para el pasado no tiene sentido y casi siempre es un error
    -- de tipeo en el formulario. Se permite el mismo día.
    IF p_fecha_reserva < date_trunc('day', NOW()) THEN
        RETURN jsonb_build_object('success', false, 'error', 'La fecha de la reserva ya pasó');
    END IF;

    IF COALESCE(TRIM(p_cliente_nombre), '') = '' THEN
        RETURN jsonb_build_object('success', false, 'error', 'Falta el nombre del cliente');
    END IF;

    IF p_total IS NULL OR p_total <= 0 THEN
        RETURN jsonb_build_object('success', false, 'error', 'El total de la reserva no es válido');
    END IF;

    -- El comprobante es obligatorio: sin él no hay forma de saber que pagó,
    -- y la reserva quedaría en el aire sin que nadie pueda verificarla.
    IF COALESCE(TRIM(p_comprobante_url), '') = '' THEN
        RETURN jsonb_build_object('success', false, 'error', 'Falta el comprobante de pago');
    END IF;

    -- Todos los platillos tienen que existir y estar activos
    FOR v_item IN SELECT * FROM jsonb_array_elements(p_items)
    LOOP
        v_platillo := v_item->>'platillo_id';
        IF v_platillo IS NULL OR NOT EXISTS (
            SELECT 1 FROM menu WHERE id = v_platillo AND COALESCE(disponible, true) = true
        ) THEN
            RETURN jsonb_build_object('success', false,
                'error', 'Un platillo de la reserva ya no está disponible');
        END IF;
    END LOOP;

    -- ---------- 2. armar el pedido ----------

    v_pedido_id := 'ped_' || gen_random_uuid()::text;
    v_session   := COALESCE(
        NULLIF(current_setting('request.headers', true)::jsonb ->> 'x-session-id', ''),
        'sess_' || gen_random_uuid()::text
    );

    SELECT COALESCE(tasa_efectiva, tasa_cambio, 1) INTO v_tasa FROM config WHERE id = 1;
    IF v_tasa IS NULL OR v_tasa <= 0 THEN v_tasa := 1; END IF;

    INSERT INTO pedidos (
        id, fecha, estado, tipo, total, session_id,
        mesa, cliente_nombre, items, tasa_aplicada,
        fecha_reserva, referencia, comprobante_url,
        pago_expira_en
    ) VALUES (
        v_pedido_id,
        NOW(),
        -- 'pendiente': la reserva espera que un cajero verifique el
        -- comprobante. No se aprueba sola.
        'pendiente',
        'reserva',
        p_total,
        v_session,
        NULL,
        TRIM(p_cliente_nombre),
        p_items,
        CASE WHEN p_total_usd > 0 THEN ROUND(p_total / p_total_usd, 4) ELSE v_tasa END,
        p_fecha_reserva,
        NULLIF(TRIM(p_referencia), ''),
        TRIM(p_comprobante_url),
        -- Sin plazo de pago: el pago YA está hecho y el comprobante subido.
        -- El barrido de reservas vencidas libera pedidos sin pagar; este no
        -- debe tocarse hasta que un cajero lo apruebe o lo rechace.
        NULL
    );

    -- ---------- 3. avisar al cajero ----------

    INSERT INTO notificaciones (pedido_id, tipo, titulo, mensaje, session_id, leida)
    VALUES (
        v_pedido_id,
        'reserva',
        'Nueva reserva',
        'Reserva para el ' || TO_CHAR(p_fecha_reserva, 'DD/MM/YYYY HH24:MI') ||
        ' a nombre de ' || TRIM(p_cliente_nombre) ||
        COALESCE(' · Ref: ' || NULLIF(TRIM(p_referencia), ''), ''),
        v_session,
        false
    );

    RETURN jsonb_build_object(
        'success',       true,
        'pedido_id',     v_pedido_id,
        'tipo',          'reserva',
        'fecha_reserva', p_fecha_reserva,
        'total',         p_total
    );
END;
$$;

-- La reserva la crea el cliente, que es anónimo: es el mismo criterio que
-- crear_pedido_con_reserva. Las validaciones de arriba son la defensa, y
-- esta función NO descuenta inventario ni mueve plata.
GRANT EXECUTE ON FUNCTION public.crear_reserva(JSONB, NUMERIC, NUMERIC, TEXT, TIMESTAMPTZ, TEXT, TEXT, TEXT)
    TO anon, authenticated;

COMMENT ON FUNCTION public.crear_reserva IS
    'Guarda una reserva como pedido tipo reserva. No reserva inventario: la reserva es para otro día.';


-- ---------- recargar el cache de PostgREST ----------
NOTIFY pgrst, 'reload schema';

COMMIT;
