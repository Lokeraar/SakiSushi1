// cliente-carrito.js - Cart CRUD, 3-level grouping, localStorage persistence
(function() {
    window.Saki = window.Saki || {};
    window.Saki.modules = window.Saki.modules || {};
    window.Saki.modules.carrito = {};
    var S = window.Saki;

    var nivel1Activo = null;
    var nivel2Activo = null;
    var _ultimoClickCarrito = {}; // { platilloId: timestamp } for debounce

    function actualizarCarritoBadge() {
        var badge = document.getElementById('cartBadge');
        if (!badge) return;
        var total = 0;
        (S.state.carrito || []).forEach(function(item) {
            total += item.cantidad || 1;
        });
        if (total > 0) {
            badge.textContent = total;
            badge.style.display = 'inline';
        } else {
            badge.style.display = 'none';
            badge.textContent = '0';
        }
    }
    window.actualizarCarritoBadge = actualizarCarritoBadge;
    S.modules.carrito.actualizarCarritoBadge = actualizarCarritoBadge;

    function agregarAlCarrito(platilloId) {
        // Debounce: ignore rapid clicks on same item within 500ms
        var ahora = Date.now();
        var ultimo = _ultimoClickCarrito[platilloId] || 0;
        if (ahora - ultimo < 500) {
            return; // Ignorar click duplicado rápido
        }
        _ultimoClickCarrito[platilloId] = ahora;

        var item = (S.state.menuItems || []).find(function(i) { return i.id == platilloId; });
        if (!item) return;

        // Red de seguridad: aunque la tarjeta no mostrara el bloqueo, un platillo sin
        // ingredientes suficientes no entra al carrito. El stock real se calcula como
        // min(stock - reservado) entre los ingredientes de la receta.
        var stockDisp = (window._stockPrecalculado && window._stockPrecalculado[platilloId]);
        if (stockDisp === undefined) stockDisp = 0;
        if (stockDisp <= 0 || item.disponible === false) {
            if (S.utils && S.utils.mostrarToast) {
                S.utils.mostrarToast('🚫 ' + item.nombre + ' no está disponible', 'error');
            }
            return;
        }

        var precioFinal = S.utils.usdToBs(item.precio);
        var instancia = {
            id: S.utils.generarId('cart_'),
            platilloId: platilloId,
            nombre: item.nombre,
            imagen: item.imagen,
            precio: precioFinal,
            cantidad: 1,
            personalizacion: null,
            ingredientesQuitados: [],
            tipo: 'completo',
            ts: Date.now()
        };
        S.state.carrito.push(instancia);
        guardarCarrito();
        actualizarCarritoBadge();
        actualizarCarritoUI();
        if (window.mostrarToast) window.mostrarToast('✅ ' + item.nombre + ' agregado al carrito', 'success');
        if (window.precalcularStockMenu) window.precalcularStockMenu();
        if (window.actualizarStockTarjetas) window.actualizarStockTarjetas();
        // Scroll to cart item
        if (window.iniciarSeguimientoScroll) window.iniciarSeguimientoScroll();
        if (window._enfocarUltimoItemCarrito) window._enfocarUltimoItemCarrito(instancia);
    }
    window.agregarAlCarrito = agregarAlCarrito;
    S.modules.carrito.agregarAlCarrito = agregarAlCarrito;

    function guardarCarrito() {
        try {
            var data = { items: S.state.carrito, timestamp: Date.now() };
            localStorage.setItem('saki_carrito', JSON.stringify(data));
        } catch(e) {}
    }
    window.guardarCarrito = guardarCarrito;
    S.modules.carrito.guardarCarrito = guardarCarrito;

    function restaurarCarrito() {
        try {
            var saved = localStorage.getItem('saki_carrito');
            if (!saved) return false;
            var data = JSON.parse(saved);
            if (!data || !data.items || !data.timestamp) return false;
            var TTL = 60 * 60 * 1000; // 1 hour
            if (Date.now() - data.timestamp > TTL) {
                localStorage.removeItem('saki_carrito');
                return false;
            }
            S.state.carrito = data.items;
            return true;
        } catch(e) {
            return false;
        }
    }
    window.restaurarCarrito = restaurarCarrito;
    S.modules.carrito.restaurarCarrito = restaurarCarrito;

    function eliminarInstancia(instanciaId) {
        S.state.carrito = S.state.carrito.filter(function(i) { return i.id !== instanciaId; });
        guardarCarrito();
        actualizarCarritoUI();
        actualizarCarritoBadge();
        if (S.state.carrito.length === 0) {
            if (window.detenerSeguimientoScroll) window.detenerSeguimientoScroll();
        }
        if (window.precalcularStockMenu) window.precalcularStockMenu();
        if (window.actualizarStockTarjetas) window.actualizarStockTarjetas();
    }
    window.eliminarInstancia = eliminarInstancia;
    S.modules.carrito.eliminarInstancia = eliminarInstancia;

    function toggleNivel1(grupoId) {
        nivel1Activo = nivel1Activo === grupoId ? null : grupoId;
        nivel2Activo = null;
        actualizarCarritoUI();
    }
    window.toggleNivel1 = toggleNivel1;
    S.modules.carrito.toggleNivel1 = toggleNivel1;

    function toggleNivel2(subgrupoId, grupoPadreId) {
        if (nivel1Activo !== grupoPadreId) {
            nivel1Activo = grupoPadreId;
        }
        nivel2Activo = nivel2Activo === subgrupoId ? null : subgrupoId;
        actualizarCarritoUI();
    }
    window.toggleNivel2 = toggleNivel2;
    S.modules.carrito.toggleNivel2 = toggleNivel2;

    function borrarGrupoNivel1(grupoId) {
        S.state.carrito = S.state.carrito.filter(function(i) { return i.platilloId != grupoId; });
        guardarCarrito();
        actualizarCarritoUI();
        actualizarCarritoBadge();
        if (window.precalcularStockMenu) window.precalcularStockMenu();
        if (window.actualizarStockTarjetas) window.actualizarStockTarjetas();
    }
    window.borrarGrupoNivel1 = borrarGrupoNivel1;
    S.modules.carrito.borrarGrupoNivel1 = borrarGrupoNivel1;

    function borrarGrupoNivel2(subgrupoId) {
        S.state.carrito = S.state.carrito.filter(function(i) { return i.id !== subgrupoId && i.personalizacion !== subgrupoId; });
        guardarCarrito();
        actualizarCarritoUI();
        actualizarCarritoBadge();
        if (window.precalcularStockMenu) window.precalcularStockMenu();
        if (window.actualizarStockTarjetas) window.actualizarStockTarjetas();
    }
    window.borrarGrupoNivel2 = borrarGrupoNivel2;
    S.modules.carrito.borrarGrupoNivel2 = borrarGrupoNivel2;

    function agruparItemsJerarquicamente() {
        var grupos = {};
        (S.state.carrito || []).forEach(function(item) {
            var key = item.platilloId;
            if (!grupos[key]) {
                grupos[key] = { platilloId: key, nombre: item.nombre, precio: item.precio, items: [] };
            }
            grupos[key].items.push(item);
        });
        var resultado = [];
        for (var key in grupos) {
            var grupo = grupos[key];
            var subgrupos = {};
            grupo.items.forEach(function(item) {
                var subKey = item.personalizacion || 'default_' + item.id;
                if (!subgrupos[subKey]) {
                    subgrupos[subKey] = { id: subKey, personalizacion: item.personalizacion, items: [] };
                }
                subgrupos[subKey].items.push(item);
            });
            grupo.subgrupos = subgrupos;
            resultado.push(grupo);
        }
        return resultado;
    }
    S.modules.carrito.agruparItemsJerarquicamente = agruparItemsJerarquicamente;

    function actualizarCarritoUI() {
        var cartItems = document.getElementById('cartItems');
        var cartFooter = document.getElementById('cartFooter');
        if (!cartItems) return;

        if (!S.state.carrito || S.state.carrito.length === 0) {
            cartItems.innerHTML = '<div class="cart-items-inner">' +
                '<div class="cart-empty"><i class="fas fa-shopping-basket"></i><p>Tu carrito está vacío</p><small>¡Agrega algunos platillos!</small></div></div>';
            if (cartFooter) cartFooter.style.display = 'none';
            actualizarCarritoBadge();
            return;
        }

        var grupos = agruparItemsJerarquicamente();
        var html = '<div class="cart-items-inner">';

        grupos.forEach(function(grupo, gi) {
            var grupoId = grupo.platilloId;
            var isOpen = nivel1Activo == grupoId;
            var totalGrupo = 0;
            var itemsCount = 0;
            grupo.items.forEach(function(i) { totalGrupo += i.precio * i.cantidad; itemsCount += i.cantidad; });

            html += '<div class="nivel1-group">' +
                '<div class="nivel1-header" data-grupo-id="' + grupoId + '">' +
                '<div class="header-row">' +
                '<div class="nombre"><i class="fas fa-chevron-right' + (isOpen ? ' rotated' : '') + '"></i> ' + grupo.nombre + '</div>' +
                '<button class="btn-borrar-grupo" data-nivel1="' + grupoId + '" title="Eliminar todos"><i class="fas fa-trash-alt"></i></button>' +
                '</div>' +
                '<div class="header-details">' +
                '<span><i class="fas fa-sort-amount-up"></i> ' + itemsCount + ' uds</span>' +
                '<span><i class="fas fa-dollar-sign"></i> ' + S.utils.formatBs(totalGrupo) + '</span>' +
                '</div></div>';

            html += '<div class="nivel2-container' + (isOpen ? ' expanded' : '') + '">';
            for (var subKey in grupo.subgrupos) {
                var sub = grupo.subgrupos[subKey];
                var subOpen = nivel2Activo == sub.id;
                var totalSub = 0;
                sub.items.forEach(function(i) { totalSub += i.precio * i.cantidad; });

                if (sub.personalizacion) {
                    html += '<div class="nivel2-group">' +
                        '<div class="nivel2-header" data-subgrupo-id="' + sub.id + '" data-grupo-padre="' + grupoId + '">' +
                        '<div class="header-row">' +
                        '<div class="nombre"><i class="fas fa-chevron-right' + (subOpen ? ' rotated' : '') + '"></i> Personalizado</div>' +
                        '<button class="btn-borrar-grupo" data-nivel2="' + sub.id + '" title="Eliminar personalizados"><i class="fas fa-trash-alt"></i></button>' +
                        '</div>' +
                        '<div class="header-details"><span><i class="fas fa-dollar-sign"></i> ' + S.utils.formatBs(totalSub) + '</span></div></div>' +
                        '<div class="nivel3-container' + (subOpen ? ' expanded' : '') + '">';
                    sub.items.forEach(function(item, ii) {
                        html += '<div class="nivel3-item">' +
                            '<div class="item-image" style="background-image:url(\'' + (item.imagen || 'https://via.placeholder.com/40') + '\')"></div>' +
                            '<div class="item-info">' +
                            '<div><span class="item-number">#' + (ii + 1) + '</span><span class="item-name">' + (item.personalizacion || grupo.nombre) + '</span></div>' +
                            '<div class="personalizacion"><i class="fas fa-cog"></i> ' + (item.ingredientesQuitados && item.ingredientesQuitados.length > 0 ? 'Sin: ' + item.ingredientesQuitados.join(', ') : 'Completo') + '</div>' +
                            '</div>' +
                            '<div class="item-precio">' + S.utils.formatBs(item.precio * item.cantidad) + '</div>' +
                            '<button class="btn-remove-item" data-id="' + item.id + '"><i class="fas fa-times"></i></button></div>';
                    });
                    html += '</div></div>';
                } else {
                    // Default group (no personalization) — show items directly
                    sub.items.forEach(function(item, ii) {
                        html += '<div class="nivel3-item">' +
                            '<div class="item-image" style="background-image:url(\'' + (item.imagen || 'https://via.placeholder.com/40') + '\')"></div>' +
                            '<div class="item-info"><span class="item-number">#' + (ii + 1) + '</span><span class="item-name">' + grupo.nombre + '</span></div>' +
                            '<div class="item-precio">' + S.utils.formatBs(item.precio * item.cantidad) + '</div>' +
                            '<button class="btn-remove-item" data-id="' + item.id + '"><i class="fas fa-times"></i></button></div>';
                    });
                }
            }
            html += '</div></div>';
        });

        // Scroll indicator cascade (flechas para bajar a botones de acción)
        html += '<div class="scroll-indicator-cascade" onclick="window.irABotonesAccion()">' +
            '<i class="fas fa-chevron-down cascade-arrow"></i>' +
            '<i class="fas fa-chevron-down cascade-arrow"></i>' +
            '<i class="fas fa-chevron-down cascade-arrow"></i>' +
            '<div class="cascade-text"><i class="fas fa-arrow-down"></i> Ir a opciones</div></div>' +
            '</div>'; // close cart-items-inner
        cartItems.innerHTML = html;

        // Cart footer
        if (cartFooter) {
            cartFooter.style.display = 'block';
            var total = 0;
            S.state.carrito.forEach(function(i) { total += i.precio * i.cantidad; });
            var totalEl = document.getElementById('cartTotal');
            if (totalEl) totalEl.textContent = S.utils.formatBs(total);

            var cartButtons = document.getElementById('cartButtons');
            if (cartButtons) {
                // Si hay mesaId en URL → interfaz para comer en el local
                // Si no → interfaz online (Delivery + Reserva)
                var esMesa = !!S.state.mesaId;
                if (esMesa) {
                    cartButtons.innerHTML =
                        '<button class="btn-primary" id="mesaOrderBtn"><i class="fas fa-store"></i> Pedir a Mesa</button>';
                    document.getElementById('mesaOrderBtn').addEventListener('click', function() {
                        if (window.abrirConfirmacionMesa) window.abrirConfirmacionMesa();
                    });
                } else {
                    cartButtons.innerHTML =
                        '<button class="btn-primary" id="deliveryOrderBtn"><i class="fas fa-motorcycle"></i> Delivery</button>' +
                        '<button class="btn-secondary" id="reservaOrderBtn"><i class="fas fa-calendar-alt"></i> Reserva</button>';
                    document.getElementById('deliveryOrderBtn').addEventListener('click', function() {
                        if (window.iniciarProcesoDelivery) window.iniciarProcesoDelivery();
                    });
                    document.getElementById('reservaOrderBtn').addEventListener('click', function() {
                        if (window.iniciarProcesoReserva) window.iniciarProcesoReserva();
                    });
                }
            }
        }

        actualizarCarritoBadge();
    }
    window.actualizarCarritoUI = actualizarCarritoUI;
    S.modules.carrito.actualizarCarritoUI = actualizarCarritoUI;

    function getCarrito() {
        return S.state.carrito || [];
    }
    window.getCarrito = getCarrito;
    S.modules.carrito.getCarrito = getCarrito;

    function vaciarCarrito() {
        S.state.carrito = [];
        guardarCarrito();
        actualizarCarritoUI();
        actualizarCarritoBadge();
    }
    window.vaciarCarrito = vaciarCarrito;
    S.modules.carrito.vaciarCarrito = vaciarCarrito;

    // Expose state references for other modules
    S.modules.carrito.nivel1Activo = function(v) {
        if (v !== undefined) nivel1Activo = v;
        return nivel1Activo;
    };
    S.modules.carrito.nivel2Activo = function(v) {
        if (v !== undefined) nivel2Activo = v;
        return nivel2Activo;
    };
})();
