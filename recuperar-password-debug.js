// ============================================
// INICIALIZACIÓN
// ============================================
document.addEventListener('DOMContentLoaded', () => {
    console.log('[DEBUG] DOMContentLoaded - Iniciando aplicación...');
    
    // Inicializar Supabase
    supabase = inicializarSupabase();
    console.log('[DEBUG] Supabase inicializado:', !!supabase);

    // Configurar formularios
    const emailForm = document.getElementById('emailForm');
    const passwordForm = document.getElementById('passwordForm');
    console.log('[DEBUG] emailForm:', !!emailForm);
    console.log('[DEBUG] passwordForm:', !!passwordForm);

    if (emailForm) {
        emailForm.addEventListener('submit', manejarEnvioEmail);
    }

    if (passwordForm) {
        passwordForm.addEventListener('submit', manejarNuevaContrasena);
    }

    // Determinar qué flujo iniciar
    console.log('[DEBUG] Llamando a iniciarFlujoConToken...');
    iniciarFlujoConToken();
});
