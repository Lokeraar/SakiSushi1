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
                // La foto del ingrediente viene del inventario (`inventario.imagen`).
                // Si no hay foto, el modal se arregla sin ella: nunca deja un hueco.
                imagen: (ing && ing.imagen) ? ing.imagen : '',
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

        // ── LA VENTANA ──
        //
        // Una sola, con dos disposiciones por CSS (ver .cust-ventana):
        //   · teléfono    → la foto manda, arriba a todo el ancho
        //   · tablet / PC → foto fija a la izquierda, datos a la derecha
        //
        // Todo el estilo vive en las clases del <style>, no aquí: el mismo
        // HTML se ve distinto según el ancho de la pantalla, sin duplicar
        // nada en JavaScript.
        //
        // La foto usa la MISMA url optimizada que la tarjeta, así aparece al
        // instante y se puede ampliar al tocarla.
        var foto = item.imagen || '';
        if (window.optimizarUrlImagen && item.imagen) {
            foto = window.optimizarUrlImagen(item.imagen);
        }

        // Estado del stock. Solo se avisa cuando hay algo que decir: con
        // existencias de sobra no se ocupa espacio.
        var stock = (window._stockPrecalculado || {})[platilloId];
        var bloqueStock = '';
        if (typeof stock === 'number') {
            if (stock <= 0) {
                bloqueStock = '<span class="cust-stock" style="color:var(--danger)">' +
                    '<i class="fas fa-times-circle"></i> Agotado</span>';
            } else if (stock < 5) {
                bloqueStock = '<span class="cust-stock" style="color:var(--warning)">' +
                    '<i class="fas fa-exclamation-triangle"></i> Ultimas ' + stock + '</span>';
            } else {
                bloqueStock = '<span class="cust-stock">' + stock + ' disponibles</span>';
            }
        }

        var html = '<div class="cust-layout">';

        // La foto y su X. La X vive SOBRE la foto, no en una cabecera:
        // es donde el pulgar la encuentra sin estirarse.
        html += '<div class="cust-foto-wrap">' +
            (foto
                ? '<img id="customizeFoto" class="cust-foto" src="' + foto + '" ' +
                  'alt="' + item.nombre + '" title="Toca para ampliar">'
                : '<div class="cust-foto" aria-hidden="true"></div>') +
            '<button type="button" class="cust-cerrar" id="custCerrar" ' +
              'aria-label="Cerrar la ventana del plato">&times;</button>' +
          '</div>';

        html += '<div class="cust-cuerpo">' +

            // Nombre, descripción y precio: lo primero que se lee.
            '<div>' +
              '<h3 class="cust-titulo">' + item.nombre + '</h3>' +
              (item.descripcion ? '<p class="cust-desc">' + item.descripcion + '</p>' : '') +
            '</div>' +

            '<div class="cust-meta">' +
              '<span class="cust-precio-total" id="customizePrice">' +
                S.utils.formatBs(S.utils.usdToBs(precioBase)) + '</span>' +
              bloqueStock +
            '</div>' +

            // Cantidad
            '<div class="cust-fila">' +
              '<span class="cust-etiqueta">Cantidad</span>' +
              '<div class="cust-stepper">' +
                '<button type="button" class="cust-stepper-btn" id="qtyMinus" ' +
                  'aria-label="Quitar una unidad">&minus;</button>' +
                '<span class="cust-qty" id="customizeQty">1</span>' +
                '<button type="button" class="cust-stepper-btn" id="qtyPlus" ' +
                  'aria-label="Agregar una unidad">+</button>' +
              '</div>' +
            '</div>' +

            // Modo: Completo o Personalizar
            '<div class="cust-modos">' +
              '<div class="completo-option activo" id="completoOption" role="button" tabindex="0" ' +
                'onclick="window.selectCompleto()">' +
                '<div style="display:flex;align-items:center;gap:.7rem">' +
                  '<div class="completo-circle activo" id="completoCircle">' +
                    '<i class="fas fa-check"></i></div>' +
                  '<div><strong style="color:var(--customize-text)">Completo</strong><br>' +
                    '<small style="color:var(--customize-subtext)">Incluye todos los ingredientes</small></div>' +
                '</div>' +
              '</div>' +
              '<div class="completo-option" id="personalizadoOption" role="button" tabindex="0" ' +
                'onclick="window.selectPersonalizado()">' +
                '<div style="display:flex;align-items:center;gap:.7rem">' +
                  '<div class="completo-circle" id="personalizadoCircle"></div>' +
                  '<div><strong style="color:var(--customize-text)">Personalizar ingredientes</strong><br>' +
                    '<small style="color:var(--customize-subtext)">Quitar alguno, o pedir extra</small></div>' +
                '</div>' +
              '</div>' +
            '</div>' +

            '<div id="ingredientesList" style="display:none">';

        if (ingredientes.length > 0) {
            // Tres estados por ingrediente: quitarlo, dejarlo, o duplicarlo.
            // Los principales también se pueden duplicar: «más anguila» en un
            // Dragon Roll es legítimo aunque la anguila defina el plato.
            ingredientes.forEach(function(ing, idx) {
                var cantTxt = ing.cantidad + (ing.unidad ? ' ' + ing.unidad : '');
                var precioTxt = ing.precio_porcion > 0
                    ? ' · ' + (ing.principal
                        ? 'fijo'
                        : '-' + S.utils.formatBs(S.utils.usdToBs(ing.precio_porcion)) +
                          ' / extra +' + S.utils.formatBs(S.utils.usdToBs(ing.precio_porcion)))
                    : '';

                html += '<div class="cust-ing">' +
                    // Miniatura del ingrediente. Sin foto no se pinta nada:
                    // mejor un renglón pelado que un cuadrado gris.
                    // SIN loading="lazy": la lista arranca oculta y el
                    // navegador nunca baja una imagen perezosa que está
                    // dentro de algo no visible. Son 34 px ya en caché.
                    (ing.imagen
                        ? '<img class="cust-ing-mini" src="' + ing.imagen + '" alt="">'
                        : '') +
                    '<div class="cust-ing-info">' +
                      '<div class="cust-ing-nombre">' + ing.nombre +
                        (ing.principal
                          ? ' <span style="color:var(--accent-text);font-size:.66rem">(define el plato)</span>'
                          : '') +
                      '</div>' +
                      '<span class="cust-ing-cant">' + cantTxt + precioTxt + '</span>' +
                    '</div>' +
                    '<div class="cust-ing-ctrl">' +
                      '<button type="button" class="cust-ing-btn" data-ing="' + idx + '" ' +
                        'data-estado="quitar" title="Quitar" ' +
                        'aria-label="Quitar ' + ing.nombre + '" ' +
                        'onclick="window.cambiarEstadoIngrediente(' + idx + ', \'quitar\')">&minus;</button>' +
                      '<span class="cust-ing-estado" id="estado_ing_' + idx + '">Normal</span>' +
                      '<button type="button" class="cust-ing-btn" data-ing="' + idx + '" ' +
                        'data-estado="extra" title="Duplicar la cantidad" ' +
                        'aria-label="Duplicar ' + ing.nombre + '" ' +
                        'onclick="window.cambiarEstadoIngrediente(' + idx + ', \'extra\')">&times;2</button>' +
                    '</div>' +
                  '</div>';
            });
        }

        html += '</div>' +   // #ingredientesList
                '</div>' +   // .cust-cuerpo
                '</div>';    // .cust-layout

        body.innerHTML = html;

        // La clase cambia la ventana a modo «platillo»: cabecera oculta y
        // foto con la X encima. El historial la quita al abrirse.
        var contenedor = modal.querySelector('.modal-container');
        if (contenedor) contenedor.classList.add('cust-ventana');

        modal.classList.add('active');

        // Event listeners for quantity
        document.getElementById('qtyMinus').addEventListener('click', function() {
            if (window.actualizarCantidadPersonalizacion) window.actualizarCantidadPersonalizacion(-1);
        });
        document.getElementById('qtyPlus').addEventListener('click', function() {
            if (window.actualizarCantidadPersonalizacion) window.actualizarCantidadPersonalizacion(1);
        });

        // La X cierra la ventana.
        var cerrarEl = document.getElementById('custCerrar');
        if (cerrarEl) {
            cerrarEl.addEventListener('click', function() {
                modal.classList.remove('active');
            });
        }

        // La foto del plato se amplía al tocarla, igual que en la vista rápida.
        var fotoEl = document.getElementById('customizeFoto');
        if (fotoEl) {
            fotoEl.addEventListener('click', function() {
                if (window.ampliarImagen) window.ampliarImagen(foto, item.nombre);
            });
        }
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

    window.cambiarEstadoIngrediente = function cambiarEstadoIngrediente (idx, accion) {
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
