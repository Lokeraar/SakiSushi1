-- 20261021_31_tasa_sin_firma_marca_pedido.sql
--
-- POR QUÉ EXISTE
--
-- El dueño pidió que sin tasa del día no se pueda operar. Hoy eso se cumple
-- SOLO en la pantalla: el admin y el cajero tienen el modal bloqueante, pero
-- `crear_pedido_con_reserva()` no mira si alguien firmó. Un cliente que ya
-- tenía el carrito armado, o cualquier llamada directa a la API, crea el
-- pedido igual.
--
-- DECISIÓN DEL DUEÑO (textual): "El pedido entra igual."
--
-- No se rechaza. Se acepta y se MARCA, para que el cajero lo vea al cobrar.
-- El motivo es de sentido común: rechazar dejaría al comensal sin poder pedir
-- por un trámite interno del local, y el que está sentado en la mesa no tiene
-- culpa de que nadie haya firmado la tasa. Pero cobrar sin que nadie lo haya
-- confirmado es exactamente lo que hay que evitar, así que tiene que quedar
-- rastro visible.
--
-- Cómo se marca: dos columnas nuevas en `pedidos`.
--   tasa_sin_firma   boolean  — se creó con el día sin firmar
--   tasa_sin_firma_detalle text — qué tasa se aplicó y qué faltaba
--
-- Se elige columna y no `notas` porque las notas son del cliente ("sin
-- cebolla") y mezclarlas haría imposible consultar después.

-- ============================================================
-- Columnas de marca
-- ============================================================
ALTER TABLE public.pedidos
    ADD COLUMN IF NOT EXISTS tasa_sin_firma boolean NOT NULL DEFAULT false;

ALTER TABLE public.pedidos
    ADD COLUMN IF NOT EXISTS tasa_sin_firma_detalle text;

COMMENT ON COLUMN public.pedidos.tasa_sin_firma IS
    'El pedido se creó cuando nadie había firmado la tasa del día. '
    'El cajero tiene que confirmarla antes de cobrar.';

-- Para que el cajero pueda listar los pendientes de revisar sin escanear
-- toda la tabla. Índice parcial: solo las filas marcadas.
CREATE INDEX IF NOT EXISTS idx_pedidos_tasa_sin_firma
    ON public.pedidos (fecha DESC)
    WHERE tasa_sin_firma;

-- ============================================================
-- crear_pedido_con_reserva(): marcar en vez de rechazar
-- ============================================================
CREATE OR REPLACE FUNCTION public.crear_pedido_con_reserva(
    p_items jsonb,
    p_tipo text DEFAULT 'mesa',
    p_total numeric DEFAULT 0,
    p_total_usd numeric DEFAULT 0,
    p_mesa_id text DEFAULT NULL,
    p_cliente_nombre text DEFAULT '',
    p_notas text DEFAULT ''
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $function$
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
    -- NUEVO: estado de la firma del día
    v_firmado    BOOLEAN;
    v_tasa       NUMERIC;
    v_detalle    TEXT;
BEGIN
    -- ---------- candado del local ----------
    IF NOT public.local_esta_abierto() THEN
        RAISE EXCEPTION 'El local está cerrado en este momento'
            USING ERRCODE = 'P0001';
    END IF;

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

    -- ---------- estado de la firma del día ----------
    --
    -- Se lee de `tasa_revision_diaria`, que es donde firma la ventana. No se
    -- bloquea nada: solo se anota. La decisión de cobrar o no es del cajero,
    -- que ve la marca en pantalla.
    SELECT EXISTS (
        SELECT 1 FROM public.tasa_revision_diaria WHERE dia = CURRENT_DATE
    ) INTO v_firmado;

    SELECT tasa_efectiva INTO v_tasa FROM public.config WHERE id = 1;

    IF NOT v_firmado THEN
        v_detalle := 'Creado el ' || to_char(CURRENT_DATE, 'DD/MM/YYYY') ||
                     ' sin firma de la tasa del día. Tasa aplicada al pedido: ' ||
                     COALESCE(ROUND(v_tasa, 2)::TEXT, 'sin configurar') || '.';
    END IF;

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
            CONTINUE;
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
        mesa, cliente_nombre, items, tasa_aplicada,
        tasa_sin_firma, tasa_sin_firma_detalle
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
             ELSE (SELECT tasa_efectiva FROM config WHERE id = 1) END,
        NOT v_firmado,
        v_detalle
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
        END
        -- El aviso de tasa sin firmar se agrega al mismo mensaje, no como
        -- notificación aparte: dos avisos del mismo pedido se pisan.
        || CASE WHEN v_firmado THEN ''
                ELSE ' — ⚠ TASA SIN CONFIRMAR HOY: revisar antes de cobrar.'
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
        'tasa_sin_firma', NOT v_firmado,
        'mensaje',     CASE WHEN v_firmado
                            THEN 'Pedido creado y pendiente de cobro en caja'
                            ELSE 'Pedido creado SIN tasa confirmada: el cajero tiene que revisarlo'
                       END
    );
END;
$function$;

COMMENT ON FUNCTION public.crear_pedido_con_reserva(jsonb, text, numeric, numeric, text, text, text) IS
    'Crea el pedido y reserva stock. Si nadie firmó la tasa del día, el pedido '
    'entra igual pero queda marcado (tasa_sin_firma) para que el cajero lo revise.';
