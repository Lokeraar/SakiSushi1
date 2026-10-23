-- ============================================================
-- 20261021_10_qr_wifi_config.sql
--
-- Cierra el circuito del wifi en los QR de mesa.
--
-- EL DEFECTO, TAL COMO ESTABA
--
-- El wifi estaba cortado en los dos extremos:
--
--   1. ADMIN: `renderizarQRs()` armaba la URL del QR con el ssid que estaba
--      en localStorage del navegador, nunca con la columna `codigos_qr.ssid`.
--      `generarQR()` tampoco guardaba ssid ni password en la base.
--
--   2. CLIENTE: `cliente-init.js` leia `?mesa=` y descartaba `wifi_ssid` y
--      `wifi_pwd`. No habia ninguna pantalla que los usara.
--
-- Resultado: las columnas ssid/password estaban muertas. El wifi viajaba
-- SOLO si el QR se generaba en el mismo telefono del admin. Desde otra
-- maquina el QR salia sin wifi y nadie se enteraba.
--
-- POR QUE EL WIFI NO VA DENTRO DEL QR
--
-- Meter el wifi en la URL del QR parece comodo pero obliga a reimprimir los
-- seis portamesas cada vez que cambie la clave. En un local eso es plata y
-- tiempo, y ademas los carteles viejos siguen circulando con la clave vieja.
--
-- En cambio: el QR lleva SOLO la mesa (nunca cambia) y el cliente consulta
-- los datos del wifi a la base al escanear. Si la clave cambia, se cambia en
-- un solo lugar y los carteles ya impresos siguen sirviendo.
--
-- SOBRE LA EXPOSICION DE LA CLAVE
--
-- La clave queda legible por anon. Es aceptable y es el modelo mental real:
-- la clave del wifi de un restaurante esta pegada en la pared. NO usar esta
-- tabla para credenciales que importen.
--
-- Idempotente.
-- ============================================================

BEGIN;

-- ============================================================
-- 1. Los datos del wifi viven en config, no en cada QR
-- ============================================================

ALTER TABLE config ADD COLUMN IF NOT EXISTS wifi_ssid TEXT;
ALTER TABLE config ADD COLUMN IF NOT EXISTS wifi_password TEXT;

COMMENT ON COLUMN config.wifi_ssid IS
    'Nombre de la red wifi del local. Se muestra al cliente al escanear el QR de mesa.';
COMMENT ON COLUMN config.wifi_password IS
    'Clave del wifi del local. Legible por anon a proposito: es la misma que esta pegada en la pared.';
COMMENT ON COLUMN codigos_qr.ssid IS
    'OBSOLETO desde 20261021_10. El wifi se lee de config. Se conserva la columna por compatibilidad.';


-- ============================================================
-- 2. Función pública que entrega solo los datos del wifi
--
--    Se usa una función y no acceso directo a `config` para no exponer
--    las demás claves (tasa, admin_password, minutos_pago...) al navegador
--    anónimo.
-- ============================================================

CREATE OR REPLACE FUNCTION public.wifi_publico()
RETURNS JSONB
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
    SELECT jsonb_build_object(
        'ssid',     NULLIF(TRIM(COALESCE(wifi_ssid, '')), ''),
        'password', NULLIF(TRIM(COALESCE(wifi_password, '')), '')
    )
    FROM config
    LIMIT 1;
$$;

GRANT EXECUTE ON FUNCTION public.wifi_publico() TO anon, authenticated;

COMMENT ON FUNCTION public.wifi_publico() IS
    'Devuelve solo ssid y password del wifi. Nunca expone el resto de config.';


-- ---------- recargar el cache de PostgREST ----------
NOTIFY pgrst, 'reload schema';

COMMIT;
