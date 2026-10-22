-- ============================================================
-- crear_pedido_con_reserva  (v2 — contrato real del Cliente)
--
-- Reemplaza la versión de 2 parámetros. Esta acepta el pedido completo
-- tal como lo arma Cliente/js/cliente-pedidos.js y cliente-delivery.js:
--
--   p_items           JSONB  [{platillo_id, nombre, cantidad, precio,
--                              personalizacion, ingredientes_quitados}]
--   p_tipo            TEXT   'mesa' | 'delivery' | 'reserva'
--   p_total           NUMERIC total en Bs
--   p_total_usd       NUMERIC total en USD
--   p_mesa_id         TEXT    mesa del QR (NULL en delivery/reserva) -> pedidos.mesa es TEXT
--   p_cliente_nombre  TEXT
--   p_notas           TEXT
--
-- Hace tres cosas en UNA transacción:
--   1. crea el pedido
--   2. reserva ingredientes (inventario.reservado += consumo)
--   3. notifica al cajero
--
-- Si algo falla, no queda nada a medias. Esa es la diferencia con la
-- versión anterior, que insertaba y devolvía éxito sin tocar el stock.
--
-- Sobre el consumo de ingredientes (decisión del 21-oct-2026):
-- el stock de un platillo se DERIVA de sus ingredientes. menu.ingredientes
-- es un objeto JSONB {idIngrediente: {nombre, cantidad, principal}}.
-- Se descuentan los ingredientes que el cliente NO quitó.
-- ============================================================

BEGIN;

CREATE OR REPLACE FUNCTION public.crear_pedido_con_reserva(
    p_items          JSONB,
    p_tipo           TEXT    DEFAULT 'mesa',
    p_total          NUMERIC DEFAULT 0,
    p_total_usd      NUMERIC DEFAULT 0,
    p_mesa_id        TEXT    DEFAULT NULL,
    p_cliente_nombre TEXT    DEFAULT '',
    p_notas          TEXT    DEFAULT ''
) RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER          -- corre con permisos del dueño para poder
                          -- reservar inventario aunque el cliente sea anónimo
SET search_path = public
AS $$
DECLARE
    v_pedido_id  TEXT;
    v_item       JSONB;
    v_platillo   RECORD;
    v_ing_id     TEXT;
    v_ing_info   JSONB;
    v_cant_ing   NUMERIC;
    v_quitados   TEXT[];
    v_consumo    JSONB := '{}'::JSONB;
    v_stock_libre NUMERIC;
    v_faltantes  TEXT[] := ARRAY[]::TEXT[];
    v_session    TEXT;
BEGIN
    -- ---------- validaciones ----------
    IF p_items IS NULL OR jsonb_typeof(p_items) <> 'array' OR jsonb_array_length(p_items) = 0 THEN
        RAISE EXCEPTION 'El pedido no tiene items' USING ERRCODE = '22023';
    END IF;

    IF p_tipo NOT IN ('mesa','delivery','reserva') THEN
        RAISE EXCEPTION 'Tipo de pedido inválido: %', p_tipo USING ERRCODE = '22023';
    END IF;

    IF p_tipo IN ('delivery','reserva') THEN
        p_mesa_id := NULL;
    ELSIF p_mesa_id IS NULL THEN
        RAISE EXCEPTION 'Un pedido de mesa requiere p_mesa_id' USING ERRCODE = '22023';
    END IF;

    v_pedido_id := 'ped_' || replace(gen_random_uuid()::TEXT, '-', '');
    v_session   := COALESCE(auth.uid()::TEXT, 'anon');

    -- ---------- 1. acumular consumo de ingredientes ----------
    FOR v_item IN SELECT * FROM jsonb_array_elements(p_items)
    LOOP
        SELECT id, nombre, ingredientes
          INTO v_platillo
          FROM menu
         WHERE id = (v_item->>'platillo_id')::TEXT
            OR id = 'plat_' || (v_item->>'platillo_id');

        IF NOT FOUND THEN
            RAISE EXCEPTION 'Platillo inexistente: %', v_item->>'platillo_id'
                USING ERRCODE = '22023';
        END IF;

        IF v_platillo.ingredientes IS NULL OR jsonb_typeof(v_platillo.ingredientes) <> 'object' THEN
            CONTINUE;
        END IF;

        v_quitados := COALESCE(
            ARRAY(SELECT jsonb_array_elements_text(v_item->'ingredientes_quitados')),
            ARRAY[]::TEXT[]
        );

        FOR v_ing_id, v_ing_info IN SELECT key, value FROM jsonb_each(v_platillo.ingredientes)
        LOOP
            -- si el cliente lo quitó, no consume
            IF v_ing_id = ANY(v_quitados) THEN
                CONTINUE;
            END IF;

            v_cant_ing := COALESCE((v_ing_info->>'cantidad')::NUMERIC, 0)
                        * COALESCE((v_item->>'cantidad')::NUMERIC, 1);

            IF v_cant_ing <= 0 THEN
                CONTINUE;
            END IF;

            v_consumo := jsonb_set(
                v_consumo,
                ARRAY[v_ing_id],
                to_jsonb(COALESCE((v_consumo->>v_ing_id)::NUMERIC, 0) + v_cant_ing),
                true
            );
        END LOOP;
    END LOOP;

    -- ---------- 2. verificar disponibilidad ANTES de escribir ----------
    FOR v_ing_id IN SELECT jsonb_object_keys(v_consumo)
    LOOP
        SELECT (stock - reservado)
          INTO v_stock_libre
          FROM inventario
         WHERE id = v_ing_id;

        IF NOT FOUND THEN
            CONTINUE;  -- ingrediente huérfano: no bloquea el pedido
        END IF;

        IF v_stock_libre < (v_consumo->>v_ing_id)::NUMERIC THEN
            v_faltantes := array_append(
                v_faltantes,
                format('%s (libre %s, necesita %s)',
                       v_ing_id, v_stock_libre, v_consumo->>v_ing_id)
            );
        END IF;
    END LOOP;

    IF array_length(v_faltantes, 1) > 0 THEN
        RAISE EXCEPTION 'Stock insuficiente: %', array_to_string(v_faltantes, ', ')
            USING ERRCODE = 'P0001';
    END IF;

    -- ---------- 3. crear el pedido ----------
    INSERT INTO pedidos (
        id, fecha, estado, tipo, total, session_id,
        mesa, cliente_nombre, items, tasa_aplicada
    ) VALUES (
        v_pedido_id,
        NOW(),
        'pendiente',
        p_tipo,
        p_total,
        v_session,
        p_mesa_id,
        NULLIF(p_cliente_nombre, ''),
        p_items,
        CASE WHEN p_total_usd > 0 THEN ROUND(p_total / p_total_usd, 4)
             ELSE (SELECT tasa_efectiva FROM config WHERE id = 1) END
    );

    -- ---------- 4. reservar ingredientes ----------
    FOR v_ing_id IN SELECT jsonb_object_keys(v_consumo)
    LOOP
        UPDATE inventario
           SET reservado = reservado + (v_consumo->>v_ing_id)::NUMERIC
         WHERE id = v_ing_id;
    END LOOP;

    -- ---------- 5. notificar al cajero ----------
    INSERT INTO notificaciones (pedido_id, tipo, titulo, mensaje, session_id, leida)
    VALUES (
        v_pedido_id,
        'pending',
        CASE p_tipo
             WHEN 'mesa'     THEN '🍽️ Nuevo pedido en mesa ' || COALESCE(p_mesa_id, '?')
             WHEN 'delivery' THEN '🛵 Nuevo pedido para delivery'
             ELSE                 '📅 Nueva reserva'
        END,
        CASE p_tipo
             WHEN 'mesa'     THEN 'Pendiente de cobro en caja'
             WHEN 'delivery' THEN 'Pendiente de cobro y asignación de motorizado'
             ELSE                 'Pendiente de confirmación de pago'
        END,
        v_session,
        false
    );

    RETURN jsonb_build_object(
        'success',     true,
        'pedido_id',   v_pedido_id,
        'tipo',        p_tipo,
        'total',       p_total,
        'total_usd',   p_total_usd,
        'ingredientes_reservados', v_consumo,
        'mensaje',     'Pedido creado y pendiente de cobro en caja'
    );

EXCEPTION
    WHEN OTHERS THEN
        RAISE;  -- cualquier fallo revierte todo: pedido, reserva y notificación
END;
$$;

-- El cliente anónimo y el mesonero necesitan poder llamarla.
GRANT EXECUTE ON FUNCTION public.crear_pedido_con_reserva(
    JSONB, TEXT, NUMERIC, NUMERIC, TEXT, TEXT, TEXT
) TO anon, authenticated;

COMMIT;
