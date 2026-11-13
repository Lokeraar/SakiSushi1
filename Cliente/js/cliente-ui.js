// cliente-ui.js - Menú hamburguesa, event delegation, panels, event listeners
(function() {
    window.Saki = window.Saki || {};
    window.Saki.modules = window.Saki.modules || {};
    window.Saki.modules.ui = {};
    var S = window.Saki;

    // ==================== PANEL TOGGLES ====================

    // ═══════════════════════════════════════════════════════════
    // UN PANEL A LA VEZ EN PRIMER PLANO
    //
    // Antes cada panel se abría por su cuenta: podías tener el menú de
    // categorías, el carrito y las notificaciones abiertos a la vez,
    // apilados uno sobre otro. En un teléfono eso tapa media pantalla y
    // no se sabe qué cerrar primero.
    //
    // La regla ahora: ABRIR UNO CIERRA LOS OTROS DOS. No se cierra el
    // que se está abriendo (eso anularía el toque), solo los ajenos.
    //
    // Se resuelve aquí, en un solo sitio, y no en cada botón: así
    // cualquier camino nuevo que abra un panel hereda la regla sin
    // tener que acordarse de repetirla.
    // ═══════════════════════════════════════════════════════════

    /** Cierra los paneles que NO son `excepto`. */
    function _cerrarPanelesExcepto(excepto) {
        if (excepto !== 'categorias') {
            var cat = document.getElementById('categorySidebar');
            if (cat) cat.classList.remove('open');
        }
        if (excepto !== 'carrito') {
            var cart = document.getElementById('cartSidebar');
            if (cart) cart.classList.remove('open');
            if (window.detenerSeguimientoScroll) window.detenerSeguimientoScroll();
        }
        if (excepto !== 'notificaciones') {
            var noti = document.getElementById('notificationsPanel');
            if (noti) noti.classList.remove('active');
        }

        // El velo oscuro solo tiene sentido con un panel lateral abierto.
        // Las notificaciones son una tarjeta flotante, no un panel que
        // tape el costado: con ellas no va velo.
        var overlay = document.getElementById('overlay');
        if (overlay) {
            if (excepto === 'categorias' || excepto === 'carrito') {
                overlay.classList.add('active');
            } else {
                overlay.classList.remove('active');
            }
        }
    }
    window.cerrarPanelesExcepto = _cerrarPanelesExcepto;
    S.modules.ui.cerrarPanelesExcepto = _cerrarPanelesExcepto;

    function toggleMenuCategorias() {
        var sidebar = document.getElementById('categorySidebar');
        var seAbre = !sidebar.classList.contains('open');
        if (seAbre) _cerrarPanelesExcepto('categorias');
        sidebar.classList.toggle('open');
        var overlay = document.getElementById('overlay');
        if (sidebar.classList.contains('open')) overlay.classList.add('active');
        else overlay.classList.remove('active');

        // ── EL AJUSTE DEL TEXTO SE REHACE AL ABRIR, NO SOLO AL PINTAR ──
        //
        // El menú se pinta una vez, al cargar la carta. Si el auto-ajuste
        // corrió mientras el panel estaba cerrado —desplazado fuera de la
        // pantalla con `transform`—, midió el ancho de un panel que el cliente
        // todavía no ve, y en algunos aparatos ese ancho llega a cero: todo
        // sale al piso de 8 pt o sin ajustar. Al abrirlo, el ancho es el real.
        //
        // Se pide un cuadro después para que el navegador haya aplicado la
        // transición de apertura antes de medir.
        if (seAbre && typeof window.ajustarPagina === 'function') {
            requestAnimationFrame(function() {
                requestAnimationFrame(function() { window.ajustarPagina(); });
            });
        }
    }
    window.toggleMenuCategorias = toggleMenuCategorias;
    S.modules.ui.toggleMenuCategorias = toggleMenuCategorias;

    function cerrarMenuCategorias() {
        document.getElementById('categorySidebar').classList.remove('open');
        document.getElementById('overlay').classList.remove('active');
    }
    window.cerrarMenuCategorias = cerrarMenuCategorias;
    S.modules.ui.cerrarMenuCategorias = cerrarMenuCategorias;

    function toggleCarrito() {
        var sidebar = document.getElementById('cartSidebar');
        var seAbre = !sidebar.classList.contains('open');
        if (seAbre) _cerrarPanelesExcepto('carrito');
        sidebar.classList.toggle('open');
        var overlay = document.getElementById('overlay');
        if (sidebar.classList.contains('open')) {
            overlay.classList.add('active');
            if (S.state.carrito && S.state.carrito.length > 0) {
                if (window.iniciarSeguimientoScroll) window.iniciarSeguimientoScroll();
            }
        } else {
            overlay.classList.remove('active');
        }
    }
    window.toggleCarrito = toggleCarrito;
    S.modules.ui.toggleCarrito = toggleCarrito;

    function cerrarCarrito() {
        document.getElementById('cartSidebar').classList.remove('open');
        document.getElementById('overlay').classList.remove('active');
        if (window.detenerSeguimientoScroll) window.detenerSeguimientoScroll();
    }
    window.cerrarCarrito = cerrarCarrito;
    S.modules.ui.cerrarCarrito = cerrarCarrito;

    function cerrarNotificaciones() {
        document.getElementById('notificationsPanel').classList.remove('active');
    }
    window.cerrarNotificaciones = cerrarNotificaciones;
    S.modules.ui.cerrarNotificaciones = cerrarNotificaciones;

    function cerrarTodosLosPaneles() {
        cerrarMenuCategorias();
        cerrarCarrito();
        cerrarNotificaciones();
    }
    window.cerrarTodosLosPaneles = cerrarTodosLosPaneles;
    S.modules.ui.cerrarTodosLosPaneles = cerrarTodosLosPaneles;

    // copiarAlPortapapeles se usa desde onclick="" en el HTML.
    // La implementación está en cliente-utils.js para mantener la coherencia del módulo.
    // Esta línea window.* se elimina porque cliente-utils.js ya la expone.

    // ==================== SETUP EVENT LISTENERS (event delegation) ====================

    function setupEventListeners() {
        // Menu toggle
        var menuToggle = document.getElementById('menuToggle');
        if (menuToggle) menuToggle.addEventListener('click', toggleMenuCategorias);

        var closeCategory = document.getElementById('closeCategoryMenu');
        if (closeCategory) closeCategory.addEventListener('click', cerrarMenuCategorias);

        // Cart toggle
        var cartToggle = document.getElementById('cartToggle');
        if (cartToggle) cartToggle.addEventListener('click', toggleCarrito);

        var closeCartBtn = document.getElementById('closeCart');
        if (closeCartBtn) closeCartBtn.addEventListener('click', cerrarCarrito);

        // Theme toggle
        var themeToggle = document.getElementById('themeToggle');
        if (themeToggle) themeToggle.addEventListener('click', function() {
            if (window.toggleTema) window.toggleTema();
        });

        // Notification bell
        var notifBell = document.getElementById('notificationBell');
        if (notifBell) notifBell.addEventListener('click', function() {
            if (window.toggleNotifications) window.toggleNotifications();
        });

        // TOCAR FUERA CIERRA LAS NOTIFICACIONES.
        //
        // El panel solo se cerraba volviendo a pulsar la campana. Si el
        // cliente tocaba una tarjeta del menú, el carrito o cualquier otra
        // cosa, las notificaciones seguían flotando encima de lo que estaba
        // mirando.
        //
        // POR QUÉ SE ESCUCHA EN EL DOCUMENTO Y NO EN UN VELO: la campana y
        // el panel viven en ramas distintas del árbol (línea 3202 y 3537),
        // no son padre e hijo. Un velo que los envolviera obligaría a
        // reescribir el HTML del header.
        //
        // El toque en la campana NO debe contar como «fuera», o el panel se
        // abriría y cerraría en el mismo toque. Se comprueba con `closest`
        // sobre el botón, y además el listener del botón corre antes que el
        // del documento: cuando este último se ejecuta, el panel ya está
        // abierto y `active` es true, así que sin la comprobación se
        // cerraría de inmediato.
        // SE ESCUCHA EN FASE DE CAPTURA (el `true` final).
        //
        // Varios handlers de las tarjetas llaman a `e.stopPropagation()`
        // (los botones de favorito, añadir y personalizar). Un listener
        // normal en el documento NUNCA se ejecutaría después de uno de
        // esos toques, y el panel quedaría abierto justo al tocar un
        // platillo, que es el caso más común.
        //
        // En fase de captura el evento baja desde el documento hacia el
        // blanco, así que corre ANTES de cualquier stopPropagation.
        document.addEventListener('click', function (e) {
            var panel = document.getElementById('notificationsPanel');
            if (!panel || !panel.classList.contains('active')) return;

            // ¿El toque fue dentro del panel? Entonces no se cierra: el
            // usuario está leyendo o tocando una notificación.
            if (panel.contains(e.target)) return;

            // ¿El toque fue en la campana? Tampoco: ese toque ya lo maneja
            // su propio listener, y aquí solo duplicaría el trabajo.
            var campana = document.getElementById('notificationBell');
            if (campana && campana.contains(e.target)) return;

            cerrarNotificaciones();
        }, true);

        // Overlay click
        var overlay = document.getElementById('overlay');
        if (overlay) overlay.addEventListener('click', cerrarTodosLosPaneles);

        // Search input — INSTANT (no debounce, spec R-01)
        var searchInput = document.getElementById('searchInput');
        if (searchInput) {
            searchInput.addEventListener('input', function() {
                var catActiva = document.querySelector('.category-item.active');
                var cat = catActiva ? catActiva.dataset.categoria : null;
                if (window.renderizarMenuPaginado) {
                    window.renderizarMenuPaginado(cat, null, this.value);
                }
            });
        }

        // Logo click → reset to all categories
        var logoArea = document.querySelector('.logo-area');
        if (logoArea) logoArea.addEventListener('click', function() {
            if (window.resetToAllCategories) window.resetToAllCategories(true);
        });

        // Category list — EVENT DELEGATION (single listener)
        var categoryList = document.getElementById('categoryList');
        if (categoryList) {
            categoryList.addEventListener('click', function(e) {
                var item = e.target.closest('.category-item');
                if (!item) {
                    var sub = e.target.closest('.subcategory-item');
                    if (sub) {
                        document.querySelectorAll('.subcategory-item').forEach(function(s) { s.classList.remove('active'); });
                        sub.classList.add('active');
                        var cat = sub.closest('.category-item');
                        if (cat) {
                            var catId = cat.dataset.categoria;
                            if (window.renderizarMenuPaginado) window.renderizarMenuPaginado(catId, sub.dataset.subcategoria, document.getElementById('searchInput').value);
                        }
                        if (window.innerWidth <= 992 && window.cerrarMenuCategorias) window.cerrarMenuCategorias();
                    }
                    return;
                }
                if (item.dataset.categoria === 'todos') {
                    if (window.resetToAllCategories) window.resetToAllCategories();
                    return;
                }
                // Toggle subcategories
                var subList = item.querySelector('.subcategory-list');
                if (subList) {
                    subList.classList.toggle('expanded');
                    var chevron = item.querySelector('.fa-chevron-down, .fa-chevron-right');
                    if (chevron) chevron.style.transform = subList.classList.contains('expanded') ? 'rotate(180deg)' : '';
                }
                document.querySelectorAll('.category-item').forEach(function(c) { c.classList.remove('active'); });
                item.classList.add('active');
                // ── LA SECCIÓN SE FILTRA POR SU NOMBRE, NO POR SU CLAVE ──
                //
                // Aquí se pasaba `dataset.categoria` (la clave: 'sushi') y la
                // base guarda el nombre ('Sushi'), así que las secciones
                // normales salían vacías por este camino.
                //
                // Con 'favoritos' y 'ofertas' pasaba lo contrario: la clave
                // acierta porque son filtros calculados, no secciones.
                //
                // Es el ESPEJO del defecto que tenía cliente-menu.js. Se
                // arreglan los dos con la misma regla: las secciones
                // especiales van por clave, el resto por el nombre real.
                //
                // Este listener hoy casi no se ejecuta porque el de
                // cliente-menu.js hace stopPropagation antes, pero dejarlo
                // mal es dejar una mina: cualquier día que ese camino cambie,
                // la carta se vacía y nadie sabría por qué.
                var clave = item.dataset.categoria;
                var esEspecial = (clave === 'favoritos' || clave === 'ofertas');
                var filtro = esEspecial
                    ? clave
                    : (item.dataset.filtro || clave);
                if (window.renderizarMenuPaginado) {
                    window.renderizarMenuPaginado(filtro, null, document.getElementById('searchInput').value);
                }
                if (window.innerWidth <= 992) cerrarMenuCategorias();
            });
        }

        // Menu grid — EVENT DELEGATION (single listener for all card actions)
        var menuGrid = document.getElementById('menuGrid');
        if (menuGrid) {
            menuGrid.addEventListener('click', function(e) {
                // Favorite button
                var favBtn = e.target.closest('.favorite-btn');
                if (favBtn) {
                    e.stopPropagation();
                    var id = favBtn.dataset.id;
                    if (id && window.toggleFavorito) window.toggleFavorito(id);
                    return;
                }
                // Add to cart button
                var addBtn = e.target.closest('.btn-add');
                if (addBtn) {
                    e.stopPropagation();
                    if (addBtn.disabled) return;
                    var id = addBtn.dataset.id;
                    if (id && window.agregarAlCarrito) window.agregarAlCarrito(id);
                    return;
                }
                // Customize button
                var custBtn = e.target.closest('.btn-customize');
                if (custBtn) {
                    e.stopPropagation();
                    if (custBtn.disabled) return;
                    var id = custBtn.dataset.id;
                    if (id && window.abrirPersonalizacion) window.abrirPersonalizacion(id);
                    return;
                }
                // Card click → preview
                var card = e.target.closest('.menu-card');
                if (card && !e.target.closest('.menu-card-image')) {
                    var id = card.dataset.id;
                    if (id && window.abrirPreview) window.abrirPreview(id);
                    return;
                }
                // Image click → preview
                var img = e.target.closest('.menu-card-image');
                if (img) {
                    var cardEl = img.closest('.menu-card');
                    if (cardEl && !cardEl.classList.contains('agotado')) {
                        var id = cardEl.dataset.id;
                        if (id && window.abrirPreview) window.abrirPreview(id);
                    }
                }
            });
        }

        // Cart items — EVENT DELEGATION (level toggles, remove, delete group)
        var cartItems = document.getElementById('cartItems');
        if (cartItems) {
            cartItems.addEventListener('click', function(e) {
                // Borrar grupo nivel 1
                var btn = e.target.closest('.btn-borrar-grupo[data-nivel1]');
                if (btn) {
                    if (window.borrarGrupoNivel1) window.borrarGrupoNivel1(btn.dataset.nivel1);
                    return;
                }
                // Borrar grupo nivel 2
                var btn2 = e.target.closest('.btn-borrar-grupo[data-nivel2]');
                if (btn2) {
                    if (window.borrarGrupoNivel2) window.borrarGrupoNivel2(btn2.dataset.nivel2);
                    return;
                }
                // Remove individual item
                var rmBtn = e.target.closest('.btn-remove-item');
                if (rmBtn) {
                    if (window.eliminarInstancia) window.eliminarInstancia(rmBtn.dataset.id);
                    return;
                }
                // Toggle nivel1 header
                var h1 = e.target.closest('.nivel1-header[data-grupo-id]');
                if (h1) {
                    if (window.toggleNivel1) window.toggleNivel1(h1.dataset.grupoId);
                    return;
                }
                // Toggle nivel2 header
                var h2 = e.target.closest('.nivel2-header[data-subgrupo-id]');
                if (h2) {
                    if (window.toggleNivel2) window.toggleNivel2(h2.dataset.subgrupoId, h2.dataset.grupoPadre);
                    return;
                }
            });
        }

        // Modal buttons
        var cancelCustomize = document.getElementById('cancelCustomize');
        if (cancelCustomize) cancelCustomize.addEventListener('click', function() { document.getElementById('customizeModal').classList.remove('active'); });

        // El botón "Añadir" del modal pasa por el freno único.
        //
        // No es porque tarde: verificado, agrega en 33 ms. Es porque sin
        // freno, un segundo toque antes de que el modal se cierre mete el
        // plato DOS VECES, y ese es justo el problema que reportó el dueño
        // en los modales de confirmar.
        var addToCartModal = document.getElementById('addToCartFromModal');
        if (addToCartModal) addToCartModal.addEventListener('click', function() {
            window.conAccionUnica(addToCartModal, function () {
                // Hay UNA sola ventana del platillo, así que hay UNA sola
                // cosa que hacer: agregar con las opciones elegidas.
                //
                // Antes este botón tenía que adivinar de qué ventana venía
                // (`_previewPlatilloId`). Ese modo ya no existe: tocar la
                // foto y tocar «Personalizar» abren la misma pantalla.
                if (window.agregarPersonalizadoAlCarrito) {
                    window.agregarPersonalizadoAlCarrito();
                }
                return Promise.resolve();
            }, {
                texto: '<i class="fas fa-cart-plus"></i> Añadir',
                textoCargando: 'Añadiendo...',
                silencioso: true
            });
        });

        var closeCustomizeBtn = document.getElementById('closeCustomizeModal');
        if (closeCustomizeBtn) closeCustomizeBtn.addEventListener('click', function() { document.getElementById('customizeModal').classList.remove('active'); });

        // Tocar FUERA del cuadro cierra el modal.
        //
        // Mismo patrón que ya usa el modal de cuenta (cliente-cuenta.js):
        // se escucha el clic en el velo y solo se cierra si el blanco es
        // el velo mismo. Si se comprobara `closest('.modal-container')`
        // habría que recorrer el árbol en cada toque, y además un toque
        // en el borde del cuadro cerraría sin querer.
        //
        // En un teléfono esto no es un lujo: la X está arriba a la
        // derecha, lejos del pulgar, y el botón Cancelar queda abajo.
        // Tocar el fondo es el gesto que la gente ya intenta primero.
        var customizeModalEl = document.getElementById('customizeModal');
        if (customizeModalEl) {
            customizeModalEl.addEventListener('click', function (e) {
                if (e.target === customizeModalEl) {
                    customizeModalEl.classList.remove('active');
                }
            });
        }

        var cancelMesa = document.getElementById('cancelMesaOrder');
        if (cancelMesa) cancelMesa.addEventListener('click', function() { document.getElementById('confirmMesaModal').classList.remove('active'); });

        var confirmMesa = document.getElementById('confirmMesaOrder');
        if (confirmMesa) confirmMesa.addEventListener('click', function() {
            if (window.confirmarPedidoMesa) window.confirmarPedidoMesa();
        });

        var closeConfirmMesa = document.getElementById('closeConfirmMesaModal');
        if (closeConfirmMesa) closeConfirmMesa.addEventListener('click', function() { document.getElementById('confirmMesaModal').classList.remove('active'); });

        var closeDelivery = document.getElementById('closeDeliveryModal');
        if (closeDelivery) closeDelivery.addEventListener('click', function() { document.getElementById('deliveryModal').classList.remove('active'); });

        // Elegir una parroquia de la lista.
        //
        // La lista se genera por JS, así que el clic se escucha en el
        // contenedor y no en cada opción: sirve igual cuando la lista se
        // vuelve a dibujar al escribir en el buscador.
        var listaParroquias = document.getElementById('parroquiaSelect');
        if (listaParroquias) {
            listaParroquias.addEventListener('click', function(e) {
                var op = e.target.closest('.parroquia-opcion[data-parroquia]');
                if (op && window.seleccionarParroquia) {
                    window.seleccionarParroquia(op.dataset.parroquia);
                }
            });
        }

        // Tocar fuera del bloque cierra la lista.
        document.addEventListener('click', function(e) {
            var bloque = document.getElementById('parroquiaSelectorDiv');
            var lista = document.getElementById('parroquiaSelect');
            if (!bloque || !lista || lista.style.display !== 'block') return;
            if (!bloque.contains(e.target)) {
                if (window.toggleParroquiaSelect) window.toggleParroquiaSelect();
            }
        });

        // Parroquia search
        var parroquiaSearch = document.getElementById('parroquiaSearch');
        if (parroquiaSearch) {
            parroquiaSearch.addEventListener('input', function() {
                if (window.filtrarParroquias) window.filtrarParroquias();
            });
            // El blur ya NO cierra la lista.
            //
            // Antes, apenas el buscador perdía el foco, ocultaba el panel. En
            // un teléfono eso pasa en el mismo instante en que el dedo baja
            // hacia la lista: la lista desaparecía antes del toque y parecía
            // vacía. Ahora se cierra solo al elegir una parroquia, al tocar
            // fuera del bloque, o al volver a tocar el encabezado.
            parroquiaSearch.addEventListener('keydown', function(e) {
                if (e.key === 'Escape') {
                    if (window.toggleParroquiaSelect) window.toggleParroquiaSelect();
                }
                if (e.key === 'Enter') {
                    e.preventDefault();
                    var primera = document.querySelector('#parroquiaSelect .parroquia-opcion[data-parroquia]');
                    if (primera) primera.click();
                }
            });
        }

        // Delivery form validation
        var direccionInput = document.getElementById('direccion');
        if (direccionInput) {
            direccionInput.addEventListener('input', function() {
                if (window.validarFormularioDelivery) window.validarFormularioDelivery();
                if (window.actualizarContadorDireccion) window.actualizarContadorDireccion();
            });
        }

        var telefonoInput = document.getElementById('telefono');
        if (telefonoInput) {
            telefonoInput.addEventListener('input', function() {
                this.value = this.value.replace(/[^0-9+]/g, '');
                if (this.value.indexOf('+') !== 0 && this.value.length > 0) {
                    this.value = '+' + this.value.replace(/\+/g, '');
                }
                if (window.validarFormularioDelivery) window.validarFormularioDelivery();
            });
            telefonoInput.addEventListener('blur', function() {
                var d = document.getElementById('errorTelefono');
                var v = this.value.replace(/[^0-9]/g, '');
                if (this.value.length > 0 && v.length < 11) {
                    d.style.display = 'block';
                } else {
                    d.style.display = 'none';
                }
            });
        }

        // Delivery confirm button
        var confirmDelivery = document.getElementById('confirmDeliveryOrder');
        if (confirmDelivery) confirmDelivery.addEventListener('click', function() {
            if (window.confirmarPedidoDelivery) window.confirmarPedidoDelivery();
        });

        // Cancel delivery
        var cancelDelivery = document.getElementById('cancelDeliveryOrder');
        if (cancelDelivery) cancelDelivery.addEventListener('click', function() { document.getElementById('deliveryModal').classList.remove('active'); });

        // Reserva
        //
        // Los IDs eran 'confirmReservaOrder' y 'cancelReservaOrder', que NO
        // EXISTEN en el HTML. Los reales son 'confirmReserva' y no hay botón
        // de cancelar (se cierra con la X). Con getElementById devolviendo
        // null, el listener nunca se ataba: tocar "Confirmar Reserva" no
        // hacía absolutamente nada.
        var confirmReserva = document.getElementById('confirmReserva');
        if (confirmReserva) confirmReserva.addEventListener('click', function() {
            if (window.confirmarPedidoReserva) window.confirmarPedidoReserva();
        });

        var closeReserva = document.getElementById('closeReservaModal');
        if (closeReserva) closeReserva.addEventListener('click', function() { document.getElementById('reservaModal').classList.remove('active'); });

        // Comprobante file inputs
        var comprobante = document.getElementById('comprobante');
        if (comprobante) comprobante.addEventListener('change', function() {
            if (window.handleComprobanteSelect) window.handleComprobanteSelect(this);
        });

        var comprobanteReserva = document.getElementById('comprobanteReserva');
        if (comprobanteReserva) comprobanteReserva.addEventListener('change', function() {
            if (window.handleComprobanteReservaSelect) window.handleComprobanteReservaSelect(this);
        });

        // Reference input auto-advance (6 digits)
        function setupReferenceInputs() {
            var refs = document.querySelectorAll('.ref-digit');
            refs.forEach(function(input) {
                input.addEventListener('input', function() {
                    this.value = this.value.replace(/[^0-9]/g, '');
                    var type = this.dataset.type;
                    var index = parseInt(this.dataset.index);
                    if (window.moverSiguiente) window.moverSiguiente(this, type, index);
                    if (type === 'delivery' && window.validarFormularioDelivery) window.validarFormularioDelivery();
                    if (type === 'reserva' && window.validarFormularioReserva) window.validarFormularioReserva();
                });
                input.addEventListener('keydown', function(e) {
                    if (e.key === 'Backspace' && this.value === '') {
                        var prev = this.previousElementSibling;
                        if (prev && prev.classList.contains('ref-digit')) {
                            prev.focus();
                            prev.value = '';
                        }
                    }
                });
            });
        }
        setupReferenceInputs();

        // Historial pedidos
        var historialBtn = document.getElementById('historialPedidosBtn');
        if (historialBtn) historialBtn.addEventListener('click', function() {
            if (window.abrirHistorialPedidos) window.abrirHistorialPedidos();
        });

        // Exit warning buttons
        var salidaNo = document.getElementById('_salidaNo');
        if (salidaNo) salidaNo.addEventListener('click', function() { document.getElementById('_salidaAviso').style.display = 'none'; });
        var salidaSi = document.getElementById('_salidaSi');
        if (salidaSi) salidaSi.addEventListener('click', function() { window.close(); });
    }
    window.setupEventListeners = setupEventListeners;
    S.modules.ui.setupEventListeners = setupEventListeners;
})();
