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

        // La cantidad SIEMPRE empieza en 1 al abrir un platillo.
        //
        // Antes solo se reiniciaba al añadir al carrito. Si el cliente abría
        // un plato, subía a 20 y cerraba sin añadir, al abrir OTRO plato se
        // encontraba con 20 ya puestos. Con el campo de texto esto sería
        // peor: un dedazo se arrastraría de un plato a otro.
        _currentQty = 1;

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
        // Todas las porciones empiezan en 1 (normal). Ver `_estadosIng`.
        ingredientes.forEach(function (_, i) { _estadosIng[i] = 1; });

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

        // ── ESTRELLA DE FAVORITOS, SOBRE LA FOTO ──
        //
        // Antes esta ventana no tenía forma de marcar el plato: el cliente
        // tenía que cerrarla, buscarlo en la carta y tocar la estrella de la
        // tarjeta. Aquí la decisión se toma en el momento en que el plato se
        // está mirando, que es cuando tiene sentido.
        //
        // Va dentro de `.cust-foto-wrap` (para colocarse sobre la foto) y a
        // la IZQUIERDA: la esquina derecha es de la X de cerrar, tanto en el
        // teléfono (X sobre la foto) como en tablet y PC (X en la esquina de
        // la tarjeta). Ver `.cust-fav` en el <style>.
        //
        // El estado inicial sale de `window.esFavorito`, que es la misma
        // función que usa la tarjeta: una sola fuente de verdad. Si el
        // módulo de favoritos no cargó (sin señal, caché vieja), se asume
        // que no es favorito en vez de romper la ventana entera.
        var esFav = false;
        if (typeof window.esFavorito === 'function') {
            esFav = !!window.esFavorito(item.id);
        }
        var etiquetaFav = esFav ? 'Quitar de favoritos' : 'Agregar a favoritos';
        var estrellaFav =
            '<button type="button" class="favorite-btn favorite-btn--foto cust-fav' +
              (esFav ? ' active' : '') + '" ' +
              'id="custFavBtn" data-id="' + item.id + '" ' +
              'aria-pressed="' + (esFav ? 'true' : 'false') + '" ' +
              'aria-label="' + etiquetaFav + '" ' +
              'data-tooltip="' + etiquetaFav + '">' +
              '<i class="fas fa-star"></i></button>';

        // La foto y su X. La X vive SOBRE la foto, no en una cabecera:
        // es donde el pulgar la encuentra sin estirarse.
        // La foto va en su envoltura; la X va FUERA, como hija directa del
        // contenedor. Así el CSS decide a qué se ancla: en el teléfono a la
        // foto, en tablet y PC a la esquina de la tarjeta.
        //
        // La estrella sí va DENTRO de la envoltura: su posición es la foto,
        // no la tarjeta, y no cambia entre pantallas.
        html += '<div class="cust-foto-wrap">' +
            estrellaFav +
            (foto
                ? '<img id="customizeFoto" class="cust-foto" src="' + foto + '" ' +
                  'alt="' + item.nombre + '" title="Toca para ampliar">'
                : '<div class="cust-foto" aria-hidden="true"></div>') +
          '</div>' +
          '<button type="button" class="cust-cerrar" id="custCerrar" ' +
            'aria-label="Cerrar la ventana del plato">&times;</button>';

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
                // La cantidad es un CAMPO DE TEXTO, no un número fijo.
                //
                // Antes era un <span> y la única forma de subir era pulsar
                // "+" muchas veces: para 30 piezas había que tocar 29 veces.
                //
                // Se usa type="text" y no type="number" a propósito:
                //   · en el teléfono, type="number" abre un teclado con
                //     flechas y signos que aquí sobran, y en algunos Android
                //     ni muestra los dígitos cómodos;
                //   · con inputmode="numeric" se abre el teclado numérico
                //     directo, que es lo que el cliente necesita;
                //   · el patrón [0-9]* evita que entren letras.
                '<input type="text" class="cust-qty cust-qty-input" id="customizeQty" ' +
                  'value="1" inputmode="numeric" pattern="[0-9]*" maxlength="3" ' +
                  'autocomplete="off" aria-label="Cantidad">' +
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
            // ── CABECERA DE COLUMNAS ──
            //
            // Antes la fila terminaba en tres controles sin título: nada
            // decía qué hacían el "−" ni el "×2", y el cliente tocaba a
            // ciegas. Ahora cada columna se rotula.
            //
            // NO es una <table>: la ventana entera es flex y rejilla, y una
            // tabla impone su propio ancho mínimo y rompería el paso a dos
            // columnas a partir de 600 px. La cabecera y las filas comparten
            // rejilla desde el <style> (.cust-ing-cabecera, .cust-ing), así
            // cada rótulo cae justo encima de su botón.
            //
            // La primera celda va vacía porque es la columna de la
            // miniatura: las filas de datos sí la llevan.
            html += '<div class="cust-ing-cabecera" aria-hidden="true">' +
                '<span class="cust-ing-mini-celda"></span>' +
                '<span class="cust-ing-cab cust-ing-cab--nombre">Nombre del ingrediente</span>' +
                '<span class="cust-ing-cab cust-ing-cab--ctrl">Quitar</span>' +
                '<span class="cust-ing-cab cust-ing-cab--ctrl">Actualmente</span>' +
                '<span class="cust-ing-cab cust-ing-cab--ctrl">Agrandar</span>' +
              '</div>';

            // Cada fila: miniatura · nombre · Quitar · Actualmente · Agrandar.
            //
            //   principal → "Quitar" lo quita (y lo devuelve) y "Agrandar"
            //               es ×2: UNA porción más.
            //   opcional  → "Quitar" lo quita (y lo devuelve) y "Agrandar"
            //               es − 1 +: porciones a voluntad.
            //
            // Los principales no llevan +/− libres: agrandarlos sin freno
            // no cambia la porción, cambia el plato.
            ingredientes.forEach(function(ing, idx) {
                var cantTxt = ing.cantidad + (ing.unidad ? ' ' + ing.unidad : '');
                var precioTxt = '';
                if (ing.precio_porcion > 0) {
                    precioTxt = ing.principal
                        ? ' · incluido en el plato'
                        : ' · +' + S.utils.formatBs(S.utils.usdToBs(ing.precio_porcion)) + ' por porción';
                }

                var botonAgrandar;
                if (ing.principal) {
                    botonAgrandar =
                        '<button type="button" class="cust-ing-btn cust-ing-btn--extra" ' +
                          'id="extra_ing_' + idx + '" data-ing="' + idx + '" data-estado="extra" ' +
                          'title="Una porción más" aria-pressed="false" ' +
                          'aria-label="Agrandar ' + ing.nombre + '" ' +
                          'onclick="window.cambiarEstadoIngrediente(' + idx + ', \'extra\')">&times;2</button>';
                } else {
                    botonAgrandar =
                        '<button type="button" class="cust-ing-btn cust-ing-btn--paso" ' +
                          'id="menos_ing_' + idx + '" data-ing="' + idx + '" data-estado="menos" ' +
                          'title="Quitar una porción" ' +
                          'aria-label="Quitar una porción de ' + ing.nombre + '" ' +
                          'onclick="window.cambiarEstadoIngrediente(' + idx + ', \'menos\')">&minus;</button>' +
                        '<span class="cust-ing-paso" id="porciones_ing_' + idx + '">1</span>' +
                        '<button type="button" class="cust-ing-btn cust-ing-btn--paso" ' +
                          'id="mas_ing_' + idx + '" data-ing="' + idx + '" data-estado="mas" ' +
                          'title="Agregar una porción" ' +
                          'aria-label="Agregar una porción de ' + ing.nombre + '" ' +
                          'onclick="window.cambiarEstadoIngrediente(' + idx + ', \'mas\')">+</button>';
                }

                html += '<div class="cust-ing">' +
                    // Miniatura del ingrediente. Sin foto no se pinta nada,
                    // pero la celda se queda: es una columna de la rejilla y
                    // sin ella el nombre se correría y la cabecera dejaría
                    // de coincidir con los datos.
                    // SIN loading="lazy": la lista arranca oculta y el
                    // navegador nunca baja una imagen perezosa que está
                    // dentro de algo no visible. Son 34 px ya en caché.
                    '<span class="cust-ing-mini-celda">' +
                      (ing.imagen ? '<img class="cust-ing-mini" src="' + ing.imagen + '" alt="">' : '') +
                    '</span>' +
                    '<div class="cust-ing-info">' +
                      '<div class="cust-ing-nombre">' + ing.nombre +
                        (ing.principal
                          ? ' <span style="color:var(--accent-text);font-size:.66rem">(define el plato)</span>'
                          : '') +
                      '</div>' +
                      '<span class="cust-ing-cant">' + cantTxt + precioTxt + '</span>' +
                    '</div>' +
                    '<button type="button" class="cust-ing-btn cust-ing-btn--quitar" ' +
                      'id="quitar_ing_' + idx + '" data-ing="' + idx + '" data-estado="quitar" ' +
                      'title="Quitar" aria-pressed="false" ' +
                      'aria-label="Quitar ' + ing.nombre + '" ' +
                      'onclick="window.cambiarEstadoIngrediente(' + idx + ', \'quitar\')">&minus;</button>' +
                    '<span class="cust-ing-estado" id="estado_ing_' + idx + '">Normal</span>' +
                    '<div class="cust-ing-agrandar">' + botonAgrandar + '</div>' +
                  '</div>';
            });

            // Cierre de la lista. Vive DENTRO de #ingredientesList, que es
            // justo lo que se muestra y se oculta con "Personalizar".
            html += '<p class="cust-ing-nota">¿Quieres agrandar, quitarle a tu pedido o agregarle algo más?</p>';
        }

        html += '</div>' +   // #ingredientesList
                '</div>' +   // .cust-cuerpo
                '</div>';    // .cust-layout

        body.innerHTML = html;

        // Cada fila arranca pintada desde el modelo, no solo desde el HTML.
        //
        // El marcado ya escribe «Normal», pero hay cosas que solo sabe el
        // modelo: en 1 porción el botón − del opcional tiene que anunciarse
        // como no disponible desde el primer momento, no después del primer
        // toque. Una sola fuente de verdad para lo que se ve.
        ingredientes.forEach(function (_, i) { _pintarEstadoIng(i); });

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

        var campoQty = document.getElementById('customizeQty');
        if (campoQty) {
            // Mientras escribe: solo dígitos y sin pasarse del stock.
            campoQty.addEventListener('input', function () {
                var limpio = this.value.replace(/[^0-9]/g, '');
                var tope = _topeCantidad();

                // Si escribe más de lo que hay, se recorta al tope en el acto.
                // No se espera a que termine: si dejáramos 9999 en pantalla,
                // el precio mostraría una cifra imposible mientras escribe.
                var n = parseInt(limpio, 10);
                if (!isNaN(n) && tope > 0 && n > tope) {
                    limpio = String(tope);
                }
                if (this.value !== limpio) this.value = limpio;

                // EL CAMPO VACÍO SE RESPETA MIENTRAS ESCRIBE.
                //
                // Si al borrar se rellenara solo con "1", el cliente no
                // podría escribir un número nuevo: cada retroceso devolvería
                // el 1, y tendría que seleccionar todo antes de teclear. Es
                // incómodo y se siente roto.
                //
                // Mientras esté vacío solo se actualiza el precio si queda un
                // número válido; la cantidad buena se conserva y se corrige
                // al salir del campo (blur).
                if (limpio === '') return;

                _reflejarCantidad();
            });

            // Al salir del campo: si quedó vacío o en cero, vuelve a 1.
            // Un campo vacío dejaría el total en NaN y el botón Añadir
            // agregaría "NaN" al carrito.
            campoQty.addEventListener('blur', function () {
                var n = parseInt(this.value, 10);
                if (isNaN(n) || n < 1) n = 1;
                var tope = _topeCantidad();
                if (tope > 0 && n > tope) n = tope;
                this.value = String(n);
                _reflejarCantidad();
            });

            // Enter equivale a confirmar el número, no a enviar nada: sin esto
            // el navegador podría disparar el envío del formulario contenedor.
            campoQty.addEventListener('keydown', function (e) {
                if (e.key === 'Enter') { e.preventDefault(); this.blur(); }
            });
        }

        // La X cierra la ventana.
        var cerrarEl = document.getElementById('custCerrar');
        if (cerrarEl) {
            cerrarEl.addEventListener('click', function() {
                modal.classList.remove('active');
            });
        }

        // ── LA ESTRELLA NO CIERRA LA VENTANA ──
        //
        // Marcar un favorito no es una decisión irrelevante que se pueda
        // tirar: si el cliente abrió el plato para verlo, después puede
        // querer pedirlo. Antes de esto la ventana no tenía estrella; al
        // añadirla, cerrarla en cada toque habría echado al cliente justo
        // cuando decide guardar algo para después.
        //
        // Los tres estados visibles se actualizan AQUÍ y no re-renderizando:
        // volver a pintar la ventana borraría la cantidad escrita y los
        // ingredientes marcados.
        //
        // `stopPropagation` NO es para el zoom de la foto (la estrella es su
        // hermana, no su hija, así que el toque no llegaría hasta ella), sino
        // para no depender de ese detalle de la maqueta. El día que alguien
        // mueva el botón dentro de la foto, sigue funcionando.
        var favEl = document.getElementById('custFavBtn');
        if (favEl) {
            favEl.addEventListener('click', function(e) {
                e.stopPropagation();
                if (typeof window.toggleFavorito !== 'function') return;
                window.toggleFavorito(item.id);

                // Se relee el estado desde la fuente de verdad en vez de
                // invertir una variable local: si `toggleFavorito` no llegó
                // a guardar, el botón no miente.
                var ahoraEsFav = typeof window.esFavorito === 'function'
                    ? !!window.esFavorito(item.id)
                    : !favEl.classList.contains('active');

                if (ahoraEsFav) favEl.classList.add('active');
                else favEl.classList.remove('active');

                favEl.setAttribute('aria-pressed', ahoraEsFav ? 'true' : 'false');
                var nuevaEtiqueta = ahoraEsFav ? 'Quitar de favoritos' : 'Agregar a favoritos';
                favEl.setAttribute('aria-label', nuevaEtiqueta);
                // El globo de ayuda dice lo mismo que la etiqueta: si no se
                // sincroniza, sigue ofreciendo «Agregar» cuando ya está.
                favEl.setAttribute('data-tooltip', nuevaEtiqueta);
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
    // PORCIONES POR INGREDIENTE: { indice: numero }
    //
    //   0 → quitado      1 → normal      2 o más → agrandado
    //
    // Antes era texto ('normal' | 'quitar' | 'extra'), y por eso el
    // opcional no podía pasar de ×2: no había dónde escribir ×3. Con un
    // número, las porciones extra son simplemente (n − 1) y agregar una más
    // no obliga a tocar las cuentas del precio ni del carrito.
    var _estadosIng = {};

    /** Porciones pedidas de un ingrediente. 1 (normal) si todavía no hay dato. */
    function _porciones(idx) {
        var n = _estadosIng[idx];
        if (typeof n !== 'number' || !isFinite(n) || n < 0) return 1;
        return Math.floor(n);
    }

    /** Lo que se lee en la columna «Actualmente». */
    function _textoEstado(n) {
        if (n === 0) return 'Sin';
        if (n === 1) return 'Normal';
        return '\u00d7' + n;
    }

    /**
     * Pinta una fila según las porciones que tenga guardadas.
     *
     * Se hace por id y no re-renderizando la lista: volver a pintar la
     * ventana borraría la cantidad escrita y los demás ingredientes ya
     * marcados.
     */
    function _pintarEstadoIng(idx) {
        var n = _porciones(idx);

        // El texto ES el segundo indicador de estado: «Sin» y «×2» se leen
        // sin depender del color, que es lo que pide WCAG 1.4.1.
        var etiqueta = document.getElementById('estado_ing_' + idx);
        if (etiqueta) {
            etiqueta.textContent = _textoEstado(n);
            if (n === 0) etiqueta.classList.add('cust-ing-estado--sin');
            else etiqueta.classList.remove('cust-ing-estado--sin');
            if (n >= 2) etiqueta.classList.add('cust-ing-estado--mas');
            else etiqueta.classList.remove('cust-ing-estado--mas');
        }

        var botonQuitar = document.getElementById('quitar_ing_' + idx);
        if (botonQuitar) {
            if (n === 0) {
                botonQuitar.classList.add('activo');
                botonQuitar.setAttribute('aria-pressed', 'true');
            } else {
                botonQuitar.classList.remove('activo');
                botonQuitar.setAttribute('aria-pressed', 'false');
            }
        }

        var botonExtra = document.getElementById('extra_ing_' + idx);
        if (botonExtra) {
            if (n >= 2) {
                botonExtra.classList.add('activo');
                botonExtra.setAttribute('aria-pressed', 'true');
            } else {
                botonExtra.classList.remove('activo');
                botonExtra.setAttribute('aria-pressed', 'false');
            }
        }

        var numero = document.getElementById('porciones_ing_' + idx);
        if (numero) {
            numero.textContent = String(n < 1 ? 1 : n);
            if (n >= 2) numero.classList.add('cust-ing-paso--mas');
            else numero.classList.remove('cust-ing-paso--mas');
        }

        // En 1 no hay nada que bajar: el botón se apaga para que no parezca
        // roto. Quitar el ingrediente entero es la columna «Quitar», que
        // está justo a la izquierda.
        var botonMenos = document.getElementById('menos_ing_' + idx);
        if (botonMenos) {
            if (n <= 1) botonMenos.setAttribute('aria-disabled', 'true');
            else botonMenos.removeAttribute('aria-disabled');
        }
    }
    // La lista de ingredientes del plato abierto, con su porción y precio.
    var _ingredientesActuales = [];

    function selectCompleto() {
        _isCompleto = true;
        // Volver a "Completo" borra cualquier extra o quitado anterior.
        Object.keys(_estadosIng).forEach(function (k) { _estadosIng[k] = 1; });
        Object.keys(_estadosIng).forEach(function (k) { _pintarEstadoIng(parseInt(k, 10)); });
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

    /**
     * Máximo de unidades que se pueden pedir de este plato.
     *
     * Se lee del stock precalculado, que es la misma fuente que usa la
     * tarjeta para decir "415 disponibles". Devuelve 0 cuando no hay dato:
     * en ese caso NO se limita, porque inventar un tope bloquearía la venta.
     */
    function _topeCantidad() {
        var item = currentCustomizeItem;
        if (!item) return 0;
        var stock = (window._stockPrecalculado || {})[item.id];
        if (typeof stock !== 'number') return 0;
        // Un plato agotado no se puede pedir; el tope real es al menos 1 para
        // no dejar el campo en 0 y confundir al cliente.
        return stock > 0 ? Math.floor(stock) : 1;
    }

    /**
     * Lee el número escrito por el cliente y lo aplica.
     *
     * Antes la cantidad solo cambiaba con el "+" y el "−": para 30 piezas
     * había que tocar 29 veces.
     */
    function _reflejarCantidad() {
        var el = document.getElementById('customizeQty');
        var n = el ? parseInt(el.value, 10) : _currentQty;

        if (isNaN(n) || n < 1) n = 1;
        var tope = _topeCantidad();
        if (tope > 0 && n > tope) n = tope;

        _currentQty = n;
        if (el && el.value !== String(n)) el.value = String(n);
        calcularPrecioPersonalizado();
    }
    window._reflejarCantidad = _reflejarCantidad;

    function actualizarCantidadPersonalizacion(delta) {
        var tope = _topeCantidad();
        var nueva = Math.max(1, _currentQty + delta);
        if (tope > 0 && nueva > tope) nueva = tope;
        _currentQty = nueva;

        var el = document.getElementById('customizeQty');
        if (el) {
            // El campo puede ser un <input> (nuevo) o un <span> (versión
            // vieja en caché). Se escribe en el atributo correcto de cada uno
            // para no romper si un cliente tiene el HTML anterior guardado.
            if ('value' in el && el.tagName === 'INPUT') el.value = String(_currentQty);
            else el.textContent = _currentQty;
        }
        calcularPrecioPersonalizado();
    }
    window.actualizarCantidadPersonalizacion = actualizarCantidadPersonalizacion;
    S.modules.customize.actualizarCantidadPersonalizacion = actualizarCantidadPersonalizacion;

    /**
     * ¿Con `idx` en `porciones` quedarían TODOS los ingredientes en ×2?
     *
     * Es exactamente el caso que el carrito convierte en dos platos, así
     * que el aviso y la conversión tienen que mirar lo mismo. Con alguno
     * en ×3 ya no es "el plato duplicado" y no se avisa ni se convierte.
     */
    function _seriaExtraDeTodo(idx, porciones) {
        if (!_ingredientesActuales.length) return false;
        var nuevo = (typeof porciones === 'number') ? porciones : 2;
        for (var i = 0; i < _ingredientesActuales.length; i++) {
            var n = (i === idx) ? nuevo : _porciones(i);
            if (n !== 2) return false;
        }
        return true;
    }

    /**
     * Cambia las porciones de un ingrediente.
     *
     *   'quitar' → lo quita (0); tocado otra vez, lo devuelve (1). Vale para
     *              TODOS, también para los principales: es la regla nueva.
     *   'extra'  → ×2 y de vuelta a normal. Es el único aumento de los
     *              principales: una porción más, no una cantidad libre.
     *   'mas'    → una porción más, sin tope. Solo opcionales.
     *   'menos'  → una porción menos, con piso en 1. Solo opcionales.
     *
     * Una "porción" es la MISMA cantidad que ya lleva el plato: si lleva
     * 25 g de salmón, una porción extra son otros 25 g, y se cobra.
     */
    window.cambiarEstadoIngrediente = function cambiarEstadoIngrediente (idx, accion) {
        var ing = _ingredientesActuales[idx];
        if (!ing) return;

        var actual = _porciones(idx);
        var nuevo;
        if (accion === 'quitar') {
            // Tocar de nuevo el mismo botón lo devuelve: es un interruptor.
            nuevo = (actual === 0) ? 1 : 0;
        } else if (accion === 'extra') {
            nuevo = (actual >= 2) ? 1 : 2;
        } else if (accion === 'mas') {
            // De quitado no se salta a ×2: vuelve a normal y desde ahí sube.
            nuevo = (actual === 0) ? 1 : actual + 1;
        } else if (accion === 'menos') {
            // Con el ingrediente quitado no hay porciones que bajar: el −
            // lo devuelve igual que el +, en vez de dejarlo trabado.
            nuevo = (actual === 0) ? 1 : Math.max(1, actual - 1);
        } else {
            return;
        }
        if (nuevo === actual) return;

        // AVISO ANTES DEL SALTO DE PRECIO.
        //
        // Pedir extra de TODOS los ingredientes equivale a otro plato. El
        // precio no salta de a porciones: salta al doble del plato completo.
        // Medido en el Dragon Roll: 4 extras cuestan ~Bs. 14.000 y el quinto
        // lleva el plato a Bs. 23.024 de golpe.
        //
        // Sin aviso, el cliente ve el precio duplicarse al tocar el último
        // boton y abandona. Se le explica antes, con los numeros a la vista.
        if (nuevo >= 2 && actual < 2 && _seriaExtraDeTodo(idx, nuevo)) {
            var precioPlato = Math.round(S.utils.usdToBs(currentCustomizeItem.precio || 0));
            var precioDoble = precioPlato * 2;
            var seguir = confirm(
                'Esto convierte el pedido en DOS platos:\n\n' +
                'Pediste extra de todos los ingredientes de ' +
                (currentCustomizeItem.nombre || 'este plato') + ', y eso equivale ' +
                'a un plato más, no a un plato agrandado.\n\n' +
                'Precio: ' + S.utils.formatBs(precioPlato * _currentQty) +
                '  ->  ' + S.utils.formatBs(precioDoble * _currentQty) + '\n\n' +
                'La cocina va a preparar ' + (_currentQty * 2) + ' platos.\n' +
                '¿Seguir?'
            );
            if (!seguir) return;
        }

        _estadosIng[idx] = nuevo;
        _pintarEstadoIng(idx);
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
            var n = _porciones(i);

            if (n === 0) {
                _quitados.push(ing.nombre);
                descuento += ing.precio_porcion;
            } else if (n > 1) {
                // Cada porción de más se cobra: ×3 son dos porciones extra.
                var deMas = n - 1;
                recargo += ing.precio_porcion * deMas;
                extras += deMas;
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
            // El verde sale del token del tema: el #4ade80 fijo se leía a
            // 1,24:1 sobre el papel del tema claro.
            if (extras > 0) detalle = ' <span style="font-size:.72rem;color:var(--cust-tinta-agrandar)">(+' + extras + ' extra' + (extras > 1 ? 's' : '') + ')</span>';
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
        // Mismo contenido que `agregados`, en texto: la etiqueta del carrito
        // dice cuántas porciones extra van, no solo el nombre.
        var agregadosTexto = [];

        Object.keys(_estadosIng).forEach(function (k) {
            var i = parseInt(k, 10);
            var ing = _ingredientesActuales[i];
            if (!ing) return;
            var n = _porciones(i);
            if (n === 0) {
                quitados.push(ing.nombre);
                descuento += ing.precio_porcion;
            } else if (n > 1) {
                // Lo que llega a la cocina es la CANTIDAD REAL de más, no
                // "una porción": con 3 porciones se agregan 2.
                // Se redondea a milésimas para que 0,06 × 3 no viaje como
                // 0,18000000000000002.
                var deMas = n - 1;
                agregados.push({
                    nombre: ing.nombre,
                    cantidad: Math.round(ing.cantidad * deMas * 1000) / 1000,
                    unidad: ing.unidad
                });
                agregadosTexto.push(ing.nombre + (deMas > 1 ? ' \u00d7' + deMas : ''));
                recargo += ing.precio_porcion * deMas;
            }
        });

        var descuentoAplicado = _descuentaAlQuitar() ? descuento : 0;
        var precioUSD = Math.max(0.01, (item.precio || 0) - descuentoAplicado + recargo);
        var precioBs = S.utils.usdToBs(precioUSD);

        var hayExtra = agregados.length > 0;

        // Quién avisa al cliente: el caso "extra de todo" tiene su propio
        // mensaje (explica que son DOS platos), así que se marca aquí para
        // que el aviso genérico de abajo no lo tape con otro igual.
        var _avisoPropio = false;

        var etiqueta;
        if (_isCompleto && !hayExtra) {
            etiqueta = null;
        } else {
            // La etiqueta dice QUÉ cambió, no la palabra fija "Personalizado".
            var partes = [];
            if (quitados.length) partes.push('Sin ' + quitados.join(', '));
            if (hayExtra) partes.push('Con extra de ' + agregadosTexto.join(', '));
            etiqueta = partes.join(' · ');
        }

        // REGLA DEL DUEÑO: pedir extra de TODOS los ingredientes equivale a
        // otro plato completo. En vez de un plato "con todo duplicado", se
        // agregan DOS unidades del plato normal. Es más claro en el carrito
        // y además es lo que la cocina va a preparar de verdad.
        // Exactamente 2 en todos: es el único caso en que «dos platos»
        // reproduce lo que el cliente pidió. Con alguno en 3 o más, el plato
        // se cobra por porciones y no se pierde comida al cambiarlo.
        var todosEnExtra = _ingredientesActuales.length > 0 &&
            Object.keys(_estadosIng).length === _ingredientesActuales.length &&
            _ingredientesActuales.every(function (_, i) { return _porciones(i) === 2; });

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
                _avisoPropio = true;
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
        }

        guardarCarrito();
        actualizarCarritoBadge();
        actualizarCarritoUI();
        document.getElementById('customizeModal').classList.remove('active');
        // UN SOLO AVISO, DESPUÉS DE GUARDAR.
        //
        // Antes se avisaba dentro de cada rama (completo / extra de todo /
        // personalizado) y OTRA VEZ aquí, así que al añadir un plato
        // personalizado saltaban dos toasts idénticos. Se deja solo este,
        // que es el que corre cuando el carrito ya se guardó de verdad.
        //
        // El caso "extra de todo" conserva su mensaje propio más arriba,
        // porque explica que se van a preparar DOS platos; este de aquí se
        // salta en ese caso para no taparlo.
        if (!_avisoPropio && window.mostrarToast) {
            window.mostrarToast('✅ ' + item.nombre + ' agregado al carrito', 'success');
        }
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
