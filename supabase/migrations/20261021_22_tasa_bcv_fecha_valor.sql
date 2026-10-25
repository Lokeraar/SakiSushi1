-- ============================================================
-- 20261021_22_tasa_bcv_fecha_valor.sql
--
-- Captura automática de la tasa del BCV, con su FECHA VALOR.
--
-- EL PROBLEMA QUE RESUELVE
--
-- Las APIs de cotización devuelven un número, pero no todas dicen A QUÉ FECHA
-- corresponde. Medido con las publicaciones del BCV del 24 de octubre de 2026:
--
--   post nuevo   : 887,30200000  -> Fecha Valor MARTES 27
--   post anterior: 886,22710000  -> Fecha Valor VIERNES 23
--
-- Ese sábado 24, la tasa VIGENTE era la del viernes. Pero open.er-api.com ya
-- devolvía 887,302, que es la del martes: cobrar con ese número habría sido
-- adelantarse cinco días a una tasa que todavía no regía.
--
-- Conclusión: sin fecha valor no hay tasa confiable. Y una fecha valor futura
-- NUNCA se aplica, por más que la fuente la publique.
--
-- IDEMPOTENTE.
-- ============================================================

BEGIN;

-- ============================================================
-- Tabla de capturas
-- ============================================================
--
-- Cada captura queda guardada, aunque no se aplique. Así se puede reconstruir
-- qué pasó un día que la tasa salió mal.
CREATE TABLE IF NOT EXISTS tasa_bcv (
    id              BIGSERIAL PRIMARY KEY,
    -- La fecha a la que el BCV asigna la tasa. NO es la fecha de captura.
    fecha_valor     DATE        NOT NULL,
    valor           NUMERIC(14,4) NOT NULL,
    -- De dónde salió: 'dolarapi', 'er-api', 'currency-api'...
    fuente          TEXT        NOT NULL,
    -- true si es la fuente principal; false si fue un respaldo.
    es_principal    BOOLEAN     NOT NULL DEFAULT TRUE,
    -- 'aplicada'    -> ya rige y se está usando
    -- 'pendiente'   -> fecha valor futura, guardada pero sin usar
    -- 'descartada'  -> no se aplicó por alguna razón
    estado          TEXT        NOT NULL DEFAULT 'pendiente',
    motivo_estado   TEXT,
    capturada_en    TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    aplicada_en     TIMESTAMPTZ,
    CONSTRAINT tasa_bcv_estado_valido
        CHECK (estado IN ('aplicada','pendiente','descartada')),
    CONSTRAINT tasa_bcv_valor_positivo
        CHECK (valor > 0)
);

CREATE INDEX IF NOT EXISTS idx_tasa_bcv_fecha  ON tasa_bcv(fecha_valor DESC);
CREATE INDEX IF NOT EXISTS idx_tasa_bcv_estado ON tasa_bcv(estado, fecha_valor DESC);

COMMENT ON TABLE tasa_bcv IS
    'Capturas de la tasa BCV. Guarda la FECHA VALOR, no la fecha de captura. Una fecha valor futura queda pendiente y nunca se aplica.';

-- ============================================================
-- Registrar una captura
-- ============================================================
--
-- Regla central: si la fecha valor es futura, se guarda como 'pendiente'.
-- Si es de hoy o anterior, se puede aplicar.
CREATE OR REPLACE FUNCTION public.registrar_tasa_bcv(
    p_valor        NUMERIC,
    p_fecha_valor  DATE,
    p_fuente       TEXT,
    p_es_principal BOOLEAN DEFAULT TRUE
)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $$
DECLARE
    v_id         BIGINT;
    v_estado     TEXT;
    v_es_futura  BOOLEAN;
    v_motivo     TEXT;
BEGIN
    IF p_valor IS NULL OR p_valor <= 0 THEN
        RETURN jsonb_build_object('success', false, 'error', 'La tasa tiene que ser mayor que cero');
    END IF;

    IF p_fecha_valor IS NULL THEN
        RETURN jsonb_build_object('success', false, 'error', 'Falta la fecha valor de la tasa');
    END IF;

    v_es_futura := p_fecha_valor > CURRENT_DATE;

    IF v_es_futura THEN
        v_estado := 'pendiente';
        v_motivo := 'Fecha valor futura: se guarda pero no se aplica hasta que llegue el día';
    ELSE
        v_estado := 'aplicada';
        v_motivo := NULL;
    END IF;

    -- Si ya hay una captura con la misma fecha valor y valor, no se duplica.
    SELECT id INTO v_id
      FROM tasa_bcv
     WHERE fecha_valor = p_fecha_valor
       AND valor = p_valor
     LIMIT 1;

    IF v_id IS NULL THEN
        INSERT INTO tasa_bcv (fecha_valor, valor, fuente, es_principal, estado, motivo_estado, aplicada_en)
        VALUES (p_fecha_valor, p_valor, p_fuente, p_es_principal, v_estado, v_motivo,
                CASE WHEN v_estado = 'aplicada' THEN NOW() ELSE NULL END)
        RETURNING id INTO v_id;
    END IF;

    RETURN jsonb_build_object(
        'success', TRUE,
        'id', v_id,
        'valor', p_valor,
        'fecha_valor', p_fecha_valor,
        'estado', v_estado,
        'es_futura', v_es_futura,
        'fuente', p_fuente,
        'es_principal', p_es_principal
    );
END;
$$;

-- ============================================================
-- Qué tasa rige HOY
-- ============================================================
--
-- Es la más reciente cuya fecha valor NO sea futura. Si mañana es martes y
-- sólo tenemos la del viernes, rige la del viernes: correcto.
CREATE OR REPLACE FUNCTION public.tasa_vigente()
RETURNS TABLE (valor NUMERIC, fecha_valor DATE, fuente TEXT, es_principal BOOLEAN, capturada_en TIMESTAMPTZ)
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path TO 'public'
AS $$
    SELECT t.valor, t.fecha_valor, t.fuente, t.es_principal, t.capturada_en
      FROM tasa_bcv t
     WHERE t.fecha_valor <= CURRENT_DATE
       AND t.estado = 'aplicada'
     ORDER BY t.fecha_valor DESC, t.capturada_en DESC
     LIMIT 1;
$$;

-- ============================================================
-- Aplicar las pendientes que ya llegaron a su día
-- ============================================================
--
-- Esto lo llama el cron de las 7 am. Si ayer a las 5 pm se capturó la tasa del
-- martes, hoy martes a las 7 am pasa de 'pendiente' a 'aplicada'.
CREATE OR REPLACE FUNCTION public.aplicar_tasas_vencidas()
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $$
DECLARE
    v_cuantas INTEGER;
    v_tasa    RECORD;
BEGIN
    UPDATE tasa_bcv
       SET estado = 'aplicada',
           aplicada_en = NOW(),
           motivo_estado = NULL
     WHERE estado = 'pendiente'
       AND fecha_valor <= CURRENT_DATE;

    GET DIAGNOSTICS v_cuantas = ROW_COUNT;

    SELECT * INTO v_tasa FROM public.tasa_vigente();

    RETURN jsonb_build_object(
        'success', TRUE,
        'aplicadas', v_cuantas,
        'vigente', CASE WHEN v_tasa IS NULL THEN NULL
                        ELSE jsonb_build_object(
                            'valor', v_tasa.valor,
                            'fecha_valor', v_tasa.fecha_valor,
                            'fuente', v_tasa.fuente) END
    );
END;
$$;

-- ============================================================
-- La captura desde internet
-- ============================================================
--
-- Usa pg_net, que hace la petición HTTP de forma asíncrona: dispara y sigue.
-- Por eso la respuesta se lee después, desde net._http_response.
--
-- Cadena de fuentes:
--   1. ve.dolarapi.com   principal. Informa fechaActualizacion, que sirve de
--                        fecha valor.
--   2. open.er-api.com   respaldo. OJO: devuelve la tasa del día siguiente sin
--                        avisar de qué fecha es. Se usa sólo si la fecha que
--                        informa no es futura.
--   3. currency-api      último recurso. Tampoco informa fecha valor clara: se
--                        guarda como pendiente para que un humano la confirme.
CREATE OR REPLACE FUNCTION public.solicitar_captura_tasa()
RETURNS BIGINT
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public', 'net'
AS $$
DECLARE
    v_req BIGINT;
BEGIN
    SELECT net.http_get(
        url := 'https://ve.dolarapi.com/v1/dolares/oficial',
        timeout_milliseconds := 15000
    ) INTO v_req;
    RETURN v_req;
END;
$$;

-- Procesa la respuesta de dolarapi (la principal).
-- Se llama desde el cron unos minutos después de solicitar_captura_tasa().
CREATE OR REPLACE FUNCTION public.procesar_respuesta_tasa()
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $$
DECLARE
    v_body     TEXT;
    v_json     JSONB;
    v_valor    NUMERIC;
    v_fecha    DATE;
    v_res      JSONB;
BEGIN
    -- La respuesta más reciente de dolarapi.
    SELECT content INTO v_body
      FROM net._http_response
     WHERE url LIKE '%dolarapi.com%'
     ORDER BY created DESC
     LIMIT 1;

    IF v_body IS NULL THEN
        RETURN jsonb_build_object('success', false, 'error', 'Sin respuesta de la fuente todavía');
    END IF;

    BEGIN
        v_json := v_body::JSONB;
    EXCEPTION WHEN OTHERS THEN
        RETURN jsonb_build_object('success', false, 'error', 'La respuesta no es JSON válido');
    END;

    v_valor := (v_json->>'promedio')::NUMERIC;
    -- `fechaActualizacion` es lo más parecido a la fecha valor que informa
    -- esta fuente: "2026-10-23T00:00:00-04:00" -> 2026-10-23
    v_fecha := (v_json->>'fechaActualizacion')::TIMESTAMPTZ::DATE;

    IF v_valor IS NULL OR v_fecha IS NULL THEN
        RETURN jsonb_build_object('success', false, 'error', 'Faltan datos en la respuesta',
                                  'cuerpo', left(v_json::TEXT, 300));
    END IF;

    v_res := public.registrar_tasa_bcv(v_valor, v_fecha, 'dolarapi', TRUE);
    RETURN v_res;
END;
$$;

-- ============================================================
-- Consulta del estado, para el panel y para el cliente
-- ============================================================

CREATE OR REPLACE FUNCTION public.estado_tasa_bcv()
RETURNS JSONB
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path TO 'public'
AS $$
DECLARE
    v_vigente   RECORD;
    v_pendiente RECORD;
BEGIN
    SELECT * INTO v_vigente FROM public.tasa_vigente();

    SELECT valor, fecha_valor, fuente, capturada_en INTO v_pendiente
      FROM tasa_bcv
     WHERE estado = 'pendiente'
     ORDER BY fecha_valor DESC
     LIMIT 1;

    RETURN jsonb_build_object(
        'vigente', CASE WHEN v_vigente IS NULL THEN NULL ELSE jsonb_build_object(
            'valor', v_vigente.valor,
            'fecha_valor', v_vigente.fecha_valor,
            'fuente', v_vigente.fuente,
            'es_principal', v_vigente.es_principal,
            'capturada_en', v_vigente.capturada_en) END,
        'pendiente', CASE WHEN v_pendiente IS NULL THEN NULL ELSE jsonb_build_object(
            'valor', v_pendiente.valor,
            'fecha_valor', v_pendiente.fecha_valor,
            'fuente', v_pendiente.fuente) END
    );
END;
$$;

-- ============================================================
-- Sembrar la tasa que ya conocemos
-- ============================================================
--
-- La base ya tiene 886,23, que corresponde a la fecha valor del viernes
-- 23 de octubre de 2026 (publicación del BCV). Se registra para que
-- `tasa_vigente()` tenga de dónde partir.
INSERT INTO tasa_bcv (fecha_valor, valor, fuente, es_principal, estado, motivo_estado, aplicada_en)
SELECT DATE '2026-10-23', 886.2271, 'carga_inicial', TRUE, 'aplicada',
       'Cargada a mano desde la publicación del BCV', NOW()
WHERE NOT EXISTS (
    SELECT 1 FROM tasa_bcv WHERE fecha_valor = DATE '2026-10-23' AND valor = 886.2271
);

-- ============================================================
-- Permisos
-- ============================================================
GRANT EXECUTE ON FUNCTION public.tasa_vigente()                  TO anon, authenticated;
GRANT EXECUTE ON FUNCTION public.estado_tasa_bcv()               TO anon, authenticated;
GRANT EXECUTE ON FUNCTION public.registrar_tasa_bcv(NUMERIC, DATE, TEXT, BOOLEAN) TO authenticated;
GRANT EXECUTE ON FUNCTION public.aplicar_tasas_vencidas()        TO authenticated;
-- Las de red quedan internas: las dispara el cron, no un navegador.
REVOKE ALL ON FUNCTION public.solicitar_captura_tasa()  FROM PUBLIC;
REVOKE ALL ON FUNCTION public.procesar_respuesta_tasa() FROM PUBLIC;

ALTER TABLE tasa_bcv ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS tasa_bcv_lectura ON tasa_bcv;
CREATE POLICY tasa_bcv_lectura ON tasa_bcv FOR SELECT TO anon, authenticated USING (true);
DROP POLICY IF EXISTS tasa_bcv_escritura_admin ON tasa_bcv;
CREATE POLICY tasa_bcv_escritura_admin ON tasa_bcv FOR ALL TO authenticated
    USING (COALESCE(public.es_admin(), false))
    WITH CHECK (COALESCE(public.es_admin(), false));

NOTIFY pgrst, 'reload schema';

COMMIT;

-- ============================================================
-- Corrección posterior a la primera prueba (se deja en la misma migración
-- para que quien la lea entienda el porqué del cambio)
-- ============================================================
--
-- `net._http_response` NO tiene columna `url`. Guarda la respuesta por `id`,
-- que es el mismo id que devuelve `net.http_get()`. La primera versión de
-- `procesar_respuesta_tasa()` filtraba por url y fallaba con
-- "column url does not exist".
--
-- Ahora recibe el id de la petición.
BEGIN;

CREATE OR REPLACE FUNCTION public.procesar_respuesta_tasa(p_req_id BIGINT DEFAULT NULL)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $$
DECLARE
    v_body  TEXT;
    v_err   TEXT;
    v_json  JSONB;
    v_valor NUMERIC;
    v_fecha DATE;
BEGIN
    SELECT content, error_msg INTO v_body, v_err
      FROM net._http_response
     WHERE (p_req_id IS NULL OR id = p_req_id)
     ORDER BY created DESC
     LIMIT 1;

    IF v_err IS NOT NULL THEN
        RETURN jsonb_build_object('success', false, 'error', 'La petición falló: ' || v_err);
    END IF;
    IF v_body IS NULL THEN
        RETURN jsonb_build_object('success', false, 'error', 'Sin respuesta de la fuente todavía');
    END IF;

    BEGIN v_json := v_body::JSONB;
    EXCEPTION WHEN OTHERS THEN
        RETURN jsonb_build_object('success', false, 'error', 'La respuesta no es JSON válido');
    END;

    v_valor := (v_json->>'promedio')::NUMERIC;
    v_fecha := (v_json->>'fechaActualizacion')::TIMESTAMPTZ::DATE;

    IF v_valor IS NULL OR v_fecha IS NULL THEN
        RETURN jsonb_build_object('success', false, 'error', 'Faltan datos en la respuesta');
    END IF;

    RETURN public.registrar_tasa_bcv(v_valor, v_fecha, 'dolarapi', TRUE);
END;
$$;

REVOKE ALL ON FUNCTION public.procesar_respuesta_tasa(BIGINT) FROM PUBLIC;
DROP FUNCTION IF EXISTS public.procesar_respuesta_tasa();

-- Horarios del cron (UTC; Venezuela es UTC-4).
--   21:00 UTC = 5 pm  -> capturar la tasa que regirá el día siguiente
--   11:00 UTC = 7 am  -> aplicar las capturas que ya llegaron a su fecha valor
-- La captura corre de lunes a viernes: el BCV publica en días hábiles.
SELECT cron.unschedule(jobid) FROM cron.job
 WHERE jobname IN ('tasa-bcv-capturar','tasa-bcv-aplicar');

SELECT cron.schedule('tasa-bcv-capturar', '0 21 * * 1-5', $$
    SELECT public.solicitar_captura_tasa();
$$);

SELECT cron.schedule('tasa-bcv-aplicar', '0 11 * * *', $$
    SELECT public.aplicar_tasas_vencidas();
$$);

COMMIT;
