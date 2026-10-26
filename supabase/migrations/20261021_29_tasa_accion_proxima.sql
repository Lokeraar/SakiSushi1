-- 20261021_29_tasa_accion_proxima.sql
--
-- POR QUÉ EXISTE
--
-- La ventana del día ahora ofrece tres opciones, y la del medio es "establecer
-- la próxima conocida" (la publicada con fecha valor futura). Esa opción ya
-- funciona para aplicar el número: `aplicar_tasa_elegida` acepta
-- p_origen='proxima' desde la migración 23.
--
-- Lo que NO funcionaba era dejar constancia. `confirmar_revision_tasa` valida
-- la acción contra una lista cerrada:
--
--     IF p_accion IS NULL OR p_accion NOT IN
--        ('mantener','aplicar_bcv','aplicar_otra','sin_captura') THEN
--
-- 'aplicar_proxima' no estaba, así que la función devolvía success=false en
-- lugar de firmar. El JS lee esa respuesta y hace un console.warn, y sigue:
--
--   - la tasa SÍ se aplicaba (config cambiaba a 887.30),
--   - la firma del día NO se registraba (tasa_revision_diaria quedaba vacía),
--   - y la ventana se cerraba igual.
--
-- Resultado: el admin cree que firmó, el panel sigue pidiendo la tasa en cada
-- apertura, y el día queda sin registro. Detectado probando el botón en
-- Chrome real: aplicó 887.30 y la tabla quedó en 0 filas.
--
-- El cambio es mínimo a propósito: solo se agrega la acción a la lista y al
-- texto del error. Todo lo demás (exigir_cajero_o_admin, resolución del
-- nombre desde la metadata del JWT, el upsert por día) queda igual.

CREATE OR REPLACE FUNCTION public.confirmar_revision_tasa(p_accion text, p_nota text DEFAULT NULL::text)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $function$
DECLARE
    v_bcv    JSONB;
    v_base   NUMERIC;
    v_quien  TEXT;
BEGIN
    PERFORM public.exigir_cajero_o_admin();

    -- 'aplicar_proxima' se agrega acá. Elegir una publicación con fecha valor
    -- futura es una decisión registrable, no un caso aparte que pueda quedar
    -- sin firma.
    IF p_accion IS NULL OR p_accion NOT IN
        ('mantener','aplicar_bcv','aplicar_proxima','aplicar_otra','sin_captura') THEN
        RETURN jsonb_build_object('success', false,
            'error', 'Acción inválida: usá mantener, aplicar_bcv, aplicar_proxima, aplicar_otra o sin_captura');
    END IF;

    v_bcv  := public.tasa_bcv_vigente_json();
    SELECT tasa_cambio INTO v_base FROM config WHERE id = 1;

    -- Nombre: primero la metadata del JWT (siempre está), después la tabla.
    SELECT COALESCE(
        (SELECT NULLIF(a.raw_user_meta_data->>'nombre', '')
           FROM auth.users a WHERE a.id = auth.uid() LIMIT 1),
        (SELECT u.nombre FROM auth.users a
           JOIN usuarios u ON u.id::TEXT = a.raw_user_meta_data->>'custom_user_id'
          WHERE a.id = auth.uid() LIMIT 1)
    ) INTO v_quien;

    INSERT INTO tasa_revision_diaria
        (dia, revisada_por, accion, tasa_aplicada, tasa_bcv, fecha_valor_bcv, nota)
    VALUES (
        CURRENT_DATE,
        COALESCE(v_quien, 'usuario ' || COALESCE(public.rol_actual(), 'desconocido')),
        p_accion,
        v_base,
        (v_bcv->>'valor')::NUMERIC,
        (v_bcv->>'fecha_valor')::DATE,
        p_nota
    )
    ON CONFLICT (dia) DO UPDATE
        SET revisada_por    = EXCLUDED.revisada_por,
            accion          = EXCLUDED.accion,
            tasa_aplicada   = EXCLUDED.tasa_aplicada,
            tasa_bcv        = EXCLUDED.tasa_bcv,
            fecha_valor_bcv = EXCLUDED.fecha_valor_bcv,
            nota            = EXCLUDED.nota,
            revisada_en     = NOW();

    RETURN jsonb_build_object(
        'success', true,
        'dia', CURRENT_DATE,
        'accion', p_accion,
        'revisada_por', COALESCE(v_quien, 'desconocido'),
        'tasa_aplicada', v_base,
        'tasa_bcv', (v_bcv->>'valor')::NUMERIC
    );
END;
$function$;

COMMENT ON FUNCTION public.confirmar_revision_tasa(text, text) IS
    'Firma el día. Acciones: mantener, aplicar_bcv, aplicar_proxima, aplicar_otra, sin_captura.';
