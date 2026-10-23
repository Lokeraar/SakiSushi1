-- ============================================================
-- 20261021_07_reservas_vencidas.sql
--
-- Cierra el agujero de las reservas huérfanas.
--
-- EL PROBLEMA REAL
--
-- `crear_pedido_con_reserva` (01) aparta ingredientes al crear el pedido:
-- inventario.reservado += consumo. Esos gramos quedan bloqueados.
--
-- Nada los libera nunca. Verificado:
--   * El timer de 20 minutos del Cliente solo cierra el modal y muestra
--     "Pedido cancelado". NO llama a liberar_ingredientes.
--   * El timer vive en el navegador: si el cliente cierra la pestaña, el
--     reloj muere con ella y la reserva queda tomada para siempre.
--   * `liberar_ingredientes` solo se llama cuando el cajero rechaza a mano.
--
-- Resultado: un cliente que arma un pedido y se le corta la batería deja el
-- inventario 0.30 kg abajo sin que nadie sepa por qué.
--
-- FLUJO DEFINIDO POR EL DUEÑO
--
--   FASE 1 (carrito): vive solo en el navegador. No hay reserva en la base,
--   así que no hay nada que liberar acá. El vencimiento del carrito se
--   resuelve en el Cliente (localStorage). Esta migración NO lo toca.
--
--   FASE 2 (pedido confirmado): la reserva existe en la base. Son 20
--   minutos para pagar. Al vencer: se libera la reserva, se cancela el
--   pedido y se notifica al cliente.
--
-- LA EXCEPCIÓN QUE PROTEGE AL CAJERO
--
-- Si el cliente YA subió el comprobante, la reserva NO se libera. El cajero
-- tiene que poder revisarlo sin que el stock se le escape debajo. Esa
-- decisión es del dueño: "comprobante subido queda protegido".
--
-- Y como la alarma del Cajero suena en bucle mientras haya pedidos
-- 'pendiente', un pedido protegido mantiene la alarma encendida hasta que
-- el cajero apruebe o rechace. Eso es intencional.
--
-- Idempotente: se puede aplicar más de una vez.
-- ============================================================

BEGIN;


-- ============================================================
-- 1. Plazo configurable
--    Por defecto 20 minutos, tal como funciona hoy. Se deja la columna
--    para poder exponerla en el panel más adelante sin otra migración.
-- ============================================================

ALTER TABLE config
    ADD COLUMN IF NOT EXISTS minutos_pago INTEGER NOT NULL DEFAULT 20;

COMMENT ON COLUMN config.minutos_pago IS
    'Minutos que tiene el cliente para pagar un pedido ya confirmado antes de que la reserva se libere.';

-- Guarda de cordura: un 0 acá cancelaría todo pedido al instante.
DO $$
BEGIN
    IF NOT EXISTS (
        SELECT 1 FROM pg_constraint WHERE conname = 'config_minutos_pago_check'
    ) THEN
        ALTER TABLE config
            ADD CONSTRAINT config_minutos_pago_check
            CHECK (minutos_pago BETWEEN 1 AND 240);
    END IF;
END $$;


-- ============================================================
-- 2. Columna de vencimiento en pedidos
--    Se calcula al crear el pedido. Guardarla (en vez de calcularla con
--    created_at + intervalo en cada consulta) permite indexarla y deja
--    registro de cuándo se evaluó por última vez.
-- ============================================================

ALTER TABLE pedidos
    ADD COLUMN IF NOT EXISTS pago_expira_en TIMESTAMP WITH TIME ZONE;

COMMENT ON COLUMN pedidos.pago_expira_en IS
    'Momento en que vence el plazo de pago. NULL en pedidos anteriores a esta migración o ya movidos.';

CREATE INDEX IF NOT EXISTS idx_pedidos_pago_expira
    ON pedidos (pago_expira_en)
    WHERE stock_movido_at IS NULL;


-- ============================================================
-- 3. Rellenar el vencimiento de los pedidos pendientes que ya existen
--    Sin esto, los pedidos viejos quedarían con NULL y el barrido nunca
--    los vería. Se usa created_at + config.minutos_pago.
-- ============================================================

UPDATE pedidos p
   SET pago_expira_en = COALESCE(p.created_at, p.fecha, NOW())
                      + ((SELECT minutos_pago FROM config WHERE id = 1) || ' minutes')::INTERVAL
 WHERE p.pago_expira_en IS NULL
   AND p.stock_movido_at IS NULL
   AND p.estado = 'pendiente';


-- ============================================================
-- 4. Barrido de reservas vencidas
--
--    SECURITY DEFINER porque lo invoca pg_cron, que corre sin sesión de
--    usuario. No valida rol a propósito: no lo llama una persona, lo llama
--    el reloj del servidor. La protección está en que es SECURITY DEFINER
--    y NO se otorga EXECUTE a anon ni a authenticated.
-- ============================================================

CREATE OR REPLACE FUNCTION public.liberar_reservas_vencidas()
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
    v_pedido       RECORD;
    v_liberados    INTEGER := 0;
    v_protegidos   INTEGER := 0;
    v_detalle      JSONB := '[]'::JSONB;
    v_motivo       TEXT;
    v_consumo      JSONB;
    v_ing_id       TEXT;
    v_cantidad     NUMERIC;
BEGIN
    FOR v_pedido IN
        SELECT id, items, comprobante_url, tipo, session_id
          FROM pedidos
         WHERE estado = 'pendiente'
           AND stock_movido_at IS NULL          -- reserva todavía viva
           AND pago_expira_en IS NOT NULL
           AND pago_expira_en < NOW()           -- ya venció
         ORDER BY pago_expira_en
         FOR UPDATE SKIP LOCKED                 -- no pelear con un cobro en curso
    LOOP
        -- ── Excepción: el comprobante ya está subido ──
        -- El cajero tiene que poder revisarlo. No se toca la reserva y se
        -- deja la alarma sonando. Se cuenta aparte para poder observarlo.
        IF v_pedido.comprobante_url IS NOT NULL AND v_pedido.comprobante_url <> '' THEN
            v_protegidos := v_protegidos + 1;
            CONTINUE;
        END IF;

        -- ── Liberar la reserva ──
        -- NO se usa `liberar_ingredientes`: esa función exige rol de cajero o
        -- admin (migración 06, hallazgo R1-001), y el barrido corre sin
        -- sesión: `rol_actual()` devuelve NULL y el guardián corta.
        --
        -- La distinción importa: `liberar_ingredientes` es una acción de una
        -- PERSONA y tiene que estar acotada por rol. El barrido es el reloj
        -- del servidor, y su garantía es otra: no se otorga EXECUTE a nadie.
        --
        -- Se reutiliza `consumo_pedido`, que ya respeta `ingredientes_quitados`,
        -- para que el cálculo no diverja del que usa el cobro.
        v_consumo := public.consumo_pedido(v_pedido.items);

        IF v_consumo <> '{}'::JSONB THEN
            FOR v_ing_id IN SELECT jsonb_object_keys(v_consumo)
            LOOP
                v_cantidad := (v_consumo->>v_ing_id)::NUMERIC;
                UPDATE inventario
                   SET reservado  = GREATEST(0, reservado - v_cantidad),
                       updated_at = NOW()
                 WHERE id = v_ing_id;
            END LOOP;
        END IF;

        UPDATE pedidos
           SET estado            = 'cancelado',
               stock_movido_at   = NOW(),
               stock_movimiento  = 'liberado',
               updated_at        = NOW()
         WHERE id = v_pedido.id
           AND estado = 'pendiente';

        -- ── Avisar al cliente ──
        -- Sin esto el carrito le desaparece y no sabe por qué. El mensaje
        -- depende del tipo de pedido, como pidió el dueño.
        v_motivo := CASE v_pedido.tipo
            WHEN 'mesa'     THEN 'Pasaron ' || (SELECT minutos_pago FROM config WHERE id = 1) || ' minutos y no se registró el pago en caja.'
            WHEN 'delivery' THEN 'Pasaron ' || (SELECT minutos_pago FROM config WHERE id = 1) || ' minutos y no llegó el comprobante del pago móvil.'
            ELSE                 'Pasaron ' || (SELECT minutos_pago FROM config WHERE id = 1) || ' minutos y no se confirmó el pago de la reserva.'
        END;

        INSERT INTO notificaciones (pedido_id, tipo, titulo, mensaje, session_id, leida)
        VALUES (
            v_pedido.id,
            'rejected',
            '⏰ Pedido cancelado por tiempo',
            v_motivo || ' El inventario reservado volvió al stock. Podés volver a pedir cuando quieras.',
            v_pedido.session_id,
            false
        );

        v_liberados := v_liberados + 1;
        v_detalle := v_detalle || jsonb_build_object('pedido_id', v_pedido.id, 'tipo', v_pedido.tipo);
    END LOOP;

    IF v_liberados > 0 THEN
        RAISE NOTICE 'Reservas vencidas liberadas: % (protegidas por comprobante: %)', v_liberados, v_protegidos;
    END IF;

    RETURN jsonb_build_object(
        'success',    true,
        'liberados',  v_liberados,
        'protegidos', v_protegidos,
        'detalle',    v_detalle,
        'ejecutado_en', NOW()
    );
END;
$$;

-- NO se otorga EXECUTE a anon ni authenticated: solo el cron y el dueño.
REVOKE ALL ON FUNCTION public.liberar_reservas_vencidas() FROM PUBLIC;


-- ============================================================
-- 5. Programar el barrido
--    Cada minuto. La ventana de 20 minutos hace que un minuto de retraso
--    sea irrelevante, y el WHERE con índice parcial mantiene el costo
--    en cero cuando no hay nada vencido.
-- ============================================================

DO $$
DECLARE
    v_job_id BIGINT;
BEGIN
    -- Idempotencia: si ya existe un job con este nombre, se reemplaza.
    SELECT jobid INTO v_job_id FROM cron.job WHERE jobname = 'saki-liberar-reservas-vencidas';
    IF v_job_id IS NOT NULL THEN
        PERFORM cron.unschedule(v_job_id);
    END IF;

    PERFORM cron.schedule(
        'saki-liberar-reservas-vencidas',
        '* * * * *',
        $cron$ SELECT public.liberar_reservas_vencidas(); $cron$
    );
END $$;


-- ---------- recargar el cache de PostgREST ----------
NOTIFY pgrst, 'reload schema';

COMMIT;
