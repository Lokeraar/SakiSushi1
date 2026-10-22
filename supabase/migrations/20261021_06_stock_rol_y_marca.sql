-- ============================================================
-- 20261021_06_stock_rol_y_marca.sql
--
-- Atiende dos advertencias del review de RDD sobre la migración 04
-- (lineage review-f957285094c5e05d, hallazgos R1-001 y R1-002).
--
-- R1-001 — LAS RPC DE STOCK NO VALIDAN QUIÉN LAS LLAMA
--
-- `descontar_ingredientes_pedido` y `liberar_ingredientes` son
-- SECURITY DEFINER y estaban otorgadas a `authenticated` a secas. Cualquier
-- usuario con sesión — incluido un mesonero — podía invocarlas por PostgREST
-- y mover inventario, o marcar un pedido como consumido, sin pasar por el
-- cobro. Cobrar es facultad del cajero y del admin; el mesonero nunca cobra.
--
-- Ahora ambas exigen `es_cajero_o_admin()`. El grant se limita a
-- `authenticated` igual que antes, pero además hay un guardián explícito:
-- si el rol no alcanza, la función falla con 42501 en vez de moverse en
-- silencio.
--
-- R1-002 — LA MARCA DE IDEMPOTENCIA SE GASTABA SIN CONSUMIR
--
-- La versión anterior reclamaba `stock_movido_at` ANTES de saber si había
-- algo que consumir. Si el pedido no tenía ingredientes resolubles, la
-- función devolvía `omitido` pero la marca quedaba puesta: un cobro
-- posterior tampoco podía consumir nada. La marca se gastaba en un intento
-- que no movió un gramo.
--
-- Ahora el orden es el correcto:
--   1. calcular el consumo
--   2. si no hay nada que consumir, salir SIN reclamar
--   3. reclamar con el UPDATE condicional
--   4. verificar la reserva y consumir
--
-- Se conserva la garantía de R1: el UPDATE condicional sigue siendo el
-- único punto donde se gana o se pierde la reclamación, así que dos cobros
-- concurrentes no pueden descontar dos veces.
--
-- Idempotente: se puede aplicar más de una vez.
-- ============================================================

BEGIN;


-- ============================================================
-- 1. Guardián de rol reutilizable
--    Deja el mensaje en un solo lugar y con un ERRCODE identificable
--    (42501 = insufficient_privilege).
-- ============================================================

CREATE OR REPLACE FUNCTION public.exigir_cajero_o_admin()
RETURNS VOID
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
    -- Ojo con la lógica de tres valores: si no hay sesión, `es_cajero_o_admin()`
    -- devuelve NULL, y `IF NOT NULL` es NULL, que NO ejecuta la rama. Escribirlo
    -- como `IF NOT x` dejaba pasar justo el caso que hay que bloquear.
    IF COALESCE(public.es_cajero_o_admin(), false) IS NOT TRUE THEN
        RAISE EXCEPTION
            'Solo cajero o admin pueden mover el inventario de un pedido (rol actual: %)',
            COALESCE(public.rol_actual(), 'ninguno')
            USING ERRCODE = '42501';
    END IF;
END;
$$;

GRANT EXECUTE ON FUNCTION public.exigir_cajero_o_admin() TO authenticated;


-- ============================================================
-- 2. COBRO — validación de rol + orden correcto de la reclamación
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
    v_stock      NUMERIC;
    v_cantidad   NUMERIC;
    v_faltantes  TEXT[] := ARRAY[]::TEXT[];
    v_descuadres TEXT[] := ARRAY[]::TEXT[];
BEGIN
    PERFORM public.exigir_cajero_o_admin();

    -- ---------- 1. leer el pedido sin reclamar nada todavía ----------
    SELECT items, stock_movido_at
      INTO v_pedido
      FROM pedidos
     WHERE id = p_pedido_id;

    IF NOT FOUND THEN
        RAISE EXCEPTION 'Pedido inexistente: %', p_pedido_id
            USING ERRCODE = '22023';
    END IF;

    IF v_pedido.stock_movido_at IS NOT NULL THEN
        RETURN jsonb_build_object(
            'success', true,
            'omitido', true,
            'motivo',  'el inventario de este pedido ya se movió antes'
        );
    END IF;

    -- ---------- 2. calcular antes de comprometerse ----------
    -- Si no hay nada que consumir, se sale SIN gastar la marca.
    -- Este es el arreglo de R1-002.
    v_consumo := public.consumo_pedido(v_pedido.items);

    IF v_consumo = '{}'::JSONB THEN
        RETURN jsonb_build_object(
            'success', true,
            'omitido', true,
            'motivo',  'el pedido no tiene ingredientes que consumir'
        );
    END IF;

    -- ---------- 3. reclamación atómica ----------
    -- Solo acá se gana o se pierde: el WHERE sobre stock_movido_at IS NULL
    -- serializa los intentos concurrentes.
    UPDATE pedidos
       SET stock_movido_at  = NOW(),
           stock_movimiento = 'consumido'
     WHERE id = p_pedido_id
       AND stock_movido_at IS NULL;

    IF NOT FOUND THEN
        RETURN jsonb_build_object(
            'success', true,
            'omitido', true,
            'motivo',  'otro intento tomó la marca primero'
        );
    END IF;

    -- ---------- 4. verificar la reserva ----------
    -- Si no alcanza, algo tocó `reservado` por fuera. Se avisa con el
    -- detalle en vez de dejar el inventario en negativo.
    FOR v_ing_id IN SELECT jsonb_object_keys(v_consumo)
    LOOP
        v_cantidad := (v_consumo->>v_ing_id)::NUMERIC;

        SELECT reservado, stock INTO v_reservado, v_stock
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

        -- R3-001: se reporta el descuadre entre stock y reserva en vez de
        -- que GREATEST lo esconda. No bloquea: el cobro ya ocurrió en caja.
        IF v_stock < v_cantidad THEN
            v_descuadres := array_append(
                v_descuadres,
                format('%s (stock %s, consumo %s)', v_ing_id, v_stock, v_cantidad)
            );
        END IF;
    END LOOP;

    IF array_length(v_faltantes, 1) > 0 THEN
        RAISE EXCEPTION 'Reserva insuficiente al cobrar: %', array_to_string(v_faltantes, ', ')
            USING ERRCODE = 'P0001';
    END IF;

    -- ---------- 5. consumir ----------
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
        'success',    true,
        'pedido_id',  p_pedido_id,
        'consumido',  v_consumo,
        'descuadres', to_jsonb(v_descuadres)
    );
END;
$$;

GRANT EXECUTE ON FUNCTION public.descontar_ingredientes_pedido(TEXT) TO authenticated;


-- ============================================================
-- 3. CANCELACIÓN — validación de rol + mismo orden
--    Y sin tragarse el error: R3-002 pedía que un fallo de liberación
--    no quedara invisible. Se relanza para que el Cajero lo vea.
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
    PERFORM public.exigir_cajero_o_admin();

    SELECT items, stock_movido_at
      INTO v_pedido
      FROM pedidos
     WHERE id = p_pedido_id;

    IF NOT FOUND THEN
        RETURN jsonb_build_object('success', false, 'error', 'Pedido inexistente');
    END IF;

    IF v_pedido.stock_movido_at IS NOT NULL THEN
        RETURN jsonb_build_object(
            'success', true,
            'omitido', true,
            'motivo',  'el inventario de este pedido ya se movió antes'
        );
    END IF;

    v_consumo := public.consumo_pedido(v_pedido.items);

    -- Sin ingredientes no hay nada que liberar y la marca no se gasta.
    IF v_consumo = '{}'::JSONB THEN
        RETURN jsonb_build_object('success', true, 'liberado', '{}'::JSONB);
    END IF;

    UPDATE pedidos
       SET stock_movido_at  = NOW(),
           stock_movimiento = 'liberado'
     WHERE id = p_pedido_id
       AND stock_movido_at IS NULL;

    IF NOT FOUND THEN
        RETURN jsonb_build_object(
            'success', true,
            'omitido', true,
            'motivo',  'otro intento tomó la marca primero'
        );
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
    -- Sin EXCEPTION WHEN OTHERS: si algo falla, el error sube y el Cajero
    -- lo ve, en vez de recibir un success:false que nadie mira.
END;
$$;

GRANT EXECUTE ON FUNCTION public.liberar_ingredientes(TEXT) TO authenticated;


NOTIFY pgrst, 'reload schema';

COMMIT;
