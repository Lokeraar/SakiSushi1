-- ============================================================
-- 20261021_23_tasa_panel.sql
--
-- EL PANEL DE LA TASA
--
-- QUÉ FALTABA
--
-- La migración 22 empezó a capturar la tasa del BCV con su FECHA VALOR y a
-- guardar cada captura en la tabla `tasa_bcv`. Pero nadie podía verlo: el
-- admin seguía mirando un número suelto en un input, sin saber de dónde salió,
-- a qué fecha corresponde, ni si era la que regía.
--
-- Sin esa información, la única forma de desmentir una tasa era abrir el
-- Instagram del BCV y comparar a ojo.
--
-- QUÉ AGREGA ESTA MIGRACIÓN
--
--   1. `tasa_panel()`  -> una sola llamada que devuelve el cuadro completo:
--                         la tasa del BCV con su fecha valor y su origen, la
--                         "próxima" capturada si existe, la que el sistema
--                         está cobrando hoy, la diferencia medida, y las
--                         últimas capturas.
--
--   2. `aplicar_tasa_elegida()` -> el ÚNICO camino por el que una decisión
--                         del admin sobre la tasa toca `config`.
--
-- LA REGLA QUE SE ROMPE A PROPÓSITO (y por qué)
--
-- La migración 22 escribió: "una fecha valor futura NUNCA se aplica". Esa
-- regla protege contra un sistema que se adelanta solo. No protege contra un
-- humano que decide, sabiendo, cobrar con la tasa que el BCV ya publicó para
-- el martes.
--
-- El dueño pidió poder elegir. Se puede, pero queda escrito: la captura se
-- guarda con `motivo_estado` que dice que fue una decisión y con qué criterio.
-- Si mañana alguien pregunta por qué ese día se cobró con una tasa que todavía
-- no regía, la respuesta está en la base, no en la memoria de nadie.
--
-- IDEMPOTENTE.
-- ============================================================

BEGIN;

-- ============================================================
-- CUÁL ES LA TASA DEL BCV QUE RIGE HOY
-- ============================================================
--
-- Es la más reciente cuya fecha valor NO sea futura.
--
-- Ojo: devuelve UN objeto (o NULL), no un conjunto de filas. La versión de la
-- migración 22 devolvía TABLE(...); esta devuelve JSONB para poder componerla
-- dentro de `tasa_panel()` sin tocar la firma vieja. `tasa_vigente()` queda
-- como estaba, para no romper a quien ya la use.
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
        -- Días transcurridos desde la fecha valor hasta hoy.
        -- 0 = es de hoy, 1 = es de ayer.
        'dias_atras',    (CURRENT_DATE - t.fecha_valor)
    )
      FROM tasa_bcv t
     WHERE t.fecha_valor <= CURRENT_DATE
       AND t.estado = 'aplicada'
     ORDER BY t.fecha_valor DESC, t.capturada_en DESC
     LIMIT 1;
$$;

-- ============================================================
-- LA PRÓXIMA: ya publicada, todavía no rige
-- ============================================================
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
        -- Cuántos días faltan para que rija. Siempre >= 1.
        'dias_para',    (t.fecha_valor - CURRENT_DATE)
    )
      FROM tasa_bcv t
     WHERE t.fecha_valor > CURRENT_DATE
       AND t.estado IN ('aplicada', 'pendiente')
     ORDER BY t.fecha_valor ASC, t.capturada_en DESC
     LIMIT 1;
$$;

-- ============================================================
-- EL CUADRO COMPLETO, EN UNA SOLA LLAMADA
-- ============================================================
--
-- El navegador NO calcula nada: la diferencia, el umbral de aviso y qué es
-- "vigente" viven acá, igual que la vigencia de las ofertas vive en la base.
CREATE OR REPLACE FUNCTION public.tasa_panel()
RETURNS JSONB
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path TO 'public'
AS $$
DECLARE
    v_bcv          JSONB;
    v_proxima      JSONB;
    v_cfg          RECORD;
    v_base         NUMERIC;
    v_dif_bs       NUMERIC;
    v_dif_pct      NUMERIC;
    v_signo        TEXT;
    v_es_igual     BOOLEAN := FALSE;
    v_capturas     JSONB;
    v_umbral       NUMERIC := 0.5;   -- mismo umbral que el aviso del admin
BEGIN
    v_bcv     := public.tasa_bcv_vigente_json();
    v_proxima := public.tasa_bcv_proxima_json();

    SELECT tasa_cambio, tasa_efectiva, aumento_acumulado, ultima_actualizacion
      INTO v_cfg
      FROM config
     WHERE id = 1;

    v_base := COALESCE(v_cfg.tasa_cambio, 0);

    -- La diferencia se mide SIEMPRE contra la tasa base confirmada, que es el
    -- número que fija el precio. La efectiva incluye el aumento acumulado y
    -- compararla con el BCV daría una diferencia falsa.
    --
    -- Tolerancia: por debajo de un centavo de bolívar por dólar se considera
    -- IGUAL. El admin escribe 886,23 y el BCV publica 886,2271: esa diferencia
    -- es el redondeo del formulario, no una decisión. Reportarla como "sobran
    -- Bs 0,00" sería ruido que enseña al admin a ignorar el panel.
    IF v_bcv IS NOT NULL AND v_base > 0 THEN
        v_dif_bs  := (v_bcv->>'valor')::NUMERIC - v_base;
        v_dif_pct := ROUND(((v_dif_bs) / v_base * 100)::NUMERIC, 4);
        v_es_igual := ABS(v_dif_bs) < 0.01;
        v_signo   := CASE WHEN v_es_igual THEN 'igual'
                          WHEN v_dif_bs > 0 THEN 'falta'
                          WHEN v_dif_bs < 0 THEN 'sobra'
                          ELSE 'igual' END;
    END IF;

    -- Últimas capturas, para el historial. Se muestran las 10 más recientes
    -- sin importar su estado: lo que interesa es reconstruir qué pasó.
    SELECT COALESCE(jsonb_agg(fila ORDER BY fila->>'fecha_valor' DESC, fila->>'capturada_en' DESC), '[]'::JSONB)
      INTO v_capturas
      FROM (
        SELECT jsonb_build_object(
                   'id',           t.id,
                   'fecha_valor',  t.fecha_valor,
                   'valor',        t.valor,
                   'fuente',       t.fuente,
                   'es_principal', t.es_principal,
                   'estado',       t.estado,
                   'motivo_estado',t.motivo_estado,
                   'capturada_en', t.capturada_en,
                   'aplicada_en',  t.aplicada_en,
                   -- true cuando la captura se aplicó ANTES de su fecha valor:
                   -- eso solo puede pasar por una decisión del admin.
                   'fue_adelanto', (t.aplicada_en IS NOT NULL
                                    AND t.aplicada_en::DATE < t.fecha_valor)
               ) AS fila
          FROM tasa_bcv t
         ORDER BY t.fecha_valor DESC, t.capturada_en DESC
         LIMIT 10
      ) s;

    RETURN jsonb_build_object(
        'hoy', CURRENT_DATE,

        'bcv', v_bcv,
        'proxima', v_proxima,

        'aplicada', jsonb_build_object(
            'tasa_cambio',         v_base,
            'tasa_efectiva',       v_cfg.tasa_efectiva,
            'aumento_acumulado',   v_cfg.aumento_acumulado,
            'ultima_actualizacion',v_cfg.ultima_actualizacion
        ),

        'diferencia', jsonb_build_object(
            'bolivares',          ROUND(COALESCE(v_dif_bs, 0)::NUMERIC, 4),
            'porcentaje',         COALESCE(v_dif_pct, 0),
            'signo',              COALESCE(v_signo, 'igual'),
            'es_igual',           v_es_igual,
            'umbral_porcentaje',  v_umbral,
            'requiere_revision',  COALESCE(ABS(v_dif_pct) >= v_umbral, false),
            -- Cuánto se está cobrando de menos (o de más) por cada 100 USD,
            -- que es la unidad en la que el dueño piensa sus platos.
            'por_100_usd',        ROUND(COALESCE(v_dif_bs, 0) * 100, 2)
        ),

        'capturas', v_capturas
    );
END;
$$;

COMMENT ON FUNCTION public.tasa_panel() IS
    'Cuadro completo de la tasa para el panel del admin: la del BCV con fecha valor y origen, la próxima capturada, la que el sistema cobra, la diferencia medida y las últimas 10 capturas.';

-- ============================================================
-- APLICAR LA TASA QUE ELIGIÓ EL ADMIN
-- ============================================================
--
-- Tres orígenes posibles:
--   'vigente' -> la que el BCV tiene publicada para hoy (o la última que rigió)
--   'proxima' -> la que el BCV ya publicó para una fecha futura (ADELANTO)
--   'manual'  -> un número que escribió el admin
--
-- Los tres escriben `config`. La diferencia es lo que queda registrado.
CREATE OR REPLACE FUNCTION public.aplicar_tasa_elegida(
    p_valor       NUMERIC,
    p_origen      TEXT,
    p_fecha_valor DATE    DEFAULT NULL,
    p_confirmar   BOOLEAN DEFAULT FALSE
)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $$
DECLARE
    v_base_anterior      NUMERIC;
    v_efectiva_anterior  NUMERIC;
    v_ratio              NUMERIC;
    v_efectiva_nueva     NUMERIC;
    v_estado             TEXT;
    v_motivo             TEXT;
    v_id                 BIGINT;
    v_adelanto           BOOLEAN := FALSE;
    v_salto              NUMERIC;
BEGIN
    -- Quién puede tocar la tasa: cajero o admin, igual que la policy de
    -- `config`. El mesonero no define la tasa, solo se identifica por PIN.
    PERFORM public.exigir_cajero_o_admin();

    IF p_valor IS NULL OR p_valor <= 0 THEN
        RETURN jsonb_build_object('success', false,
            'error', 'La tasa tiene que ser mayor que cero');
    END IF;

    IF p_origen IS NULL OR p_origen NOT IN ('vigente', 'proxima', 'manual') THEN
        RETURN jsonb_build_object('success', false,
            'error', 'Origen inválido: usá vigente, proxima o manual');
    END IF;

    SELECT tasa_cambio, tasa_efectiva
      INTO v_base_anterior, v_efectiva_anterior
      FROM config
     WHERE id = 1;

    -- ── Guarda contra el dedazo ──
    -- Un cero de más (8862 en vez de 886) o un decimal corrido se detecta acá,
    -- no cuando el cliente ve un plato a Bs 7.900.000.
    IF COALESCE(v_base_anterior, 0) > 0 THEN
        v_salto := ABS(p_valor - v_base_anterior) / v_base_anterior;
        IF v_salto > 0.5 AND NOT p_confirmar THEN
            RETURN jsonb_build_object(
                'success', false,
                'requiere_confirmacion', true,
                'error', 'La tasa cambia ' || ROUND(v_salto * 100, 1) ||
                         '% respecto de la actual (' || v_base_anterior ||
                         '). Confirmá que es intencional.',
                'tasa_anterior', v_base_anterior,
                'tasa_nueva', p_valor
            );
        END IF;
    END IF;

    -- ── El registro de la captura ──
    --
    -- Si la fecha valor es futura, esto es un adelanto: se marca 'aplicada'
    -- (porque se va a cobrar) pero con el motivo escrito, y además NO entra en
    -- `tasa_bcv_vigente_json()` porque esa filtra `fecha_valor <= CURRENT_DATE`.
    -- Es decir: el adelanto nunca se confunde con la referencia del BCV.
    IF p_fecha_valor IS NULL THEN
        p_fecha_valor := CURRENT_DATE;
    END IF;

    v_adelanto := p_fecha_valor > CURRENT_DATE;
    v_estado   := 'aplicada';
    v_motivo   := CASE
        WHEN v_adelanto THEN
            'Aplicada por decisión del admin antes de su fecha valor (origen: ' ||
            p_origen || ', fecha valor: ' || p_fecha_valor || ')'
        WHEN p_origen = 'manual' THEN
            'Cargada a mano por el admin'
        ELSE
            'Aplicada desde el panel (origen: ' || p_origen || ')'
    END;

    SELECT id INTO v_id
      FROM tasa_bcv
     WHERE fecha_valor = p_fecha_valor
       AND valor = p_valor
     LIMIT 1;

    IF v_id IS NULL THEN
        INSERT INTO tasa_bcv (fecha_valor, valor, fuente, es_principal, estado, motivo_estado, aplicada_en)
        VALUES (p_fecha_valor, p_valor,
                CASE WHEN p_origen = 'manual' THEN 'manual_admin' ELSE 'panel_admin' END,
                p_origen <> 'manual',
                v_estado, v_motivo, NOW())
        RETURNING id INTO v_id;
    ELSE
        UPDATE tasa_bcv
           SET estado        = v_estado,
               motivo_estado = v_motivo,
               aplicada_en   = COALESCE(aplicada_en, NOW())
         WHERE id = v_id;
    END IF;

    -- ── Escribir config ──
    --
    -- La EFECTIVA conserva el mismo factor que tenía respecto de la base.
    -- Esto es deliberado: acá ya hubo un bug que borraba meses de aumento
    -- acumulado al aplicar una tasa nueva. El aumento es una función pedida
    -- por el dueño y no se puede destruir con un clic.
    v_ratio := CASE WHEN COALESCE(v_base_anterior, 0) > 0
                     AND COALESCE(v_efectiva_anterior, 0) > 0
                    THEN v_efectiva_anterior / v_base_anterior
                    ELSE 1 END;

    v_efectiva_nueva := ROUND(p_valor * v_ratio, 2);

    UPDATE config
       SET tasa_cambio         = p_valor,
           tasa_efectiva       = v_efectiva_nueva,
           ultima_actualizacion = NOW()
     WHERE id = 1;

    RETURN jsonb_build_object(
        'success',          TRUE,
        'id',               v_id,
        'origen',           p_origen,
        'adelanto',         v_adelanto,
        'fecha_valor',      p_fecha_valor,
        'tasa_anterior',    v_base_anterior,
        'tasa_aplicada',    p_valor,
        'tasa_efectiva',    v_efectiva_nueva,
        'factor_conservado',ROUND(v_ratio, 6),
        'motivo',           v_motivo
    );
END;
$$;

COMMENT ON FUNCTION public.aplicar_tasa_elegida(NUMERIC, TEXT, DATE, BOOLEAN) IS
    'Aplica al sistema la tasa que eligió el admin, registrando de dónde salió y si fue un adelanto sobre la fecha valor del BCV. Único camino por el que una decisión humana sobre la tasa toca config.';

-- ============================================================
-- CUÁNTO SE COBRÓ CON CADA TASA
-- ============================================================
--
-- La prueba que el dueño pidió: "verificar que cambiar la tasa no altera lo ya
-- cobrado". `pedidos.tasa_aplicada` se congela al crear el pedido, así que la
-- respuesta ya está en los datos. Esta vista la vuelve legible.
CREATE OR REPLACE VIEW public.pedidos_tasa_historica AS
SELECT
    date_trunc('day', p.created_at)::DATE AS dia,
    p.tasa_aplicada,
    COUNT(*)                              AS pedidos,
    SUM(p.total)                          AS total_bs
  FROM pedidos p
 WHERE p.tasa_aplicada IS NOT NULL
 GROUP BY 1, 2
 ORDER BY 1 DESC, 2 DESC;

COMMENT ON VIEW public.pedidos_tasa_historica IS
    'Cuántos pedidos se cobraron con cada tasa, por día. Sirve para comprobar que aplicar una tasa nueva no mueve lo ya cobrado.';

-- ============================================================
-- Permisos
-- ============================================================
GRANT EXECUTE ON FUNCTION public.tasa_panel()                                    TO authenticated;
GRANT EXECUTE ON FUNCTION public.tasa_bcv_vigente_json()                         TO authenticated;
GRANT EXECUTE ON FUNCTION public.tasa_bcv_proxima_json()                         TO authenticated;
GRANT EXECUTE ON FUNCTION public.aplicar_tasa_elegida(NUMERIC, TEXT, DATE, BOOLEAN) TO authenticated;

-- La vista expone totales de venta: no es para el cliente anónimo.
REVOKE ALL ON public.pedidos_tasa_historica FROM PUBLIC, anon;
GRANT SELECT ON public.pedidos_tasa_historica TO authenticated;

-- La tabla de capturas ya es legible por anon (policy de la migración 22).
-- El panel en sí no: `tasa_panel()` expone la tasa que cobra el sistema.

NOTIFY pgrst, 'reload schema';

COMMIT;
