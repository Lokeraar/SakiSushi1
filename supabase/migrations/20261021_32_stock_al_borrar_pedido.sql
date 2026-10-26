-- 20261021_32_stock_al_borrar_pedido.sql
--
-- HALLAZGO R4 DE LA AUDITORÍA DE RED (2026-10-26)
--
-- `crear_pedido_con_reserva()` reserva ingredientes subiendo
-- `inventario.reservado`. Ese número se libera por tres caminos:
--
--   1. `liberar_reservas_vencidas()` — cancela por tiempo vencido
--   2. el cobro, que convierte la reserva en consumo real
--   3. el rechazo del cajero
--
-- Ninguno cubre el DELETE de la fila. Verificado en la auditoría: se borró un
-- pedido pendiente y `sum(reservado)` quedó igual, con el stock tomado para
-- siempre.
--
-- RIESGO HOY: bajo. Ninguna pantalla borra pedidos (cero `.delete()` sobre
-- `pedidos` en todo el repo). Pero cualquier limpieza manual —un script, el
-- editor de Supabase, una prueba de desarrollo— deja inventario fantasma que
-- nunca vuelve, y el síntoma aparece semanas después como "faltan insumos que
-- nadie usó".
--
-- RIESGO EN PRODUCCIÓN: alto. La cancelación por tiempo NO debería borrar,
-- pero un pedido viejo que alguien limpie a mano sí arrastra el stock.
--
-- La solución no es "no borrar nunca": es que borrar devuelva lo reservado.
-- Un trigger BEFORE DELETE lo garantiza sin depender de que la app se acuerde.

CREATE OR REPLACE FUNCTION public.liberar_stock_al_borrar_pedido()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $function$
DECLARE
    v_consumo JSONB;
    v_ing_id  TEXT;
    v_cant    NUMERIC;
BEGIN
    -- Solo si el pedido todavía tenía el stock tomado. Si ya se cobró o ya se
    -- liberó por vencimiento, `stock_movido_at` tiene fecha y no hay nada que
    -- devolver: restar de nuevo inventaría stock que no existe.
    IF OLD.stock_movido_at IS NOT NULL THEN
        RETURN OLD;
    END IF;

    -- Se reutiliza `consumo_pedido`, la MISMA función que usan el cobro y el
    -- barrido de vencidas, para que el cálculo no pueda divergir. Si se
    -- recalculara acá a mano, un cambio futuro en la forma de consumir
    -- ingredientes dejaría este camino desincronizado en silencio.
    v_consumo := public.consumo_pedido(OLD.items);

    IF v_consumo = '{}'::JSONB OR v_consumo IS NULL THEN
        RETURN OLD;
    END IF;

    FOR v_ing_id IN SELECT jsonb_object_keys(v_consumo)
    LOOP
        v_cant := (v_consumo->>v_ing_id)::NUMERIC;

        -- GREATEST(0, ...) para no dejar valores negativos si por alguna razón
        -- el reservado ya era menor. Un negativo silencioso es peor que un
        -- cero: infla el stock disponible y permite vender lo que no hay.
        UPDATE inventario
           SET reservado  = GREATEST(0, reservado - v_cant),
               updated_at = NOW()
         WHERE id = v_ing_id;
    END LOOP;

    RETURN OLD;
END;
$function$;

COMMENT ON FUNCTION public.liberar_stock_al_borrar_pedido() IS
    'Devuelve al inventario lo que tenía reservado un pedido que se borra sin '
    'haber movido el stock (hallazgo R4). Usa consumo_pedido() para no divergir.';

DROP TRIGGER IF EXISTS trg_liberar_stock_al_borrar ON public.pedidos;

CREATE TRIGGER trg_liberar_stock_al_borrar
    BEFORE DELETE ON public.pedidos
    FOR EACH ROW
    EXECUTE FUNCTION public.liberar_stock_al_borrar_pedido();
