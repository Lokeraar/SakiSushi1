-- ============================================================
-- 20261021_17_config_publica_descuento.sql
--
-- Agrega `descuento_al_quitar` a la vista pública.
--
-- POR QUÉ HACE FALTA
--
-- El cliente lee su configuración de `config_publica`, no de la tabla `config`
-- (esa solo la leen cajero y admin desde la migración 05). Al crear la columna
-- en la migración 16, la vista no la incluyó: el navegador nunca se enteraba
-- del valor y siempre asumía el comportamiento por defecto.
--
-- Qué expone la vista: todo lo de config MENOS `admin_password`. Este campo es
-- una decisión de negocio (¿quitar ingredientes abarata?), no un secreto, así
-- que puede viajar al cliente sin problema.
--
-- Idempotente: CREATE OR REPLACE.
-- ============================================================

BEGIN;

CREATE OR REPLACE VIEW config_publica AS
SELECT id,
       tasa_cambio,
       tasa_efectiva,
       aumento_diario,
       aumento_acumulado,
       aumento_activo,
       aumento_semanal,
       aumento_detenido,
       aumento_desde,
       aumento_hasta,
       aumento_indefinido,
       fecha_ultimo_aumento,
       ultima_actualizacion,
       recovery_email,
       alerta_stock_minimo,
       -- Si es TRUE, quitar un ingrediente al personalizar devuelve al
       -- cliente el precio de venta de ese ingrediente. Si es FALSE, el
       -- plato se cobra completo igual. Lo decide el restaurante.
       descuento_al_quitar
  FROM config;

COMMENT ON VIEW config_publica IS
    'Configuración legible por el cliente anónimo. Todo menos admin_password.';

GRANT SELECT ON config_publica TO anon, authenticated;

NOTIFY pgrst, 'reload schema';

COMMIT;
