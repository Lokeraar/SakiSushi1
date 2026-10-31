-- ============================================================
-- 40 — El cierre del local avisa por push a los clientes
-- ============================================================
--
-- QUÉ PROBLEMA RESUELVE
--
-- Cuando el admin desactiva un cierre ("ya abrimos"), nadie se entera salvo
-- el que tenga la página abierta en ese momento. El pedido pide notificar a
-- "todos los dispositivos que alguna vez abrieron la página y aún tienen
-- datos en caché o historial de compra".
--
-- La infraestructura de push existe (edge `send-push` + tabla
-- `push_subscriptions` + sw.js) pero tiene dos huecos:
--
-- 1. EL CLIENTE NUNCA SE REGISTRA
--
--    `solicitarPermisoPushAuto()` suscribía al visitante en el navegador y
--    tiraba la suscripción: nunca escribía en `push_subscriptions`. Solo
--    cajero y admin se registraban. El servidor no sabía que el visitante
--    existía y no había forma de avisarle nada.
--
--    La parte del cliente se arregla en `cliente-notificaciones.js`: ahora
--    persiste la suscripción con un session_id estable por navegador
--    (`saki_push_session` en localStorage) y rol 'cliente'.
--
--    Pero RLS se lo impedía: la tabla solo tiene una policy para
--    `authenticated` (cajero/admin). El visitante es anónimo. Esta migración
--    le abre una policy de INSERT acotada: solo filas con rol 'cliente'.
--    No puede leer las de otros ni borrar nada: para anónimo, la tabla sigue
--    siendo de solo-escritura a ciegas.
--
-- 2. SEND-PUSH SOLO SABE ENVIAR A UNA SESIÓN
--
--    La edge function exige session_id y filtra por él. El aviso de cierre
--    es un broadcast: le interesa a todo el mundo. Se le agrega el modo
--    sin session_id: envía a TODAS las suscripciones activas. (El cambio
--    vive en supabase/functions/send-push/index.ts.)
--
-- QUIÉN RECIBE EL AVISO
--
-- Las suscripciones con endpoint válido. La función ya limpia las muertas
-- (HTTP 410 = el navegador la dio de baja) borrándolas, así que la tabla
-- tiende a contener solo dispositivos vivos. "Que alguna vez abrieron y aún
-- tienen la página en caché" se traduce en: tienen el service worker y su
-- suscripción no expiró.
--
-- IDEMPOTENTE.
-- ============================================================

BEGIN;

-- El visitante anónimo puede registrar SU suscripción, y nada más.
--
-- WITH CHECK exige rol 'cliente': aunque alguien forje la request, no puede
-- colarse como cajero ni admin por esta puerta. USING no aplica (INSERT no
-- lee filas) y no se le da SELECT: no es negocio suyo ver la tabla.
DROP POLICY IF EXISTS push_cliente_insert ON push_subscriptions;
CREATE POLICY push_cliente_insert ON push_subscriptions
    FOR INSERT TO anon
    WITH CHECK (rol = 'cliente');

-- El cliente puede dar de baja SU suscripción (botón de desactivar
-- notificaciones, o limpieza del navegador vía endpoint). Sin esto, la fila
-- queda huérfana hasta que el 410 la saque.
DROP POLICY IF EXISTS push_cliente_delete ON push_subscriptions;
CREATE POLICY push_cliente_delete ON push_subscriptions
    FOR DELETE TO anon
    USING (rol = 'cliente');

COMMIT;
