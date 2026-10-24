-- ============================================================
-- 20261021_16_descuento_opcional_al_quitar.sql
--
-- Hace OPCIONAL el descuento por quitar ingredientes.
--
-- POR QUÉ
--
-- Hoy quitar un ingrediente SIEMPRE abarata: se le devuelve al cliente el
-- precio de venta del ingrediente (inventario.precio_unitario).
--
-- El dueño quiere que eso sea una decisión del restaurante, no una regla
-- fija, por dos razones:
--
--   1. Hay clientes con alergias o intolerancias que necesitan sacar un
--      ingrediente para poder comer el plato. Cobrarles menos es un gesto
--      que casi ningún restaurante hace, y él lo quiere como diferenciación.
--
--   2. Pero un plato ya está armado: la cocina gasta el mismo trabajo. Hay
--      restaurantes que no quieren devolver plata por eso.
--
-- Por eso: un interruptor en config. Encendido = quitar abarata (lo de hoy).
-- Apagado = se cobra el plato completo aunque saque la mitad.
--
-- DÓNDE SE APLICA
--
-- Solo en el cálculo del PRECIO EN EL NAVEGADOR (cliente-customize.js). No
-- toca la base de pedidos ni las RPC: el precio ya viaja calculado desde el
-- cliente, igual que hoy. Cambiar solo esto no rompe nada de lo probado.
--
-- Idempotente.
-- ============================================================

BEGIN;

-- Por defecto ENCENDIDO: es el comportamiento actual, así nadie nota un
-- cambio sin haberlo pedido. Apagarlo es una decisión explícita del dueño.
ALTER TABLE config
    ADD COLUMN IF NOT EXISTS descuento_al_quitar BOOLEAN NOT NULL DEFAULT TRUE;

COMMENT ON COLUMN config.descuento_al_quitar IS
    'Si es TRUE, quitar un ingrediente al personalizar devuelve al cliente el precio de venta de ese ingrediente. Si es FALSE, el plato se cobra completo igual.';

-- La vista pública NO lo incluye a propósito: es una decisión de negocio
-- que el cliente no necesita leer de la base. El navegador lo recibe dentro
-- de la configuración que ya carga al iniciar.

NOTIFY pgrst, 'reload schema';

COMMIT;
