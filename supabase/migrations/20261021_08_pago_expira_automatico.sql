-- ============================================================
-- 20261021_08_pago_expira_automatico.sql
--
-- Cierra un hueco de la migración 07: `pago_expira_en` quedaba NULL en los
-- pedidos nuevos.
--
-- POR QUÉ PASA
--
-- La 07 rellenó el vencimiento de los pedidos existentes con un UPDATE, y
-- agregó la columna. Pero quien CREA un pedido es
-- `crear_pedido_con_reserva` (migración 01), y esa función no conoce la
-- columna: su INSERT no la incluye, así que queda NULL.
--
-- Verificado creando un pedido real: `pago_expira_en: NULL`. Con NULL el
-- barrido lo ignora (`AND pago_expira_en IS NOT NULL`), así que los pedidos
-- nuevos nunca vencían y el agujero seguía abierto.
--
-- POR QUÉ UN TRIGGER Y NO EDITAR LA FUNCIÓN
--
-- La 01 es un contrato probado del flujo de pedido. Un trigger BEFORE INSERT
-- cubre TODAS las vías de creación (la RPC, un insert manual, un script de
-- carga) sin tocar esa función. Es la opción con menos superficie de rotura.
--
-- Idempotente.
-- ============================================================

BEGIN;


CREATE OR REPLACE FUNCTION public.fijar_pago_expira()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
    v_minutos INTEGER;
BEGIN
    -- Solo actúa sobre pedidos nuevos en estado pendiente sin vencimiento.
    IF NEW.estado IS DISTINCT FROM 'pendiente' THEN
        RETURN NEW;
    END IF;

    IF NEW.pago_expira_en IS NOT NULL THEN
        RETURN NEW;   -- ya lo trae puesto: se respeta
    END IF;

    SELECT minutos_pago INTO v_minutos FROM config WHERE id = 1;
    IF v_minutos IS NULL OR v_minutos <= 0 THEN
        v_minutos := 20;   -- respaldo si la config no está
    END IF;

    NEW.pago_expira_en := COALESCE(NEW.created_at, NEW.fecha, NOW())
                        + (v_minutos || ' minutes')::INTERVAL;

    RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_pedidos_pago_expira ON pedidos;

CREATE TRIGGER trg_pedidos_pago_expira
    BEFORE INSERT ON pedidos
    FOR EACH ROW
    EXECUTE FUNCTION public.fijar_pago_expira();

COMMENT ON FUNCTION public.fijar_pago_expira() IS
    'Asigna pedidos.pago_expira_en al crear un pedido pendiente, usando config.minutos_pago.';


-- ---------- rellenar los que quedaron en NULL por la 07 ----------
UPDATE pedidos p
   SET pago_expira_en = COALESCE(p.created_at, p.fecha, NOW())
                      + ((SELECT minutos_pago FROM config WHERE id = 1) || ' minutes')::INTERVAL
 WHERE p.pago_expira_en IS NULL
   AND p.stock_movido_at IS NULL
   AND p.estado = 'pendiente';


NOTIFY pgrst, 'reload schema';

COMMIT;
