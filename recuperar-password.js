// recuperar-password.js - VERSIÓN CORREGIDA
// Usa supabase-config.js y llama a la Edge Function para enviar emails

// Esperar a que supabase-config.js se cargue
async function esperarSupabase() {
    let intentos = 0;
    while (!window.supabaseClient && intentos < 50) {
        await new Promise(resolve => setTimeout(resolve, 100));
        intentos++;
    }
    if (!window.supabaseClient) {
        throw new Error('No se pudo cargar la configuración de Supabase');
    }
}

let supabase;

async function initSupabase() {
    try {
        await esperarSupabase();
        supabase = window.supabaseClient;
        console.log('✅ Supabase inicializado en recuperar-password.js');
    } catch (error) {
        console.error('❌ Error inicializando Supabase:', error);
        showError('Error de conexión. Recarga la página.');
    }
}

// --- ELEMENTOS DOM ---
const steps = {
    email: document.getElementById('step-email'),
    sent: document.getElementById('step-sent'),
    reset: document.getElementById('step-reset'),
    error: document.getElementById('step-error')
};

const forms = {
    email: document.getElementById('form-email'),
    reset: document.getElementById('form-reset')
};

const displays = {
    username: document.getElementById('display-username'),
    errorEmail: document.getElementById('error-email'),
    errorReset: document.getElementById('error-reset'),
    successReset: document.getElementById('success-reset'),
    errorMsgGeneral: document.getElementById('error-message-text')
};

const buttons = {
    send: document.getElementById('btn-send'),
    reset: document.getElementById('btn-reset')
};

const spinners = {
    send: document.getElementById('spinner-send'),
    reset: document.getElementById('spinner-reset')
};

// --- ESTADO INICIAL ---
let targetUsername = null;
let recoveryToken = null;

async function init() {
    // Inicializar Supabase primero
    await initSupabase();
    
    const params = new URLSearchParams(window.location.search);
    recoveryToken = params.get('token');
    let usernameParam = params.get('usuario');

    // Validación estricta del usuario
    if (!usernameParam || usernameParam.trim() === '' || usernameParam === 'null' || usernameParam === 'undefined') {
        console.error('❌ ERROR CRÍTICO: No se especificó ningún usuario en la URL.');
        console.log('URL actual:', window.location.href);
        console.log('Parámetro encontrado:', usernameParam);
        
        showError("Error: No se especificó ningún usuario válido.\n\nPor favor, inicia el proceso desde el login o asegúrate de que la URL termine en:\n.../recuperar-password.html?usuario=TU_USUARIO");
        return;
    }

    targetUsername = decodeURIComponent(usernameParam.trim());
    console.log('✅ Usuario detectado para recuperación:', targetUsername);

    // 1. Si NO hay token, mostramos formulario de email
    if (!recoveryToken) {
        displays.username.textContent = targetUsername;
        showStep('email');
    } 
    // 2. Si HAY token, validamos y mostramos formulario de nueva contraseña
    else {
        showStep('loading');
        await validateToken(recoveryToken);
    }
}

// --- FUNCIONES DE UTILIDAD ---
function showStep(stepName) {
    Object.values(steps).forEach(el => el.classList.add('hidden'));
    if (stepName !== 'loading' && steps[stepName]) {
        steps[stepName].classList.remove('hidden');
    }
}

function setLoading(isLoading, type) {
    const btn = type === 'send' ? buttons.send : buttons.reset;
    const spinner = type === 'send' ? spinners.send : spinners.reset;
    const textSpan = btn.querySelector('.btn-text');

    if (isLoading) {
        btn.disabled = true;
        textSpan.style.display = 'none';
        spinner.style.display = 'block';
    } else {
        btn.disabled = false;
        textSpan.style.display = 'block';
        spinner.style.display = 'none';
    }
}

function showError(msg, type = 'email') {
    if (type === 'general') {
        displays.errorMsgGeneral.textContent = msg;
        showStep('error');
    } else if (type === 'reset') {
        displays.errorReset.textContent = msg;
        setTimeout(() => displays.errorReset.textContent = '', 5000);
    } else {
        displays.errorEmail.textContent = msg;
        setTimeout(() => displays.errorEmail.textContent = '', 5000);
    }
}

// --- LÓGICA PRINCIPAL ---

// 1. Solicitar Token (Validar Email)
forms.email.addEventListener('submit', async (e) => {
    e.preventDefault();
    const emailInput = document.getElementById('email').value.trim();
    
    if (!emailInput) return showError("Ingresa un correo", 'email');
    
    setLoading(true, 'send');
    displays.errorEmail.textContent = '';

    try {
        // A. Verificar que el email coincide con el usuario seleccionado
        const { data: user, error: userError } = await supabase
            .from('usuarios')
            .select('id, email_recuperacion')
            .eq('username', targetUsername)
            .single();

        if (userError || !user) {
            throw new Error("Usuario no encontrado");
        }

        // B. Validar coincidencia de email (Case insensitive básico)
        if (user.email_recuperacion?.toLowerCase() !== emailInput.toLowerCase()) {
            throw new Error("El correo no coincide con el usuario seleccionado.");
        }

        // C. Generar token usando la función RPC
        const { data: tokenData, error: tokenError } = await supabase.rpc('generar_token_recuperacion', {
            p_usuario_id: user.id,
            p_email: emailInput,
            p_ip_origen: null,
            p_user_agent: navigator.userAgent
        });

        if (tokenError) throw tokenError;
        
        // Las funciones RPC que retornan TABLE devuelven un array
        const tokenResult = Array.isArray(tokenData) ? tokenData[0] : tokenData;
        
        if (!tokenResult || !tokenResult.success || !tokenResult.token) {
            throw new Error(tokenResult?.error || "Error al generar token");
        }

        const token = tokenResult.token;
        
        // D. Construir enlace de recuperación
        const baseUrl = window.location.origin + window.location.pathname.replace(/\/[^/]*$/, '/recuperar-password.html');
        const enlace = `${baseUrl}?token=${token}&usuario=${targetUsername}`;

        // E. Llamar a la Edge Function para enviar el email
        const anonKey = window.SUPABASE_ANON_KEY;
        
        if (!anonKey) {
            console.error('❌ ERROR: SUPABASE_ANON_KEY no está definida');
            throw new Error('Configuración de Supabase incompleta');
        }
        
        console.log('Enviando email a:', emailInput);
        console.log('Usando clave:', '***' + anonKey.slice(-10));
        
        const { data: edgeData, error: edgeError } = await supabase.functions.invoke('enviar-email-recuperacion', {
            body: {
                destinatario: emailInput,
                token: token,
                username: targetUsername,
                enlace: enlace
            },
            headers: {
                Authorization: `Bearer ${anonKey}`,
                'Content-Type': 'application/json'
            }
        });

        if (edgeError) {
            console.error('Error en Edge Function:', edgeError);
            // No lanzamos error aquí porque el token ya fue generado
            // El usuario puede intentar de nuevo o contactar soporte
        } else if (!edgeData?.success) {
            console.warn('Edge Function retornó éxito=false:', edgeData);
        }

        // F. Éxito - mostrar pantalla de enviado
        showStep('sent');

    } catch (err) {
        console.error(err);
        showError(err.message || "Error al procesar la solicitud", 'email');
    } finally {
        setLoading(false, 'send');
    }
});

// 2. Validar Token (Al cargar con ?token=XYZ)
async function validateToken(token) {
    try {
        // Llamada RPC para validar token y obtener info del usuario
        // Esta función debe devolver el usuario_id si es válido
        const { data, error } = await supabase.rpc('validar_token_recuperacion', {
            p_token: token
        });

        if (error) throw error;
        
        // Las funciones RPC que retornan TABLE devuelven un array
        const result = Array.isArray(data) ? data[0] : data;
        
        if (!result || !result.success) {
            throw new Error(result?.error || "Token inválido o expirado");
        }

        // Token válido, mostrar formulario de reset
        showStep('reset');

    } catch (err) {
        console.error(err);
        showError(err.message || "Enlace inválido", 'general');
    }
}

// 3. Resetear Contraseña
forms.reset.addEventListener('submit', async (e) => {
    e.preventDefault();
    const pass1 = document.getElementById('new-password').value;
    const pass2 = document.getElementById('confirm-password').value;

    if (pass1 !== pass2) return showError("Las contraseñas no coinciden", 'reset');
    if (pass1.length < 6) return showError("Mínimo 6 caracteres", 'reset');

    setLoading(true, 'reset');
    displays.errorReset.textContent = '';

    try {
        // Llamada RPC para actualizar contraseña usando la función correcta del SQL
        const { data, error } = await supabase.rpc('actualizar_contrasena_con_token', {
            p_token: recoveryToken,
            p_nueva_password: pass1
        });

        if (error) throw error;
        
        // Verificar si la función retornó éxito (las funciones RPC que retornan TABLE devuelven un array)
        const result = Array.isArray(data) ? data[0] : data;
        
        if (!result || !result.success) {
            throw new Error(result?.error || "Error al actualizar contraseña");
        }

        displays.successReset.textContent = "¡Contraseña actualizada! Redirigiendo...";
        
        setTimeout(() => {
            window.location.href = '../index.html'; // Redirigir al login
        }, 2000);

    } catch (err) {
        console.error(err);
        showError(err.message || "Error al actualizar contraseña", 'reset');
    } finally {
        setLoading(false, 'reset');
    }
});

// Iniciar app cuando el DOM esté listo
if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', init);
} else {
    init();
}
