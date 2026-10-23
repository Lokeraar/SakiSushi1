-- ============================================================
-- 20261021_12_reserva_sin_vencimiento.sql
--
-- Exceptúa las reservas del vencimiento de pago.
--
-- EL PROBLEMA
--
-- El trigger `fijar_pago_expira` (migración 08) pone un plazo a todo pedido
-- nuevo en estado 'pendiente'. La migración 11 creaba la reserva con
-- pago_expira_en = NULL esperando que se respetara, pero el trigger lo
-- interpreta como "todavía no lo puse" y lo completa igual:
--
--     IF NEW.pago_expira_en IS NOT NULL THEN RETURN NEW; END IF;
--
-- Verificado: la reserva de prueba quedó con pago_expira_en a 20 minutos.
--
-- POR QUÉ NO ALCANZA CON EL BARRIO
--
-- `liberar_reservas_vencidas()` ya protege los pedidos con comprobante
-- subido (los cuenta en `v_protegidos` y los salta). Una reserva siempre
-- trae comprobante, así que en la práctica nunca se cancelaba por reloj.
--
-- Pero esa protección es por COMPROBANTE, no por TIPO. Es frágil: si algún
-- flujo creara una reserva sin comprobante, el barrido la cancelaría a los
-- 20 minutos, y una reserva es para otro día.
--
-- Por eso se corrige la causa: una reserva no lleva plazo, porque no espera
-- un pago. Llega pagada. Su ciclo lo cierra un cajero, aprobando o
-- rechazando.
--
-- LO QUE **NO** SE TOCA
--
-- `liberar_reservas_vencidas()` se deja exactamente como está. Ya funciona,
-- tiene su protección, sus notificaciones por tipo de pedido y su
-- comentario que explica por qué no usa `liberar_ingredientes`. Reescribirla
-- habría sido un riesgo sin beneficio: es la función que más se probó de
-- todo el sistema.
--
-- Idempotente.
-- ============================================================

BEGIN;

CREATE OR REPLACE FUNCTION public.fijar_pago_expira()
RETURNS TRIGGER
LANGUAGE plpgsql
AS $$
DECLARE
    v_minutos INTEGER;
BEGIN
    -- Solo actúa sobre pedidos nuevos en estado pendiente.
    IF NEW.estado IS DISTINCT FROM 'pendiente' THEN
        RETURN NEW;
    END IF;

    -- El plazo existe para pedidos que ESPERAN un pago. Una reserva llega
    -- con el comprobante ya subido: no hay nada que esperar. Sin esta
    -- excepción el barrido la cancelaría a los 20 minutos.
    IF NEW.tipo = 'reserva' THEN
        NEW.pago_expira_en := NULL;
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

NOTIFY pgrst, 'reload schema';

COMMIT;
