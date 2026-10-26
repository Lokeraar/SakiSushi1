-- 20261021_30_tasa_proxima_incluye_aplicada.sql
--
-- POR QUÉ EXISTE
--
-- La migración 28 agregó `tasa_bcv_proxima_json()` para que la ventana del día
-- pudiera ofrecer "establecer la próxima conocida". La filtró así:
--
--     WHERE t.fecha_valor > CURRENT_DATE
--       AND t.estado = 'pendiente'
--
-- Ese `estado = 'pendiente'` estaba mal. `aplicar_tasa_elegida()` marca la
-- captura como 'aplicada' cuando el admin la adopta por adelantado (mira el
-- comentario v_motivo: "Aplicada por decisión del admin antes de su fecha
-- valor"). Entonces, en cuanto alguien usaba el botón una vez, la fila dejaba
-- de ser 'pendiente', la función devolvía NULL, y el botón DESAPARECÍA de la
-- ventana para siempre.
--
-- Peor: el admin quedaba con la tasa nueva aplicada en config, pero sin forma
-- de volver a elegirla ni de ver de dónde salió, porque la lista de opciones
-- se había quedado sin la segunda.
--
-- Lo correcto es que "próxima" signifique lo que dice: una publicación con
-- fecha valor futura, esté pendiente o ya adoptada. Lo único que se excluye
-- es 'descartada', que es una fila que alguien rechazó a propósito.
--
-- Estado de los datos al aplicar esta migración: la fila id 6 (887.3020 del
-- 2026-10-27) había quedado 'aplicada' por una prueba. Vuelve a 'pendiente',
-- porque probar un botón no es una decisión de negocio, y config vuelve a
-- 886.23.

CREATE OR REPLACE FUNCTION public.tasa_bcv_proxima_json()
RETURNS jsonb
LANGUAGE sql
STABLE SECURITY DEFINER
SET search_path TO 'public'
AS $function$
    SELECT jsonb_build_object(
        'valor',        t.valor,
        'fecha_valor',  t.fecha_valor,
        'fuente',       t.fuente,
        'estado',       t.estado,
        'capturada_en', t.capturada_en,
        'dias_adelante', (t.fecha_valor - CURRENT_DATE)
    )
      FROM tasa_bcv t
     WHERE t.fecha_valor > CURRENT_DATE
       AND t.estado <> 'descartada'
     ORDER BY t.fecha_valor ASC, t.capturada_en DESC
     LIMIT 1;
$function$;

COMMENT ON FUNCTION public.tasa_bcv_proxima_json() IS
    'Captura del BCV con fecha valor futura más cercana (pendiente o ya adoptada, '
    'nunca descartada). Es la que la ventana del día ofrece como "la próxima".';

REVOKE ALL ON FUNCTION public.tasa_bcv_proxima_json() FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.tasa_bcv_proxima_json() TO authenticated;

-- ============================================================
-- Restaurar el estado que dejó la prueba del botón
-- ============================================================
UPDATE tasa_bcv
   SET estado        = 'pendiente',
       motivo_estado = 'Fecha valor futura: se guarda pero no se aplica hasta que llegue el día',
       aplicada_en   = NULL
 WHERE fecha_valor > CURRENT_DATE
   AND estado = 'aplicada'
   AND motivo_estado LIKE 'Aplicada por decisión del admin antes de su fecha valor%';

-- Y config vuelve a la tasa vigente real (la de fecha valor pasada).
UPDATE config
   SET tasa_cambio   = (SELECT valor FROM tasa_bcv
                         WHERE fecha_valor <= CURRENT_DATE AND estado = 'aplicada'
                         ORDER BY fecha_valor DESC LIMIT 1),
       tasa_efectiva = (SELECT valor FROM tasa_bcv
                         WHERE fecha_valor <= CURRENT_DATE AND estado = 'aplicada'
                         ORDER BY fecha_valor DESC LIMIT 1)
 WHERE id = 1;

-- ============================================================
-- La causa raíz de verdad: el CHECK de la tabla
-- ============================================================
--
-- La migración 29 arregló la lista de acciones válidas DENTRO de la función
-- `confirmar_revision_tasa`, y con eso la ventana dejó de dar error... pero la
-- fila seguía sin insertarse. Había una segunda barrera, más abajo:
--
--   CONSTRAINT tasa_revision_accion_valida
--     CHECK (accion = ANY (ARRAY['mantener','aplicar_bcv','aplicar_otra','sin_captura']))
--
-- O sea: la función aceptaba 'aplicar_proxima' y el INSERT fallaba al llegar
-- a la tabla. Había que arreglar los dos lados, no uno.
ALTER TABLE public.tasa_revision_diaria
    DROP CONSTRAINT IF EXISTS tasa_revision_accion_valida;

ALTER TABLE public.tasa_revision_diaria
    ADD CONSTRAINT tasa_revision_accion_valida
    CHECK (accion = ANY (ARRAY[
        'mantener'::text,
        'aplicar_bcv'::text,
        'aplicar_proxima'::text,
        'aplicar_otra'::text,
        'sin_captura'::text
    ]));
