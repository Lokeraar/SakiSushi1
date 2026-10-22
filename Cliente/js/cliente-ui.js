// cliente-ui.js - Menú hamburguesa, event delegation, panels, event listeners
(function() {
    window.Saki = window.Saki || {};
    window.Saki.modules = window.Saki.modules || {};
    window.Saki.modules.ui = {};
    var S = window.Saki;

    // ==================== PANEL TOGGLES ====================

    function toggleMenuCategorias() {
        var sidebar = document.getElementById('categorySidebar');
        sidebar.classList.toggle('open');
        var overlay = document.getElementById('overlay');
        if (sidebar.classList.contains('open')) overlay.classList.add('active');
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
        sidebar.classList.toggle('open');
        var overlay = document.getElementById('overlay');
        if (sidebar.classList.contains('open')) {
            overlay.classList.add('active');
            if (S.state.carrito && S.state.carrito.length > 0) {
                if (window.iniciarSeguimientoScroll) window.iniciarSeguimientoScroll();
            }
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
                if (window.renderizarMenuPaginado) window.renderizarMenuPaginado(item.dataset.categoria, null, document.getElementById('searchInput').value);
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

        var addToCartModal = document.getElementById('addToCartFromModal');
        if (addToCartModal) addToCartModal.addEventListener('click', function() {
            if (window.agregarPersonalizadoAlCarrito) window.agregarPersonalizadoAlCarrito();
        });

        var closeCustomizeBtn = document.getElementById('closeCustomizeModal');
        if (closeCustomizeBtn) closeCustomizeBtn.addEventListener('click', function() { document.getElementById('customizeModal').classList.remove('active'); });

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

        // Parroquia search
        var parroquiaSearch = document.getElementById('parroquiaSearch');
        if (parroquiaSearch) {
            parroquiaSearch.addEventListener('input', function() {
                if (window.filtrarParroquias) window.filtrarParroquias();
            });
            parroquiaSearch.addEventListener('blur', function() {
                var pr = document.getElementById('parroquiaSelect');
                if (pr) pr.style.display = 'none';
                this.style.display = 'none';
                document.getElementById('parroquiaChevron').className = 'fas fa-chevron-down';
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
        var confirmReserva = document.getElementById('confirmReservaOrder');
        if (confirmReserva) confirmReserva.addEventListener('click', function() {
            if (window.confirmarPedidoReserva) window.confirmarPedidoReserva();
        });

        var cancelReserva = document.getElementById('cancelReservaOrder');
        if (cancelReserva) cancelReserva.addEventListener('click', function() { document.getElementById('reservaModal').classList.remove('active'); });

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
