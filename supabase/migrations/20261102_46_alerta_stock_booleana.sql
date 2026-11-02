-- ============================================================================
-- 46 — `alerta_stock_minimo` pasa a ser un interruptor
-- ============================================================================
--
-- QUÉ ERA
--
-- La columna se creó como `integer DEFAULT 5`. El nombre y el tipo sugieren
-- que en algún momento fue "el umbral global de stock bajo: 5 unidades".
--
-- QUÉ SE ENCONTRÓ AL IMPLEMENTAR LA MARQUESINA
--
-- El código nunca la usó. El umbral real siempre fue POR INGREDIENTE, en
-- `inventario.minimo`, que es lo que el dueño configura en cada uno y lo que
-- ya usan el semáforo del módulo y el contador "Alertas Stock":
--
--     disponible <= minimo  &&  minimo > 0
--
-- Es decir: el 5 global es una idea que se abandonó a favor del mínimo por
-- ingrediente, y quedó la columna con su valor viejo. Nadie la lee.
--
-- QUÉ HACE ESTA MIGRACIÓN
--
-- La convierte en booleana: un interruptor de "mostrar o no la franja de stock
-- bajo en Inicio". El umbral no se toca porque ya vive donde debe.
--
-- La conversión conserva el significado: cualquier valor distinto de 0 pasa a
-- TRUE. Si el dueño tenía 5, la franja queda encendida; si alguien puso 0,
-- queda apagada. No se pierde ninguna decisión.
--
-- ORDEN OBLIGATORIO
--
-- PostgreSQL no deja cambiar el tipo de una columna que usa una vista. La
-- vista `config_publica` la expone, así que hay que soltarla primero y
-- recrearla al final.
--
-- Todo va en una sola transacción a propósito: entre el DROP y el CREATE la
-- vista no existe, y el cliente lee la tasa justo de ahí. Un corte en medio
-- dejaría la carta sin precios. Así, o queda todo, o no queda nada.
-- ============================================================================

BEGIN;

-- La vista depende de la columna: se suelta antes de tocar el tipo.
DROP VIEW IF EXISTS public.config_publica;

ALTER TABLE public.config
    ALTER COLUMN alerta_stock_minimo DROP DEFAULT;

ALTER TABLE public.config
    ALTER COLUMN alerta_stock_minimo TYPE BOOLEAN
    USING (COALESCE(alerta_stock_minimo, 1) <> 0);

ALTER TABLE public.config
    ALTER COLUMN alerta_stock_minimo SET DEFAULT TRUE;

-- Se copia EXACTAMENTE la lista de columnas que la vista tenía, sin agregar ni
-- quitar ninguna: cambiar el conjunto puede romper a quien consulta con
-- `select('*')`. Solo cambia el tipo de la columna convertida.
CREATE OR REPLACE VIEW public.config_publica AS
SELECT id, tasa_cambio, tasa_efectiva, aumento_diario, aumento_acumulado,
       aumento_activo, aumento_semanal, aumento_detenido, aumento_desde,
       aumento_hasta, aumento_indefinido, fecha_ultimo_aumento,
       ultima_actualizacion, recovery_email, alerta_stock_minimo,
       descuento_al_quitar
  FROM public.config;

GRANT SELECT ON public.config_publica TO anon, authenticated;

COMMIT;
