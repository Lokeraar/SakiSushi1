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
            // EL PRECIO DE LA PORCIÓN, NO EL DEL KILO ENTERO.
            //
            // `precio_unitario` es lo que vale UN kilo (o UNA unidad) del
            // ingrediente. El plato no lleva el kilo: lleva 0,1 kg, 0,02 kg.
            //
            // Antes se usaba el precio entero para descontar, y eso rompía
            // las cuentas: destildando las huevas (35,00 el kilo) del Dragon
            // Roll (12,99), el precio caía a 0,01. Medido en pantalla: el
            // plato pasaba de Bs. 11.512 a Bs. 8,86.
            //
            // Ahora se usa la porción: cantidad × precio unitario.
            var cant = parseFloat(ingInfo.cantidad);
            if (isNaN(cant) || cant <= 0) cant = 1;
            var precioUnidad = parseFloat(ing && ing.precio_unitario);
            if (isNaN(precioUnidad)) precioUnidad = parseFloat(ingInfo.precio_extra) || 0;

            return {
                id: ingId,
                nombre: ingInfo.nombre || ing?.nombre || ingId,
                cantidad: cant,
                unidad: ingInfo.unidad || (ing && ing.unidad_base) || '',
                principal: ingInfo.principal === true,
                precio_unidad: precioUnidad,
                // Lo que vale esta porción dentro del plato: es lo que se
                // descuenta al quitarla y lo que se cobra al duplicarla.
                precio_porcion: Math.round(cant * precioUnidad * 100) / 100
            };
        });
        _ingredientesActuales = ingredientes;
        _estadosIng = {};
        ingredientes.forEach(function (_, i) { _estadosIng[i] = 'normal'; });

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
            '<div><strong style="color:var(--text-primary)">Personalizar ingredientes</strong><br><small style="color:var(--text-secondary)">Quitar alguno, o pedir extra</small></div>' +
            '</div></div></div>' +
            '<div id="ingredientesList" style="display:none">';

        if (ingredientes.length > 0) {
            html += '<label style="font-weight:600;color:var(--text-primary);display:block;margin-bottom:.5rem">Ingredientes:</label>';
            // Tres estados por ingrediente: quitarlo, dejarlo, o duplicarlo.
            //
            // Antes era un tilde: puesto = el plato lo lleva, destildado = no.
            // No había forma de AÑADIR. Y los principales venían bloqueados.
            //
            // El dueño pidió que los principales también se puedan duplicar:
            // "más anguila" en un Dragon Roll es legítimo aunque la anguila
            // defina el plato.
            ingredientes.forEach(function(ing, idx) {
                var cantTxt = ing.cantidad + (ing.unidad ? ' ' + ing.unidad : '');
                var precioTxt = ing.precio_porcion > 0
                    ? ' <span style="color:var(--text-secondary);font-size:.72rem">(' +
                      (ing.principal ? 'fijo' : '-' + S.utils.formatBs(S.utils.usdToBs(ing.precio_porcion))) +
                      ' · extra +' + S.utils.formatBs(S.utils.usdToBs(ing.precio_porcion)) + ')</span>'
                    : '';

                var btnBase = 'style="width:30px;height:30px;border-radius:50%;border:1px solid var(--customize-border);' +
                              'background:transparent;color:var(--customize-text);font-size:.9rem;cursor:pointer;padding:0"';

                html += '<div style="display:flex;align-items:center;gap:.5rem;padding:.5rem 0;border-bottom:1px solid var(--customize-border)">' +
                    '<div style="flex:1;min-width:0">' +
                      '<div style="color:var(--customize-text);font-size:.9rem">' + ing.nombre +
                        (ing.principal ? ' <span style="color:var(--accent);font-size:.66rem">(define el plato)</span>' : '') +
                      '</div>' +
                      '<div style="font-size:.72rem;opacity:.75">' + cantTxt + precioTxt + '</div>' +
                    '</div>' +
                    '<button ' + btnBase + ' data-ing="' + idx + '" data-estado="quitar" ' +
                      'onclick="window.cambiarEstadoIngrediente(' + idx + ', \'quitar\')" ' +
                      'title="Quitar">−</button>' +
                    '<span id="estado_ing_' + idx + '" style="width:52px;text-align:center;font-size:.74rem;' +
                      'font-weight:600;color:var(--customize-text)">Normal</span>' +
                    '<button ' + btnBase + ' data-ing="' + idx + '" data-estado="extra" ' +
                      'onclick="window.cambiarEstadoIngrediente(' + idx + ', \'extra\')" ' +
                      'title="Duplicar la cantidad">×2</button>' +
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
    // { indice: 'normal' | 'quitar' | 'extra' }
    var _estadosIng = {};
    // La lista de ingredientes del plato abierto, con su porción y precio.
    var _ingredientesActuales = [];

    function selectCompleto() {
        _isCompleto = true;
        // Volver a "Completo" borra cualquier extra o quitado anterior.
        Object.keys(_estadosIng).forEach(function (k) { _estadosIng[k] = 'normal'; });
        Object.keys(_estadosIng).forEach(function (k) {
            var e = document.getElementById('estado_ing_' + k);
            if (e) { e.textContent = 'Normal'; e.style.color = ''; }
        });
        document.getElementById('completoOption').classList.add('activo');
        document.getElementById('completoCircle').classList.add('activo');
        document.getElementById('personalizadoOption').classList.remove('activo');
        document.getElementById('personalizadoCircle').classList.remove('activo');
        document.getElementById('ingredientesList').style.display = 'none';

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

    /**
     * Cambia un ingrediente entre quitarlo, dejarlo o duplicarlo.
     *
     * "Extra" significa la MISMA cantidad que ya lleva el plato: si lleva
     * 25 g de salmón, un extra son otros 25 g, y se cobra la porción.
     * Así lo definió el dueño.
     */
    /** ¿Poner `idx` en extra dejaría TODOS los ingredientes en extra? */
    function _seriaExtraDeTodo(idx) {
        if (!_ingredientesActuales.length) return false;
        for (var i = 0; i < _ingredientesActuales.length; i++) {
            var estado = (i === idx) ? 'extra' : (_estadosIng[i] || 'normal');
            if (estado !== 'extra') return false;
        }
        return true;
    }

    window.cambiarEstadoIngrediente = function (idx, accion) {
        var actual = _estadosIng[idx] || 'normal';
        var quitar = _ingredientesActuales[idx];
        if (!quitar) return;

        // Un ingrediente principal define el plato: se puede duplicar, pero
        // no quitar (sin la anguila, un Dragon Roll no es un Dragon Roll).
        if (accion === 'quitar' && quitar.principal) return;

        var nuevo = (actual === accion) ? 'normal' : accion;

        // AVISO ANTES DEL SALTO DE PRECIO.
        //
        // Pedir extra de TODOS los ingredientes equivale a otro plato. El
        // precio no salta de a porciones: salta al doble del plato completo.
        // Medido en el Dragon Roll: 4 extras cuestan ~Bs. 14.000 y el quinto
        // lleva el plato a Bs. 23.024 de golpe.
        //
        // Sin aviso, el cliente ve el precio duplicarse al tocar el último
        // boton y abandona. Se le explica antes, con los numeros a la vista.
        if (nuevo === 'extra' && _seriaExtraDeTodo(idx)) {
            var precioPlato = Math.round(S.utils.usdToBs(currentCustomizeItem.precio || 0));
            var precioDoble = precioPlato * 2;
            var seguir = confirm(
                'Esto convierte el pedido en DOS platos:\n\n' +
                'Pediste extra de todos los ingredientes de ' +
                (currentCustomizeItem.nombre || 'este plato') + ', y eso equivale ' +
                'a un plato mas, no a un plato agrandado.\n\n' +
                'Precio: ' + S.utils.formatBs(precioPlato * _currentQty) +
                '  ->  ' + S.utils.formatBs(precioDoble * _currentQty) + '\n\n' +
                'La cocina va a preparar ' + (_currentQty * 2) + ' platos.\n' +
                '¿Seguir?'
            );
            if (!seguir) return;
        }

        _estadosIng[idx] = nuevo;

        var etiqueta = document.getElementById('estado_ing_' + idx);
        if (etiqueta) {
            etiqueta.textContent = nuevo === 'quitar' ? 'Sin' : (nuevo === 'extra' ? '×2' : 'Normal');
            etiqueta.style.color = nuevo === 'quitar' ? '#ef4444' : (nuevo === 'extra' ? '#4ade80' : '');
        }
        calcularPrecioPersonalizado();
    };

    function calcularPrecioPersonalizado() {
        if (!currentCustomizeItem) return;

        _quitados = [];
        var descuento = 0;
        var recargo = 0;
        var extras = 0;

        Object.keys(_estadosIng).forEach(function (k) {
            var i = parseInt(k, 10);
            var ing = _ingredientesActuales[i];
            if (!ing) return;
            var estado = _estadosIng[k];

            if (estado === 'quitar') {
                _quitados.push(ing.nombre);
                descuento += ing.precio_porcion;
            } else if (estado === 'extra') {
                recargo += ing.precio_porcion;
                extras++;
            }
        });

        // Si el restaurante decidió que quitar no abarata, el descuento se
        // ignora por completo: el plato se cobra igual.
        var descuentoAplicado = _descuentaAlQuitar() ? descuento : 0;

        var precioUSD = Math.max(0.01,
            (currentCustomizeItem.precio || 0) - descuentoAplicado + recargo);

        var precioBs = S.utils.usdToBs(precioUSD);
        var total = precioBs * _currentQty;
        var priceEl = document.getElementById('customizePrice');
        if (priceEl) {
            var detalle = '';
            if (extras > 0) detalle = ' <span style="font-size:.72rem;color:#4ade80">(+' + extras + ' extra' + (extras > 1 ? 's' : '') + ')</span>';
            priceEl.innerHTML = S.utils.formatBs(precioBs) + ' x ' + _currentQty + ' = ' + S.utils.formatBs(total) + detalle;
        }
    }
    window.calcularPrecioPersonalizado = calcularPrecioPersonalizado;
    S.modules.customize.calcularPrecioPersonalizado = calcularPrecioPersonalizado;

    function agregarPersonalizadoAlCarrito() {
        if (!currentCustomizeItem) return;
        var item = currentCustomizeItem;
        var descuento = 0;
        var recargo = 0;
        var quitados = [];
        var agregados = [];

        Object.keys(_estadosIng).forEach(function (k) {
            var i = parseInt(k, 10);
            var ing = _ingredientesActuales[i];
            if (!ing) return;
            var estado = _estadosIng[k];
            if (estado === 'quitar') {
                quitados.push(ing.nombre);
                descuento += ing.precio_porcion;
            } else if (estado === 'extra') {
                agregados.push({ nombre: ing.nombre, cantidad: ing.cantidad, unidad: ing.unidad });
                recargo += ing.precio_porcion;
            }
        });

        var descuentoAplicado = _descuentaAlQuitar() ? descuento : 0;
        var precioUSD = Math.max(0.01, (item.precio || 0) - descuentoAplicado + recargo);
        var precioBs = S.utils.usdToBs(precioUSD);

        var hayExtra = agregados.length > 0;
        var etiqueta;
        if (_isCompleto && !hayExtra) {
            etiqueta = null;
        } else {
            // La etiqueta dice QUÉ cambió, no la palabra fija "Personalizado".
            var partes = [];
            if (quitados.length) partes.push('Sin ' + quitados.join(', '));
            if (hayExtra) partes.push('Con extra de ' + agregados.map(function (a) { return a.nombre; }).join(', '));
            etiqueta = partes.join(' · ');
        }

        // REGLA DEL DUEÑO: pedir extra de TODOS los ingredientes equivale a
        // otro plato completo. En vez de un plato "con todo duplicado", se
        // agregan DOS unidades del plato normal. Es más claro en el carrito
        // y además es lo que la cocina va a preparar de verdad.
        var todosEnExtra = _ingredientesActuales.length > 0 &&
            Object.keys(_estadosIng).length === _ingredientesActuales.length &&
            _ingredientesActuales.every(function (_, i) { return _estadosIng[i] === 'extra'; });

        if (todosEnExtra) {
            var precioNormalBs = S.utils.usdToBs(item.precio || 0);
            for (var u = 0; u < (_currentQty * 2); u++) {
                S.state.carrito.push({
                    id: S.utils.generarId('cart_'),
                    platilloId: item.id,
                    nombre: item.nombre,
                    imagen: item.imagen,
                    precio: precioNormalBs,
                    cantidad: 1,
                    personalizacion: null,
                    ingredientesQuitados: [],
                    ingredientesAgregados: [],
                    tipo: 'completo',
                    ts: Date.now()
                });
            }
            if (window.mostrarToast) {
                window.mostrarToast('✅ ' + item.nombre + ' × ' + (_currentQty * 2) +
                    ' (pediste extra de todo: son ' + (_currentQty * 2) + ' platos)', 'success');
            }
        } else {
            for (var i = 0; i < _currentQty; i++) {
                var instancia = {
                    id: S.utils.generarId('cart_'),
                    platilloId: item.id,
                    nombre: item.nombre,
                    imagen: item.imagen,
                    precio: precioBs,
                    cantidad: 1,
                    personalizacion: etiqueta,
                    ingredientesQuitados: quitados.slice(),
                    ingredientesAgregados: agregados.slice(),
                    tipo: (quitados.length === 0 && !hayExtra) ? 'completo' : 'personalizado',
                    ts: Date.now()
                };
                S.state.carrito.push(instancia);
            }
            if (window.mostrarToast) {
                window.mostrarToast('✅ ' + item.nombre + ' agregado al carrito', 'success');
            }
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
        _estadosIng = {};
        _ingredientesActuales = [];
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
