// cliente-init.js - Inicialización, ciclo de vida y cleanup
(function() {
    window.Saki = window.Saki || {};
    window.Saki.modules = window.Saki.modules || {};
    window.Saki.modules.init = {};
    var S = window.Saki;

    // ==================== INIT (DOMContentLoaded) ====================

    async function inicializarCliente() {
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

        // 2b. Fase 1: ¿venció el carrito mientras la pestaña estaba cerrada?
        // El plazo son 20 minutos reiniciables desde la última acción. Si venció,
        // se vacía acá y se avisa, sin esperar a que corra el intervalo.
        // Si sigue vigente, esto arranca la vigilancia y el aviso en pantalla.
        if (window.revisarCarritoAlCargar) {
            window.revisarCarritoAlCargar();
        }

        // 2c. Preguntar si quiere continuar con el pedido anterior.
        // El contador ya decidió si sigue vigente; esto solo pide permiso.
        // Si venció, revisarCarritoAlCargar() ya lo vació y no se pregunta.
        if (window.mostrarDialogoSiCorresponde) {
            setTimeout(function () { window.mostrarDialogoSiCorresponde(); }, 600);
        }

        // 3. Configuración global — CON await, a propósito.
        // Antes se llamaba sin esperar, así que el render corría antes de que
        // llegara la tasa y pintaba los precios con el valor por defecto.
        // Como ahora la config incluye la consulta al BCV, esperar es
        // obligatorio: sin esto los precios salen con la tasa vieja.
        if (window.cargarConfiguracion) {
            await window.cargarConfiguracion();
        }

        // 4. Cargar menú e inventario en paralelo
        Promise.all([
            cargarMenuSiPosible(),
            cargarInventarioSiPosible(),
            cargarSeccionesSiPosible()
        ]).then(function() {
            if (window.precalcularStockMenu) window.precalcularStockMenu();
            if (window.renderizarMenuPaginado) window.renderizarMenuPaginado(null, null, '');
            // Capa de disponibilidad: aplica la regla principal/secundario
            // SOBRE el render ya hecho. No reemplaza el cálculo de
            // cliente-stock.js, que sigue aportando el número.
            if (window.actualizarDisponibilidadMenu) window.actualizarDisponibilidadMenu();
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

        // 11b. Reservas vencidas
        // Si el cliente cerró la pestaña con un pedido pendiente y vuelve
        // después del plazo, hay que avisarle. El barrido de pg_cron ya
        // liberó el stock; esto limpia el rastro local y avisa.
        if (window.revisarPedidoPendienteAlCargar) {
            window.revisarPedidoPendienteAlCargar().then(function(r) {
                if (r && r.enPlazo === false) {
                    if (window.mostrarToastNotificacion) {
                        window.mostrarToastNotificacion('⏰ Tu pedido anterior venció sin pago y fue cancelado. El stock volvió al inventario.', 'warning');
                    }
                }
            }).catch(function(e) {
                console.warn('No se pudo revisar el pedido pendiente:', e.message);
            });
        }

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
        // Sin cliente de Supabase no hay datos posibles. Antes se salía en
        // silencio y la carta quedaba vacía aunque hubiera una copia local
        // disponible: por eso sin internet no aparecía NADA.
        if (!window.supabaseClient) {
            if (window.usarDatosDeEjemplo) {
                return window.usarDatosDeEjemplo('no hay cliente de Supabase');
            }
            return Promise.resolve();
        }
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
                // Cascada: si Supabase falla y estamos en local, se usan los
                // datos de ejemplo. Fuera de local esto NO hace nada: el
                // cliente real debe estar online para ver la carta.
                if (window.usarDatosDeEjemplo) {
                    window.usarDatosDeEjemplo('no se pudo cargar el menú');
                }
            });
    }

    // Las secciones de la carta viven en la tabla `secciones`, no en el código.
    //
    // Antes estaban escritas a mano en cliente-menu.js, y la base tenía sus
    // propias categorías en menu.categoria. Coincidían de casualidad: renombrar
    // una sección desde el admin hacía desaparecer sus platos de la carta.
    //
    // Si esta consulta falla, el sistema sigue andando con la lista de respaldo
    // que quedó en cliente-menu.js. Es feo pero no deja al cliente sin carta.
    function cargarSeccionesSiPosible() {
        if (!window.supabaseClient) {
            if (window.usarDatosDeEjemplo) {
                return window.usarDatosDeEjemplo('no hay cliente de Supabase');
            }
            return Promise.resolve();
        }
        return window.supabaseClient
            .from('secciones')
            .select('id, nombre, madre_id, orden, icono, visible, hora_desde, hora_hasta')
            .order('orden')
            .then(function(resp) {
                if (resp.error) throw resp.error;
                S.state.secciones = resp.data || [];
            })
            .catch(function(err) {
                console.warn('Error cargando secciones, se usa la lista de respaldo:', err);
                S.state.secciones = [];
                if (window.usarDatosDeEjemplo) {
                    window.usarDatosDeEjemplo('no se pudieron cargar las secciones');
                }
            });
    }

    function cargarInventarioSiPosible() {
        if (!window.supabaseClient) {
            if (window.usarDatosDeEjemplo) {
                return window.usarDatosDeEjemplo('no hay cliente de Supabase');
            }
            return Promise.resolve();
        }
        return window.supabaseClient
            .from('inventario')
            .select('*')
            .then(function(resp) {
                if (resp.error) throw resp.error;
                S.state.inventario = resp.data || [];
            })
            .catch(function(err) {
                console.warn('Error cargando inventario:', err);
                if (window.usarDatosDeEjemplo) {
                    window.usarDatosDeEjemplo('no se pudo cargar el inventario');
                }
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

    // inicializarCliente es async desde que espera la tasa del BCV. Las dos
    // invocaciones atrapan el rechazo: si algo falla dentro, sin este catch
    // quedaría un unhandled rejection y el arranque se cortaría en silencio.
    function _arrancar() {
        inicializarCliente().catch(function(e) {
            console.error('Error al inicializar el Cliente:', e);
        });
    }

    if (document.readyState === 'loading') {
        document.addEventListener('DOMContentLoaded', _arrancar);
    } else {
        // DOM already loaded
        _arrancar();
    }

    // beforeunload — cleanup (NOT realtime, NOT service worker)
    window.addEventListener('beforeunload', cleanupOnBeforeunload);

    // visibilitychange — smart pause/resume
    window.addEventListener('visibilitychange', onVisibilityChange);

    // Expose init function for external calls
    window.inicializarCliente = inicializarCliente;
})();
