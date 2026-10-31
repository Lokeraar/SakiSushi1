-- ============================================================
-- 38 — La captura nocturna no corría la noche del viernes
-- ============================================================
--
-- QUÉ PROBLEMA RESUELVE
--
-- La migración 36 programó la captura con `'40 2 * * 1-5'` y lo comentó como
-- "02:40 UTC = 22:40 hora Venezuela, día anterior". Ese comentario es correcto
-- y a la vez es la trampa: cron evalúa el día de la semana en UTC, no en la
-- hora local. Si 02:40 UTC del día N equivale a 22:40 del día N-1 en
-- Venezuela, entonces `1-5` (lunes a viernes UTC) cubre las noches de domingo
-- a jueves en Venezuela.
--
-- La noche del VIERNES en Venezuela es sábado 02:40 UTC, día 6, que queda
-- fuera del rango. Y esa es justo la noche que más importa: el BCV no publica
-- sábado ni domingo, así que la tasa del lunes se conoce el viernes por la
-- noche. El cron nunca la capturaba, y el lunes arrancaba con la tasa del
-- viernes anterior hasta que alguien la cargara a mano.
--
-- EVIDENCIA
--
-- Viernes 30/10/2026, 22:27 en Venezuela. El BCV ya había publicado la tasa
-- del lunes 02/11 a 889,5754. En `tasa_bcv` la captura más reciente seguía
-- siendo la del 30/10: la del lunes no existía. `tasa_bcv_proxima_json()`
-- devolvía NULL y la ventana del panel no ofrecía nada.
--
-- LA REGLA DEL DUEÑO
--
-- "El BCV publica también los viernes por la noche para el lunes. Únicamente
-- no publica sábados, domingo, lunes bancarios y días feriados."
--
-- O sea: se publica de domingo a jueves por la noche, más el viernes por la
-- noche. No se publica la noche del sábado (no hay nada que anunciar para el
-- domingo) ni la del domingo cuando el lunes es bancario o feriado.
--
-- Con `1-6` quedan cubiertas las noches de domingo a viernes en Venezuela.
-- La noche del sábado (domingo 02:40 UTC, día 0) sigue fuera, y debe estarlo.
--
-- POR QUÉ NO ROMPE LOS DÍAS SIN PUBLICACIÓN
--
-- El cron dispara la cadena de captura; si no hay publicación nueva, la
-- cadena no encuentra nada y no escribe. Un disparo de más no cuesta nada
-- porque es un solo intento por noche, no un sondeo cada 3 minutos.
--
-- IDEMPOTENTE.
-- ============================================================

BEGIN;

SELECT cron.unschedule('tasa-bcv-procesar')
 WHERE EXISTS (SELECT 1 FROM cron.job WHERE jobname = 'tasa-bcv-procesar');

-- 02:40 UTC del día N = 22:40 del día N-1 en Venezuela.
--   1-6 UTC = lunes a sábado UTC = domingo a viernes 22:40 en Venezuela
--   El lunes UTC (02:40) cubre la noche del domingo, que solo trae algo
--   cuando el lunes no es bancario ni feriado; si no hay nada, no escribe.
SELECT cron.schedule(
    'tasa-bcv-procesar',
    '40 2 * * 1-6',   -- 02:40 UTC = 22:40 VE del día anterior, dom-vie noche VE
    $$ SELECT public.resolver_captura_tasa(); $$
);

COMMIT;
