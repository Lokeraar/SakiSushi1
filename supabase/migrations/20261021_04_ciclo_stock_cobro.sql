-- ============================================================
-- 20261021_04_ciclo_stock_cobro.sql
--
-- Cierra el ciclo de vida del inventario. Hasta hoy el sistema
-- reservaba ingredientes al crear el pedido y nunca los consumía:
-- `reservado` crecía para siempre y el stock real nunca bajaba.
--
-- CICLO COMPLETO
--
--   crear_pedido_con_reserva       (01)  reservado += consumo
--   descontar_ingredientes_pedido  (04)  stock -= consumo, reservado -= consumo
--   liberar_ingredientes           (04)  reservado -= consumo
--
-- El Cajero ya llamaba a `descontar_ingredientes_pedido` al cobrar, pero esa
-- función NO existía: PostgREST devolvía PGRST202 y el error se tragaba en
-- un console.error. El inventario nunca bajaba.
--
-- DEFECTOS DE RAÍZ ENCONTRADOS
--
-- 1. `liberar_ingredientes` buscaba el platillo con `v_item->>'platilloId'`,
--    pero el JSON que escribe la (01) usa `platillo_id`. El LEFT JOIN nunca
--    encontraba nada: devolvía success sin liberar un solo gramo.
--
-- 2. `liberar_ingredientes` ignoraba `ingredientes_quitados`. Aunque hubiera
--    encontrado el platillo, habría liberado ingredientes que el cliente
--    quitó y que por lo tanto nunca se reservaron.
--
-- IDEMPOTENCIA — por qué una reclamación y no un `estado`
--
-- La primera versión de este archivo miraba `pedidos.estado <> 'pendiente'`
-- para no descontar dos veces. No sirve: el Cajero inserta la venta y llama
-- esta función SIN cambiar el estado del pedido, así que en un reintento el
-- estado sigue siendo 'pendiente' y la función volvía a descontar.
--
-- Ahora el movimiento se reclama con un UPDATE condicional atómico sobre
-- `pedidos.stock_movido_at`. Solo la primera llamada gana la reclamación; el
-- resto devuelve `omitido` sin tocar el inventario. Si la transacción falla,
-- la reclamación se revierte junto con todo lo demás.
--
-- REGLA DE NEGOCIO RESPETADA
--
-- El stock se deriva de los ingredientes: solo se consumen los que la receta
-- declara y el cliente no quitó. Que falte un principal o un secundario se
-- decide en `disponibilidad_platillo` (02), no acá — para cuando el cajero
-- cobra, el pedido ya existe.
--
-- Idempotente: se puede aplicar más de una vez sin efecto acumulado.
-- ============================================================

BEGIN;


-- ============================================================
-- 0. Marca del movimiento de stock
--    Una sola columna dice quién movió el inventario de este pedido y
--    cuándo. NULL = nadie todavía.
-- ============================================================

ALTER TABLE pedidos ADD COLUMN IF NOT EXISTS stock_movido_at TIMESTAMP WITH TIME ZONE;
ALTER TABLE pedidos ADD COLUMN IF NOT EXISTS stock_movimiento TEXT;

COMMENT ON COLUMN pedidos.stock_movido_at IS
  'Cuándo se movió el inventario de este pedido. NULL = reserva viva, sin consumir ni liberar.';
COMMENT ON COLUMN pedidos.stock_movimiento IS
  'consumido (cobrado) o liberado (rechazado/cancelado). NULL mientras la reserva siga viva.';


-- ============================================================
-- 1. Helper: consumo real de un pedido
--
--    Una sola definición de la verdad para las dos funciones que
--    necesitan saber qué ingredientes consume un pedido. Sin esto,
--    cobrar y rechazar podrían descontar cantidades distintas.
-- ============================================================

CREATE OR REPLACE FUNCTION public.consumo_pedido(p_items JSONB)
RETURNS JSONB
LANGUAGE plpgsql
STABLE
SET search_path = public
AS $$
DECLARE
    v_item       JSONB;
    v_platillo   RECORD;
    v_ing_id     TEXT;
    v_ing_info   JSONB;
    v_quitados   TEXT[];
    v_cant_ing   NUMERIC;
    v_consumo    JSONB := '{}'::JSONB;
BEGIN
    IF p_items IS NULL OR jsonb_typeof(p_items) <> 'array' THEN
        RETURN v_consumo;
    END IF;

    FOR v_item IN SELECT * FROM jsonb_array_elements(p_items)
    LOOP
        -- El id real en `menu` es TEXT con forma `plat_<uuid>_<n>`.
        -- Se aceptan las tres formas que aparecen en el código:
        -- el id completo, el id sin prefijo y el número interno.
        SELECT id, ingredientes
          INTO v_platillo
          FROM menu
         WHERE id = (v_item->>'platillo_id')::TEXT
            OR id = 'plat_' || (v_item->>'platillo_id')
            OR id LIKE 'plat\_%\_' || (v_item->>'platillo_id')
         LIMIT 1;

        IF NOT FOUND THEN
            CONTINUE;
        END IF;

        IF v_platillo.ingredientes IS NULL
           OR jsonb_typeof(v_platillo.ingredientes) <> 'object' THEN
            CONTINUE;
        END IF;

        v_quitados := COALESCE(
            ARRAY(SELECT jsonb_array_elements_text(v_item->'ingredientes_quitados')),
            ARRAY[]::TEXT[]
        );

        FOR v_ing_id, v_ing_info IN SELECT key, value FROM jsonb_each(v_platillo.ingredientes)
        LOOP
            IF v_ing_id = ANY(v_quitados) THEN
                CONTINUE;   -- el cliente lo quitó: nunca se reservó
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

    RETURN v_consumo;
END;
$$;

GRANT EXECUTE ON FUNCTION public.consumo_pedido(JSONB) TO anon, authenticated;


-- ============================================================
-- 2. COBRO: reservado -> consumido
--
--    El Cajero llama esto al confirmar el cobro, justo después de
--    insertar la venta.
-- ============================================================

CREATE OR REPLACE FUNCTION public.descontar_ingredientes_pedido(p_pedido_id TEXT)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
    v_pedido     RECORD;
    v_consumo    JSONB;
    v_ing_id     TEXT;
    v_reservado  NUMERIC;
    v_cantidad   NUMERIC;
    v_faltantes  TEXT[] := ARRAY[]::TEXT[];
BEGIN
    -- ---------- reclamación atómica ----------
    -- El WHERE es la garantía: si otro intento ya tomó la marca, esta
    -- fila no vuelve y nos vamos sin tocar nada.
    UPDATE pedidos
       SET stock_movido_at  = NOW(),
           stock_movimiento = 'consumido'
     WHERE id = p_pedido_id
       AND stock_movido_at IS NULL
    RETURNING estado, items INTO v_pedido;

    IF NOT FOUND THEN
        -- O no existe, o ya se movió antes.
        IF EXISTS (SELECT 1 FROM pedidos WHERE id = p_pedido_id) THEN
            RETURN jsonb_build_object(
                'success', true,
                'omitido', true,
                'motivo',  'el inventario de este pedido ya se movió antes'
            );
        END IF;
        RAISE EXCEPTION 'Pedido inexistente: %', p_pedido_id
            USING ERRCODE = '22023';
    END IF;

    v_consumo := public.consumo_pedido(v_pedido.items);

    IF v_consumo = '{}'::JSONB THEN
        RETURN jsonb_build_object(
            'success', true,
            'omitido', true,
            'motivo',  'el pedido no tiene ingredientes que consumir'
        );
    END IF;

    -- ---------- verificar que la reserva alcanza ----------
    -- Si no alcanza, algo tocó `reservado` por fuera. Se avisa con el
    -- detalle en vez de dejar el inventario en negativo.
    FOR v_ing_id IN SELECT jsonb_object_keys(v_consumo)
    LOOP
        v_cantidad := (v_consumo->>v_ing_id)::NUMERIC;

        SELECT reservado INTO v_reservado
          FROM inventario WHERE id = v_ing_id;

        IF NOT FOUND THEN
            CONTINUE;   -- ingrediente huérfano: no bloquea el cobro
        END IF;

        IF v_reservado < v_cantidad THEN
            v_faltantes := array_append(
                v_faltantes,
                format('%s (reservado %s, necesita %s)', v_ing_id, v_reservado, v_cantidad)
            );
        END IF;
    END LOOP;

    IF array_length(v_faltantes, 1) > 0 THEN
        RAISE EXCEPTION 'Reserva insuficiente al cobrar: %', array_to_string(v_faltantes, ', ')
            USING ERRCODE = 'P0001';
    END IF;

    -- ---------- consumir ----------
    -- El stock baja y la reserva se libera en el mismo movimiento.
    FOR v_ing_id IN SELECT jsonb_object_keys(v_consumo)
    LOOP
        v_cantidad := (v_consumo->>v_ing_id)::NUMERIC;

        UPDATE inventario
           SET stock      = GREATEST(0, stock - v_cantidad),
               reservado  = GREATEST(0, reservado - v_cantidad),
               updated_at = NOW()
         WHERE id = v_ing_id;
    END LOOP;

    RETURN jsonb_build_object(
        'success',   true,
        'pedido_id', p_pedido_id,
        'consumido', v_consumo
    );
END;
$$;

GRANT EXECUTE ON FUNCTION public.descontar_ingredientes_pedido(TEXT) TO authenticated;


-- ============================================================
-- 3. CANCELACIÓN: liberar la reserva
--
--    Reescrita. La versión original no liberaba nada por los dos
--    defectos explicados en la cabecera.
--
--    Misma reclamación atómica: si el pedido ya se cobró, no hay
--    reserva que devolver y el stock no se toca.
-- ============================================================

CREATE OR REPLACE FUNCTION public.liberar_ingredientes(p_pedido_id TEXT)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
    v_pedido    RECORD;
    v_consumo   JSONB;
    v_ing_id    TEXT;
    v_cantidad  NUMERIC;
BEGIN
    UPDATE pedidos
       SET stock_movido_at  = NOW(),
           stock_movimiento = 'liberado'
     WHERE id = p_pedido_id
       AND stock_movido_at IS NULL
    RETURNING items INTO v_pedido;

    IF NOT FOUND THEN
        IF EXISTS (SELECT 1 FROM pedidos WHERE id = p_pedido_id) THEN
            RETURN jsonb_build_object(
                'success', true,
                'omitido', true,
                'motivo',  'el inventario de este pedido ya se movió antes'
            );
        END IF;
        RETURN jsonb_build_object('success', false, 'error', 'Pedido inexistente');
    END IF;

    v_consumo := public.consumo_pedido(v_pedido.items);

    IF v_consumo = '{}'::JSONB THEN
        RETURN jsonb_build_object('success', true, 'liberado', '{}'::JSONB);
    END IF;

    FOR v_ing_id IN SELECT jsonb_object_keys(v_consumo)
    LOOP
        v_cantidad := (v_consumo->>v_ing_id)::NUMERIC;

        UPDATE inventario
           SET reservado  = GREATEST(0, reservado - v_cantidad),
               updated_at = NOW()
         WHERE id = v_ing_id;
    END LOOP;

    RETURN jsonb_build_object(
        'success',   true,
        'pedido_id', p_pedido_id,
        'liberado',  v_consumo
    );

EXCEPTION
    WHEN OTHERS THEN
        RETURN jsonb_build_object('success', false, 'error', SQLERRM);
END;
$$;

GRANT EXECUTE ON FUNCTION public.liberar_ingredientes(TEXT) TO authenticated;


-- ---------- recargar el cache de PostgREST ----------
-- Sin esto, el Cajero sigue viendo PGRST202 hasta que Supabase
-- refresque el esquema por su cuenta.
NOTIFY pgrst, 'reload schema';

COMMIT;
