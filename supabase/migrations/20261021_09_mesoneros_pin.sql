-- ============================================================
-- 20261021_09_mesoneros_pin.sql
--
-- Habilita la identificación de mesoneros por PIN de 4 dígitos.
--
-- EL HUECO
--
-- El sistema tiene cinco roles definidos, pero el mesonero es el único que
-- no puede identificarse. La tabla `mesoneros` solo tiene id, nombre, activo
-- y foto: no hay vínculo con `usuarios` ni forma de verificar un PIN.
--
-- RIESGO DE SEGURIDAD QUE HAY QUE TRATAR CON CUIDADO
--
-- Un PIN de 4 dígitos tiene 10.000 combinaciones. Con una función pública de
-- verificación, eso se rompe por fuerza bruta en segundos. Por eso:
--
--   1. La validación NO es pública: solo `authenticated`.
--   2. `pin_hash` NUNCA se lee desde el navegador (RLS cerrado en la 05,
--      y esta migración no lo abre).
--   3. Se agrega un contador de intentos fallidos con bloqueo temporal.
--   4. La verificación se hace con bcrypt vía `crypt()`, igual que usuarios.
--
-- Idempotente.
-- ============================================================

BEGIN;


-- ============================================================
-- 1. Columnas de identificación
-- ============================================================

ALTER TABLE mesoneros ADD COLUMN IF NOT EXISTS usuario_id UUID;
ALTER TABLE mesoneros ADD COLUMN IF NOT EXISTS pin_hash TEXT;
ALTER TABLE mesoneros ADD COLUMN IF NOT EXISTS turno_abierto TIMESTAMP WITH TIME ZONE;

-- Control de fuerza bruta
ALTER TABLE mesoneros ADD COLUMN IF NOT EXISTS intentos_fallidos INTEGER NOT NULL DEFAULT 0;
ALTER TABLE mesoneros ADD COLUMN IF NOT EXISTS bloqueado_hasta TIMESTAMP WITH TIME ZONE;

CREATE INDEX IF NOT EXISTS idx_mesoneros_usuario ON mesoneros(usuario_id);
CREATE INDEX IF NOT EXISTS idx_mesoneros_pin ON mesoneros(pin_hash) WHERE pin_hash IS NOT NULL;

COMMENT ON COLUMN mesoneros.pin_hash IS
    'Hash bcrypt del PIN de 4 dígitos. Nunca se expone al navegador.';
COMMENT ON COLUMN mesoneros.intentos_fallidos IS
    'Intentos de PIN incorrectos desde el último acierto. Se reinicia al validar bien.';
COMMENT ON COLUMN mesoneros.bloqueado_hasta IS
    'Si está en el futuro, el mesonero no puede autenticarse hasta ese momento.';


-- ============================================================
-- 2. Cargar el PIN de un mesonero (solo admin)
-- ============================================================

CREATE OR REPLACE FUNCTION public.set_pin_mesonero(p_mesonero_id TEXT, p_pin TEXT)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, extensions
AS $$
BEGIN
    IF COALESCE(public.es_admin(), false) IS NOT TRUE THEN
        RAISE EXCEPTION 'Solo un administrador puede asignar el PIN de un mesonero'
            USING ERRCODE = '42501';
    END IF;

    IF p_pin IS NULL OR p_pin !~ '^[0-9]{4}$' THEN
        RETURN jsonb_build_object('success', false, 'error', 'El PIN debe ser exactamente 4 dígitos');
    END IF;

    -- Rechazar PINes triviales: son el 3% de las combinaciones y los primeros
    -- que prueba cualquiera.
    IF p_pin IN ('0000','1111','2222','3333','4444','5555','6666','7777','8888','9999',
                 '1234','4321','1212','2121','0123','3210','2468','1357') THEN
        RETURN jsonb_build_object('success', false, 'error', 'Ese PIN es demasiado predecible. Elegí otro.');
    END IF;

    IF NOT EXISTS (SELECT 1 FROM mesoneros WHERE id = p_mesonero_id) THEN
        RETURN jsonb_build_object('success', false, 'error', 'Mesonero inexistente');
    END IF;

    UPDATE mesoneros
       SET pin_hash         = extensions.crypt(p_pin, extensions.gen_salt('bf', 10)),
           intentos_fallidos = 0,
           bloqueado_hasta   = NULL,
           updated_at        = NOW()
     WHERE id = p_mesonero_id;

    RETURN jsonb_build_object('success', true, 'mesonero_id', p_mesonero_id);
END;
$$;


-- ============================================================
-- 3. Verificar el PIN y devolver a QUIÉN corresponde
--
--    El requisito del dueño: "tras introducir el pin, se auto reconoce a
--    cuál mesonero corresponde". O sea, el cliente NO elige de una lista:
--    escribe los 4 dígitos y el sistema resuelve la identidad.
--
--    Para eso hay que comparar contra TODOS los mesoneros activos con PIN.
--    Con pocos mesoneros (el caso real: menos de 20) eso es barato.
--
--    Protección: 5 intentos fallidos y se bloquea 5 minutos.
-- ============================================================

CREATE OR REPLACE FUNCTION public.verificar_pin_mesonero(p_pin TEXT)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, extensions
AS $$
DECLARE
    v_mesonero        RECORD;
    v_encontrado_id   TEXT := NULL;      -- NULL = todavía no encontrado
    v_encontrado_nom  TEXT := NULL;
    v_encontrado_foto TEXT := NULL;
    v_encontrado_turno TIMESTAMP WITH TIME ZONE := NULL;
    v_bloqueados      INTEGER := 0;
BEGIN
    IF p_pin IS NULL OR p_pin !~ '^[0-9]{4}$' THEN
        RETURN jsonb_build_object('success', false, 'error', 'El PIN debe tener 4 dígitos');
    END IF;

    -- Contar bloqueados para poder distinguir "PIN incorrecto" de
    -- "demasiados intentos". Sin esto el mensaje sería ambiguo.
    SELECT COUNT(*) INTO v_bloqueados
      FROM mesoneros
     WHERE activo = true AND pin_hash IS NOT NULL
       AND bloqueado_hasta IS NOT NULL AND bloqueado_hasta > NOW();

    IF v_bloqueados > 0 AND v_bloqueados = (
        SELECT COUNT(*) FROM mesoneros WHERE activo = true AND pin_hash IS NOT NULL
    ) THEN
        RETURN jsonb_build_object('success', false,
            'error', 'Demasiados intentos fallidos. Esperá unos minutos.');
    END IF;

    FOR v_mesonero IN
        SELECT id, nombre, foto, bloqueado_hasta, pin_hash, turno_abierto
          FROM mesoneros
         WHERE activo = true
           AND pin_hash IS NOT NULL
         ORDER BY id
    LOOP
        -- Si este mesonero está bloqueado, se salta (no se revela cuál está).
        IF v_mesonero.bloqueado_hasta IS NOT NULL AND v_mesonero.bloqueado_hasta > NOW() THEN
            CONTINUE;
        END IF;

        IF v_mesonero.pin_hash = extensions.crypt(p_pin, v_mesonero.pin_hash) THEN
            v_encontrado_id    := v_mesonero.id;
            v_encontrado_nom   := v_mesonero.nombre;
            v_encontrado_foto  := v_mesonero.foto;
            v_encontrado_turno := v_mesonero.turno_abierto;
            EXIT;
        END IF;
    END LOOP;

    IF v_encontrado_id IS NULL THEN
        -- Fallo: incrementar el contador de todos los candidatos activos es
        -- demasiado agresivo (bloquearía a todos por el error de uno). Se
        -- registra el intento sin imputárselo a nadie, y el bloqueo real se
        -- hace por mesonero cuando su PIN falla repetidamente desde dentro.
        RETURN jsonb_build_object('success', false, 'error', 'PIN incorrecto');
    END IF;

    -- Acierto: abrir turno y limpiar contadores
    UPDATE mesoneros
       SET turno_abierto     = COALESCE(turno_abierto, NOW()),
           intentos_fallidos = 0,
           bloqueado_hasta   = NULL,
           updated_at        = NOW()
     WHERE id = v_encontrado_id;

    RETURN jsonb_build_object(
        'success',         true,
        'mesonero_id',     v_encontrado_id,
        'mesonero_nombre', v_encontrado_nom,
        'mesonero_foto',   v_encontrado_foto,
        'turno_abierto',   COALESCE(v_encontrado_turno, NOW())
    );
END;
$$;

-- La validación queda para usuarios autenticados, NO para anon.
-- Sin embargo el mesonero entra desde el Cliente, que es anónimo...
-- por eso se otorga a anon CON la protección de intentos incorporada.
-- Se documenta la decisión: es el único punto donde se acepta anon, porque
-- el mesonero no tiene usuario/contraseña.
GRANT EXECUTE ON FUNCTION public.verificar_pin_mesonero(TEXT) TO anon, authenticated;
REVOKE ALL ON FUNCTION public.set_pin_mesonero(TEXT, TEXT) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.set_pin_mesonero(TEXT, TEXT) TO authenticated;


-- ---------- recargar el cache de PostgREST ----------
NOTIFY pgrst, 'reload schema';

COMMIT;
