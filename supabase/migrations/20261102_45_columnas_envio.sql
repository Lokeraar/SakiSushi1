-- ============================================================================
-- 45 — Aclarar las tres columnas del costo de envío
-- ============================================================================
--
-- Christian señaló que `costo_delivery_bs` y `costo_delivery` "no vienen siendo
-- lo mismo en la práctica". Tenía razón: en la migración anterior escribí el
-- MISMO valor en bolívares en las dos columnas.
--
-- LO QUE DICEN LOS DATOS
--
-- El pedido TEST-MIX-2, que se cargó a mano cuando el mecanismo funcionaba,
-- tiene:
--
--   costo_delivery      = 1.50      <- dólares
--   costo_delivery_usd  = 1.50      <- dólares
--   costo_delivery_bs   = 1334.37   <- bolívares (1.50 x 889.58)
--
-- Es decir: las dos primeras guardan el pacto en divisa, y la tercera su
-- conversión. No son lo mismo.
--
-- QUIÉN LEE CADA UNA
--
--   costo_delivery_bs   <- el Cajero, en 10 lugares, y admin-reportes.
--                          Es la que importa para caja y reportes.
--   costo_delivery_usd  <- nadie todavía, pero es la que conserva el pacto
--                          en dólares para auditar el envío.
--   costo_delivery      <- nadie. Queda como la columna original.
--
-- Si `costo_delivery` se llenara con bolívares, un día que se audite el envío
-- en divisa no habría de dónde leerlo: los dos valores serían el mismo número
-- y la distinción se habría perdido.
--
-- QUÉ HACE ESTA MIGRACIÓN
--
-- Recrea `crear_pedido_con_reserva` para que escriba:
--
--   costo_delivery      = dólares pactados
--   costo_delivery_usd  = dólares pactados
--   costo_delivery_bs   = conversión congelada a la tasa BASE del día
--
-- La conversión se congela al crear el pedido: si la tasa sube mañana, el
-- envío de ayer no se revaloriza. Y se usa la tasa base (`config.tasa_cambio`)
-- y no la efectiva, porque el envío no lleva el aumento del menú.
--
-- Nota sobre las migraciones anteriores: 43 y 44 dejaron versiones de esta
-- función con firmas distintas. PostgreSQL no reemplaza una función cuando
-- cambia un parámetro, crea una sobrecarga. Acá se borra explícitamente la
-- firma anterior antes de crear la nueva, para no dejar ninguna huérfana.
-- ============================================================================

BEGIN;

-- Se borra la firma anterior para no dejar una sobrecarga huérfana.
DROP FUNCTION IF EXISTS public.crear_pedido_con_reserva(
    JSONB, TEXT, NUMERIC, NUMERIC, TEXT, TEXT, TEXT, TEXT, NUMERIC, TEXT
);

CREATE OR REPLACE FUNCTION public.crear_pedido_con_reserva(p_items jsonb, p_tipo text DEFAULT 'mesa'::text, p_total numeric DEFAULT 0, p_total_usd numeric DEFAULT 0, p_mesa_id text DEFAULT NULL::text, p_cliente_nombre text DEFAULT ''::text, p_notas text DEFAULT ''::text, p_ficha text DEFAULT NULL::text, p_costo_delivery_usd numeric DEFAULT 0, p_parroquia text DEFAULT NULL::text)
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
    -- Costo de envío: se guarda en las tres columnas que ya existían en
    -- `pedidos` y que el cajero lee. Antes la RPC no las escribía, así que
    -- todo pedido de delivery nuevo quedaba con el envío en cero y el cajero
    -- mostraba "Delivery: Bs. 0,00".
    v_costo_usd  NUMERIC;
    v_costo_bs   NUMERIC;
    v_tasa_env   NUMERIC;
    v_parroquia  TEXT;
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
    -- La identidad sale de `cliente_actual`: sesión de Auth si existe, o la
    -- ficha firmada si es un invitado. Si no hay ninguna, el pedido se
    -- rechaza; antes caía en el literal 'anon', que es COMPARTIDO entre
    -- todos los invitados y habría dejado que uno viera los pedidos del otro.
    v_session   := public.cliente_actual(p_ficha);

    IF v_session IS NULL THEN
        RAISE EXCEPTION 'Falta la identidad del cliente'
            USING ERRCODE = '28000';
    END IF;

    -- ---------- costo de envío ----------
    --
    -- El cliente manda el costo en DÓLARES (el admin lo fija así) y acá se
    -- convierte a Bs con la TASA BASE del día, no con la efectiva: el envío
    -- no lleva el aumento del menú.
    --
    -- Se guardan las tres columnas que ya existían y que el cajero lee:
    --   costo_delivery      (la de siempre, en Bs)
    --   costo_delivery_usd  (lo que se pactó en dólares)
    --   costo_delivery_bs   (la conversión, congelada al crear el pedido)
    --
    -- Guardar la conversión congelada es lo correcto: si la tasa sube
    -- mañana, el envío de ayer no se revaloriza.
    v_costo_usd := COALESCE(p_costo_delivery_usd, 0);
    v_parroquia := NULLIF(btrim(COALESCE(p_parroquia, '')), '');

    IF v_costo_usd > 0 THEN
        SELECT COALESCE(tasa_cambio, tasa_efectiva, 1) INTO v_tasa_env
          FROM config WHERE id = 1;
        v_tasa_env := COALESCE(v_tasa_env, 1);
        v_costo_bs := ROUND(v_costo_usd * v_tasa_env, 2);
    ELSE
        v_costo_bs := 0;
    END IF;

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
        tasa_sin_firma, tasa_sin_firma_detalle,
        costo_delivery, costo_delivery_usd, costo_delivery_bs, parroquia
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
        v_detalle,
        v_costo_usd,   -- costo_delivery: el pacto en dólares, como se cargó
        v_costo_usd,   -- costo_delivery_usd
        v_costo_bs,    -- costo_delivery_bs: la conversión congelada
        v_parroquia
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
$function$

COMMIT;
