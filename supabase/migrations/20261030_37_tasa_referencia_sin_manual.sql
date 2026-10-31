-- ============================================================
-- 37 — La ventana de la tasa no debe ofrecer lo que cargó el admin
-- ============================================================
--
-- QUÉ PROBLEMA RESUELVE
--
-- En la ventana de "Consultar el BCV", después de escribir 200 a mano en
-- "Tasa Base" y aplicarla, la tarjeta decía:
--
--     VIGENTE  200.00  ·  manual_admin  ·  la que usás
--
-- Ese 200 no lo publicó el BCV: lo tipeó el admin. La ventana está hecha para
-- mostrar qué dijo el BCV y qué publicó para la fecha próxima; ofrecer la
-- carga propia como si fuera la referencia oficial es peor que no ofrecer
-- nada, porque invita a confirmar un error contra sí mismo.
--
-- POR QUÉ PASABA
--
-- `aplicar_tasa_elegida()` registra TODA decisión en `tasa_bcv`, incluida la
-- manual, y la guarda con `estado = 'aplicada'` porque es la que se cobra.
-- `tasa_bcv_vigente_json()` filtra `fecha_valor <= HOY AND estado = 'aplicada'`
-- y ordena por fecha valor: el 200 de hoy le ganaba a la tasa real del BCV.
--
-- El estado `aplicada` responde "¿esto es lo que se cobra?", que es una
-- pregunta distinta de "¿esto lo publicó el BCV?". Las dos funciones de
-- referencia tienen que preguntar lo segundo.
--
-- LA REGLA DEL DUEÑO
--
-- "Debería mostrarme la última tasa publicada hoy o la última de algún día
-- anterior (caso fin de semana, lunes bancario o día feriado) y la próxima,
-- si ya hay alguna publicada en alguna de las fuentes."
--
-- Es decir: solo lo que trajo una fuente. Lo que tipeó una persona no es una
-- tasa del BCV, ni vigente ni próxima. Sigue estando en `config` —es la que
-- se cobra— y sigue en el historial de capturas, con su motivo. Simplemente
-- no se ofrece como si fuera oficial.
--
-- Los orígenes humanos son los mismos que `nombreFuenteTasa()` ya traduce a
-- "Carga manual" en el panel: `carga_inicial`, `manual_admin`, `panel_admin`
-- y `manual`. Un respaldo (`open.er-api.com`, `currency-api`) NO es humano:
-- es una fuente que respondió, con `es_principal = false`, y debe seguir
-- apareciendo porque es la tasa real cuando la principal no contesta.
--
-- IDEMPOTENTE.
-- ============================================================

BEGIN;

-- ============================================================
-- ¿ESTA FILA LA TRAJO UNA FUENTE O LA TIPEO UNA PERSONA?
-- ============================================================
--
-- Se centraliza para que las dos funciones de referencia usen el mismo
-- criterio y no se desincronicen si mañana aparece otro origen humano.
CREATE OR REPLACE FUNCTION public.tasa_fue_carga_manual(p_fuente TEXT)
RETURNS BOOLEAN
LANGUAGE sql
IMMUTABLE
AS $$
    SELECT COALESCE(p_fuente, '') IN ('carga_inicial', 'manual_admin', 'panel_admin', 'manual');
$$;

COMMENT ON FUNCTION public.tasa_fue_carga_manual(TEXT) IS
    'true cuando el origen de la captura es una persona y no una fuente publicada. Se usa para excluirla de las tasas de referencia del BCV.';

-- ============================================================
-- LA VIGENTE: la última del BCV que ya rige
-- ============================================================
--
-- Sin cambios de criterio salvo uno: se descarta lo que cargó el admin.
--
-- El resto de la regla queda igual porque ya era correcta: `fecha_valor <=
-- CURRENT_DATE` y orden por fecha valor descendente resuelven solos los fines
-- de semana, los feriados y los lunes bancarios, donde no hay publicación
-- nueva y sigue rigiendo la del último día hábil. No se inventa nada.
CREATE OR REPLACE FUNCTION public.tasa_bcv_vigente_json()
RETURNS JSONB
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path TO 'public'
AS $$
    SELECT jsonb_build_object(
        'valor',         t.valor,
        'fecha_valor',   t.fecha_valor,
        'fuente',        t.fuente,
        'es_principal',  t.es_principal,
        'capturada_en',  t.capturada_en,
        'dias_atras',    (CURRENT_DATE - t.fecha_valor)
    )
      FROM tasa_bcv t
     WHERE t.fecha_valor <= CURRENT_DATE
       AND t.estado = 'aplicada'
       AND NOT public.tasa_fue_carga_manual(t.fuente)
     ORDER BY t.fecha_valor DESC, t.capturada_en DESC
     LIMIT 1;
$$;

-- ============================================================
-- LA PRÓXIMA: ya publicada, todavía no rige
-- ============================================================
--
-- Mismo criterio: la carga manual con fecha futura es un adelanto decidido
-- por una persona, no un anuncio del BCV. Tampoco se ofrece.
CREATE OR REPLACE FUNCTION public.tasa_bcv_proxima_json()
RETURNS JSONB
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path TO 'public'
AS $$
    SELECT jsonb_build_object(
        'valor',        t.valor,
        'fecha_valor',  t.fecha_valor,
        'fuente',       t.fuente,
        'es_principal', t.es_principal,
        'capturada_en', t.capturada_en,
        'dias_para',    (t.fecha_valor - CURRENT_DATE)
    )
      FROM tasa_bcv t
     WHERE t.fecha_valor > CURRENT_DATE
       AND t.estado IN ('aplicada', 'pendiente')
       AND NOT public.tasa_fue_carga_manual(t.fuente)
     ORDER BY t.fecha_valor ASC, t.capturada_en DESC
     LIMIT 1;
$$;

-- `tasa_panel()` no cambia: compone las dos funciones de arriba y la
-- diferencia contra `config`, así que hereda el arreglo sin tocarla.

COMMIT;
