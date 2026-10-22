// cliente-init.js - Inicialización, ciclo de vida y cleanup
(function() {
    window.Saki = window.Saki || {};
    window.Saki.modules = window.Saki.modules || {};
    window.Saki.modules.init = {};
    var S = window.Saki;

    // ==================== INIT (DOMContentLoaded) ====================

    function inicializarCliente() {
        // 0. Extraer parámetros de la URL (mesa, etc.)
        var urlParams = new URLSearchParams(window.location.search);
        if (urlParams.get('mesa')) S.state.mesaId = urlParams.get('mesa');

        // 0b. Inicializar carrito vacío (restaurarCarrito lo sobreescribe si hay datos)
        S.state.carrito = [];

        // 0c. Cachear referencias DOM (menuGrid, categoryList, etc.)
        if (window.cacheDomElements) window.cacheDomElements();

        // 1. Tema
        if (window.cargarTemaGuardado) window.cargarTemaGuardado();

        // 2. Carrito desde localStorage
        var hayCarrito = false;
        if (window.restaurarCarrito) hayCarrito = window.restaurarCarrito();

        // 3. Configuración global
        if (window.cargarConfiguracion) window.cargarConfiguracion();

        // 4. Cargar menú e inventario en paralelo
        Promise.all([
            cargarMenuSiPosible(),
            cargarInventarioSiPosible()
        ]).then(function() {
            if (window.precalcularStockMenu) window.precalcularStockMenu();
            if (window.renderizarMenuPaginado) window.renderizarMenuPaginado(null, null, '');
            if (window.actualizarCarritoUI) window.actualizarCarritoUI();
        });

        // 5. Categorías
        if (window.cargarCategorias) window.cargarCategorias();

        // 6. Formularios
        if (window.restaurarDatosFormulario) window.restaurarDatosFormulario();

        // 7. Notificaciones
        if (window.recargarNotificacionesCompletas) window.recargarNotificacionesCompletas();

        // 8. Event listeners
        if (window.setupEventListeners) window.setupEventListeners();

        // 9. Push notifications
        if (window.solicitarPermisoPushAuto) window.solicitarPermisoPushAuto();

        // 10. Realtime
        if (window.iniciarVerificacionPeriodica) window.iniciarVerificacionPeriodica();

        // 11. Historial
        if (window.actualizarBotonHistorial) window.actualizarBotonHistorial();

        // 12. Audio
        if (window.verificarPermisosAudio) window.verificarPermisosAudio();

        // 13. Diálogo continuar carrito
        if (hayCarrito && window.mostrarDialogoContinuar) window.mostrarDialogoContinuar();

        // 14. Reset categorías
        if (window.resetToAllCategories) window.resetToAllCategories(false);

        // 15. WiFi auto-detection (de cliente-voz.js? No, está en el HTML head)
        // Se ejecuta inline en el HTML, no necesita JS aquí

        // Mark as ready
        window._sakiReady = true;
    }

    function cargarMenuSiPosible() {
        if (!window.supabaseClient) return Promise.resolve();
        return window.supabaseClient
            .from('menu')
            .select('*')
            .then(function(resp) {
                if (resp.error) throw resp.error;
                S.state.menuItems = resp.data || [];
                // Preload images into cache
                if (window._precargarImagenes) window._precargarImagenes(S.state.menuItems);
            })
            .catch(function(err) {
                console.warn('Error cargando menú:', err);
                S.state.menuItems = [];
            });
    }

    function cargarInventarioSiPosible() {
        if (!window.supabaseClient) return Promise.resolve();
        return window.supabaseClient
            .from('inventario')
            .select('*')
            .then(function(resp) {
                if (resp.error) throw resp.error;
                S.state.inventario = resp.data || [];
            })
            .catch(function(err) {
                console.warn('Error cargando inventario:', err);
                S.state.inventario = [];
            });
    }

    // ==================== BEFOREUNLOAD (cleanup) ====================

    function cleanupOnBeforeunload() {
        // Timers de delivery/reserva
        if (S.modules.delivery && S.modules.delivery.detenerTodosLosTimers) {
            S.modules.delivery.detenerTodosLosTimers();
        }

        // Scroll tracking
        if (window.detenerSeguimientoScroll) window.detenerSeguimientoScroll();

        // Timeouts
        if (S.state.scrollTimeout) {
            clearTimeout(S.state.scrollTimeout);
            S.state.scrollTimeout = null;
        }

        // Speech recognition
        if (window.reconocimientoVoz) {
            try { window.reconocimientoVoz.abort(); } catch(e) {}
            window.reconocimientoVoz = null;
        }

        // NO cerramos Realtime channel (notificaciones deben seguir)
        // NO cerramos Service Worker (push debe seguir)
    }

    // ==================== VISIBILITY CHANGE ====================

    function onVisibilityChange() {
        S.state.paginaVisible = !document.hidden;

        if (document.hidden) {
            // Solo pausar scroll tracking y animaciones
            if (window.detenerSeguimientoScroll) window.detenerSeguimientoScroll();
        } else {
            // Recargar notificaciones al volver
            if (window.recargarNotificacionesCompletas) window.recargarNotificacionesCompletas();

            // Reanudar scroll si el carrito está abierto
            if (S.state.carrito && S.state.carrito.length > 0) {
                var cartSidebar = document.getElementById('cartSidebar');
                if (cartSidebar && cartSidebar.classList.contains('open')) {
                    if (window.iniciarSeguimientoScroll) window.iniciarSeguimientoScroll();
                }
            }
        }
    }

    // ==================== REGISTER LIFECYCLE ====================

    S.modules.init.inicializarCliente = inicializarCliente;
    S.modules.init.cleanupOnBeforeunload = cleanupOnBeforeunload;
    S.modules.init.onVisibilityChange = onVisibilityChange;

    // ==================== HOOK INTO PAGE EVENTS ==================== 

    if (document.readyState === 'loading') {
        document.addEventListener('DOMContentLoaded', inicializarCliente);
    } else {
        // DOM already loaded
        inicializarCliente();
    }

    // beforeunload — cleanup (NOT realtime, NOT service worker)
    window.addEventListener('beforeunload', cleanupOnBeforeunload);

    // visibilitychange — smart pause/resume
    window.addEventListener('visibilitychange', onVisibilityChange);

    // Expose init function for external calls
    window.inicializarCliente = inicializarCliente;
})();
