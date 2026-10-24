// cliente-customize.js - Modal de personalización con ingredientes y precio dinámico
(function() {
    window.Saki = window.Saki || {};
    window.Saki.modules = window.Saki.modules || {};
    window.Saki.modules.customize = {};
    var S = window.Saki;

    var currentCustomizeItem = null;

    /**
     * ¿Quitar un ingrediente devuelve plata?
     *
     * Lo decide el restaurante desde el admin (`config.descuento_al_quitar`).
     * Por defecto SÍ, que es como funcionaba antes.
     *
     * El dueño lo quiere configurable porque hay dos casos legítimos:
     *   - devolver: un cliente con alergia saca un ingrediente y paga menos.
     *     Casi ningún restaurante lo hace, y él lo quiere como diferenciación.
     *   - no devolver: el plato ya está armado, la cocina gasta lo mismo.
     *
     * Si el valor no llegó (sin conexión), se asume TRUE: es el
     * comportamiento histórico y el menos sorpresivo.
     */
    function _descuentaAlQuitar() {
        var v = (S.state.config && S.state.config.descuento_al_quitar);
        if (v === undefined || v === null) return true;
        return v === true;
    }

    function abrirPersonalizacion(platilloId) {
        var item = (S.state.menuItems || []).find(function(i) { return i.id == platilloId; });
        if (!item) return;

        currentCustomizeItem = item;
        var modal = document.getElementById('customizeModal');
        var body = document.getElementById('customizeModalBody');
        if (!modal || !body) return;

        // ingredientes en DB es objeto {id: {nombre, cantidad, principal}}, convertimos a array
        var ingredientesObj = item.ingredientes || {};
        var ingredientes = Object.entries(ingredientesObj).map(function(e) {
            var ingId = e[0], ingInfo = e[1];
            var ing = (S.state.inventario || []).find(function(i) { return i.id === ingId; });
            return {
                id: ingId,
                nombre: ingInfo.nombre || ing?.nombre || ingId,
                cantidad: ingInfo.cantidad || 1,
                principal: ingInfo.principal === true,
                precio_extra: parseFloat(ing?.precio_unitario || ingInfo.precio_extra || 0)
            };
        });
        var precioBase = item.precio || 0;

        var html = '<div style="margin-bottom:1rem">' +
            '<h4 style="color:var(--accent);margin-bottom:.5rem;font-size:1.1rem">' + item.nombre + '</h4>' +
            '<p style="color:var(--text-secondary);font-size:.85rem">' + (item.descripcion || '') + '</p></div>' +
            '<div style="margin-bottom:1rem">' +
            '<label style="font-weight:600;color:var(--text-primary);display:block;margin-bottom:.5rem">Cantidad:</label>' +
            '<div style="display:flex;align-items:center;gap:1rem">' +
            '<button class="btn-secondary" id="qtyMinus" style="width:36px;height:36px;padding:0;border-radius:50%;min-width:unset">-</button>' +
            '<span id="customizeQty" style="font-size:1.4rem;font-weight:700;color:var(--accent);min-width:40px;text-align:center">1</span>' +
            '<button class="btn-secondary" id="qtyPlus" style="width:36px;height:36px;padding:0;border-radius:50%;min-width:unset">+</button>' +
            '</div></div>' +
            '<div style="margin-bottom:.8rem">' +
            '<div class="completo-option activo" id="completoOption" onclick="window.selectCompleto()">' +
            '<div style="display:flex;align-items:center;gap:.8rem">' +
            '<div class="completo-circle activo" id="completoCircle"><i class="fas fa-check"></i></div>' +
            '<div><strong style="color:var(--text-primary)">Completo</strong><br><small style="color:var(--text-secondary)">Incluye todos los ingredientes</small></div>' +
            '</div></div>' +
            '<div class="completo-option" id="personalizadoOption" onclick="window.selectPersonalizado()">' +
            '<div style="display:flex;align-items:center;gap:.8rem">' +
            '<div class="completo-circle" id="personalizadoCircle"></div>' +
            '<div><strong style="color:var(--text-primary)">Personalizar ingredientes</strong><br><small style="color:var(--text-secondary)">Elige qué ingredientes quitar</small></div>' +
            '</div></div></div>' +
            '<div id="ingredientesList" style="display:none">';

        if (ingredientes.length > 0) {
            html += '<label style="font-weight:600;color:var(--text-primary);display:block;margin-bottom:.5rem">Ingredientes:</label>';
            ingredientes.forEach(function(ing, idx) {
                var label = ing.nombre;
                if (ing.principal) label += ' <span style="color:var(--accent);font-size:.7rem">(Principal - fijo)</span>';
                var disabled = ing.principal ? 'disabled' : '';
                html += '<div style="display:flex;align-items:center;gap:.6rem;padding:.4rem 0;border-bottom:1px solid var(--customize-border)">' +
                    '<input type="checkbox" id="ing_' + idx + '" value="' + ing.nombre + '" data-precio="' + ing.precio_extra + '" checked ' + disabled + ' style="width:18px;height:18px" onchange="window.calcularPrecioPersonalizado()">' +
                    '<label for="ing_' + idx + '" style="flex:1;cursor:pointer;color:var(--customize-text);font-size:.9rem">' + label + '</label>' +
                    '</div>';
            });
        }
        html += '</div>' +
            '<div style="margin-top:1rem;padding:.8rem;background:var(--customize-row-bg);border-radius:var(--radius-sm);text-align:center">' +
            '<span style="font-size:.85rem;color:var(--customize-subtext)">Precio unitario:</span> ' +
            '<span id="customizePrice" style="font-size:1.3rem;font-weight:700;color:var(--accent)">' + S.utils.formatBs(S.utils.usdToBs(precioBase)) + '</span></div>';

        body.innerHTML = html;
        modal.classList.add('active');

        // Event listeners for quantity
        document.getElementById('qtyMinus').addEventListener('click', function() {
            if (window.actualizarCantidadPersonalizacion) window.actualizarCantidadPersonalizacion(-1);
        });
        document.getElementById('qtyPlus').addEventListener('click', function() {
            if (window.actualizarCantidadPersonalizacion) window.actualizarCantidadPersonalizacion(1);
        });
    }
    window.abrirPersonalizacion = abrirPersonalizacion;
    S.modules.customize.abrirPersonalizacion = abrirPersonalizacion;

    var _currentQty = 1;
    var _isCompleto = true;
    var _quitados = [];

    function selectCompleto() {
        _isCompleto = true;
        document.getElementById('completoOption').classList.add('activo');
        document.getElementById('completoCircle').classList.add('activo');
        document.getElementById('personalizadoOption').classList.remove('activo');
        document.getElementById('personalizadoCircle').classList.remove('activo');
        document.getElementById('ingredientesList').style.display = 'none';
        document.querySelectorAll('#ingredientesList input[type=checkbox]').forEach(function(cb) { cb.checked = true; });
        _quitados = [];
        calcularPrecioPersonalizado();
    }
    window.selectCompleto = selectCompleto;
    S.modules.customize.selectCompleto = selectCompleto;

    function selectPersonalizado() {
        _isCompleto = false;
        document.getElementById('personalizadoOption').classList.add('activo');
        document.getElementById('personalizadoCircle').classList.add('activo');
        document.getElementById('completoOption').classList.remove('activo');
        document.getElementById('completoCircle').classList.remove('activo');
        document.getElementById('ingredientesList').style.display = 'block';
    }
    window.selectPersonalizado = selectPersonalizado;
    S.modules.customize.selectPersonalizado = selectPersonalizado;

    function actualizarCantidadPersonalizacion(delta) {
        _currentQty = Math.max(1, _currentQty + delta);
        var el = document.getElementById('customizeQty');
        if (el) el.textContent = _currentQty;
        calcularPrecioPersonalizado();
    }
    window.actualizarCantidadPersonalizacion = actualizarCantidadPersonalizacion;
    S.modules.customize.actualizarCantidadPersonalizacion = actualizarCantidadPersonalizacion;

    function calcularPrecioPersonalizado() {
        if (!currentCustomizeItem) return;
        _quitados = [];
        var descuento = 0;
        document.querySelectorAll('#ingredientesList input[type=checkbox]').forEach(function(cb) {
            if (!cb.checked) {
                _quitados.push(cb.value);
                descuento += parseFloat(cb.dataset.precio) || 0;
            }
        });
        // Si el restaurante decidió que quitar no abarata, el descuento se
        // ignora por completo: el plato se cobra igual.
        var descuentoAplicado = _descuentaAlQuitar() ? descuento : 0;
        var precioUSD = Math.max(0.01, (currentCustomizeItem.precio || 0) - descuentoAplicado);
        var precioBs = S.utils.usdToBs(precioUSD);
        var total = precioBs * _currentQty;
        var priceEl = document.getElementById('customizePrice');
        if (priceEl) priceEl.textContent = S.utils.formatBs(precioBs) + ' x ' + _currentQty + ' = ' + S.utils.formatBs(total);
    }
    window.calcularPrecioPersonalizado = calcularPrecioPersonalizado;
    S.modules.customize.calcularPrecioPersonalizado = calcularPrecioPersonalizado;

    function agregarPersonalizadoAlCarrito() {
        if (!currentCustomizeItem) return;
        var item = currentCustomizeItem;
        var descuento = 0;
        var quitados = [];
        document.querySelectorAll('#ingredientesList input[type=checkbox]').forEach(function(cb) {
            if (!cb.checked) {
                quitados.push(cb.value);
                descuento += parseFloat(cb.dataset.precio) || 0;
            }
        });
        var descuentoAplicado = _descuentaAlQuitar() ? descuento : 0;
        var precioUSD = Math.max(0.01, (item.precio || 0) - descuentoAplicado);
        var precioBs = S.utils.usdToBs(precioUSD);

        for (var i = 0; i < _currentQty; i++) {
            var instancia = {
                id: S.utils.generarId('cart_'),
                platilloId: item.id,
                nombre: item.nombre,
                imagen: item.imagen,
                precio: precioBs,
                cantidad: 1,
                personalizacion: _isCompleto ? null : ('Personalizado #' + (i + 1)),
                ingredientesQuitados: quitados.slice(),
                tipo: _isCompleto ? 'completo' : 'personalizado',
                ts: Date.now()
            };
            S.state.carrito.push(instancia);
        }

        guardarCarrito();
        actualizarCarritoBadge();
        actualizarCarritoUI();
        document.getElementById('customizeModal').classList.remove('active');
        if (window.mostrarToast) window.mostrarToast('✅ ' + item.nombre + ' agregado al carrito', 'success');
        if (window.precalcularStockMenu) window.precalcularStockMenu();
        if (window.actualizarStockTarjetas) window.actualizarStockTarjetas();
        currentCustomizeItem = null;
        _currentQty = 1;
        _isCompleto = true;
        _quitados = [];
    }
    window.agregarPersonalizadoAlCarrito = agregarPersonalizadoAlCarrito;
    S.modules.customize.agregarPersonalizadoAlCarrito = agregarPersonalizadoAlCarrito;

    // Stub references to avoid circular dependency
    function guardarCarrito() {
        if (window.guardarCarrito) window.guardarCarrito();
    }
    function actualizarCarritoBadge() {
        if (window.actualizarCarritoBadge) window.actualizarCarritoBadge();
    }
    function actualizarCarritoUI() {
        if (window.actualizarCarritoUI) window.actualizarCarritoUI();
    }
})();
