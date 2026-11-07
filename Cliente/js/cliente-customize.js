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

    /* ── LA FOTO APAIZADA ENSANCHA SU PROPIA COLUMNA ──
     *
     * Una fila de fotos de plato mezcla formatos: unas vienen de una cámara
     * apaisada (16:9) y otras de un teléfono vertical (3:4). En pantalla
     * ancha la columna de la foto medía 280 px fijos, así que una foto
     * apaisada se recortaba por los lados y solo se veía el centro del plato.
     *
     * Aquí solo se MIDE. La cuenta del ancho vive en el CSS, que es donde
     * se decide el tamaño: el JS le pasa la proporción real de la foto en
     * `--cust-foto-ratio` y el CSS decide cuánto ensanchar, con su tope.
     * Separarlo así permite que el modo teléfono no cambie: allí la foto
     * ocupa todo el ancho y la proporción no se usa.
     *
     * Umbral 1.05 y no 1.00: un cuadrado exacto (1.00) o una foto casi
     * cuadrada (1.02) al ensancharse ganarían dos píxeles y solo movían la
     * ventana sin mostrar nada más. Por debajo de 1.05 se queda el diseño
     * de siempre.
     */
    var UMBRAL_FOTO_HORIZONTAL = 1.05;

    /** Devuelve la ventana a su diseño de siempre: sin ensanche ni proporción.
     *
     * Se llama al abrir (para no arrastrar la foto del plato anterior) y
     * cuando la foto falla o resulta vertical.
     *
     * `contenedor.style` se comprueba antes de tocarlo porque esta función
     * también corre en pruebas con un elemento de mentira. En un navegador
     * siempre existe, así que la comprobación no cuesta nada y evita que
     * una ventana sin `<style>` rompa la apertura del platillo entera. */
    function _limpiarAspectoFoto(contenedor) {
        if (!contenedor) return;
        contenedor.classList.remove('cust-foto-horizontal');
        if (contenedor.style) contenedor.style.removeProperty('--cust-foto-ratio');
    }

    /** Mide la foto ya pintada y, si es apaisada, ensancha su columna.
     *
     * Hay dos caminos y hacen falta los dos:
     *   · `load`  → la foto todavía venía en camino;
     *   · `complete` → la foto ya estaba en caché y el `load` ocurrió ANTES
     *     de enganchar el oyente. Es el caso normal, porque la ventana usa
     *     la MISMA url optimizada que la tarjeta que el cliente acaba de
     *     tocar. Sin esta comprobación el arreglo no se vería casi nunca.
     */
    function _medirAspectoFoto(contenedor) {
        var img = document.getElementById('customizeFoto');
        if (!img || !contenedor) return;

        function aplicar() {
            var ancho = img.naturalWidth || 0;
            var alto = img.naturalHeight || 0;
            // Sin medidas no hay proporción: se queda el diseño de siempre.
            if (!ancho || !alto) { _limpiarAspectoFoto(contenedor); return; }

            var proporcion = ancho / alto;
            if (!(proporcion > UMBRAL_FOTO_HORIZONTAL)) {
                _limpiarAspectoFoto(contenedor);
                return;
            }
            contenedor.classList.add('cust-foto-horizontal');
            if (contenedor.style) {
                contenedor.style.setProperty('--cust-foto-ratio', proporcion.toFixed(4));
            }
        }

        img.addEventListener('load', aplicar);
        // La foto rota no se marca: sin medidas reales no hay ensanche que
        // hacer, y el diseño de siempre ya se ve bien.
        img.addEventListener('error', function () { _limpiarAspectoFoto(contenedor); });

        if (img.complete) aplicar();
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
                  '<div><strong style="color:var(--customize-text)">Personalizar platillo</strong><br>' +
                    '<small style="color:var(--customize-subtext)">Quitar alguno, o pedir extra</small></div>' +
                '</div>' +
              '</div>' +
            '</div>' +

            '<div id="ingredientesList" style="display:none">';

        // LA NOTA YA NO VA AQUÍ.
        //
        // Antes abría la lista: «¿Quieres agrandar…? Tienes:» se leía justo
        // debajo de la opción y se iba con el scroll del cuerpo, así que
        // para verla había que bajar, y aun así terminaba pegada al pie.
        //
        // Ahora vive en su propia franja, hermana del cuerpo y del pie (ver
        // #custFranjaNota en index.html). Esta función NO reescribe su
        // texto: solo le pone o le quita la clase `activa`.
        //
        // La CABECERA DE COLUMNAS se queda aquí, dentro de la lista, y no
        // sube a la franja: cabecera y filas comparten `--cust-ing-cols`
        // para que cada rótulo caiga encima de su botón. Separadas, el
        // rótulo dejaría de señalar la columna que nombra, y al hacer
        // scroll la cabecera se quedaría clavada señalando filas que ya
        // pasaron.

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
                // La línea de ayuda se repinta al cambiar porciones (ver
                // _pintarEstadoIng): por eso cada trozo lleva su id.
                var cantTxt = _cantidadEfectiva(ing, 1) + ' ' + _abrevUnidad(ing.unidad);
                // Al abrir el platillo TODO está en su estado original: no
                // hay incremento que anunciar, así que la línea va limpia.
                // El «en este plato» lo pinta _pintarEstadoIng en cuanto el
                // cliente agranda algo.
                var precioTxt = '';

                var botonAgrandar;
                if (ing.principal) {
                    botonAgrandar =
                        '<button type="button" class="cust-ing-btn cust-ing-btn--extra" ' +
                          'id="extra_ing_' + idx + '" data-ing="' + idx + '" data-estado="extra" ' +
                          'title="Una porción más" aria-pressed="false" ' +
                          'aria-label="Agrandar ' + ing.nombre + '" ' +
                          'onclick="window.cambiarEstadoIngrediente(' + idx + ', \'extra\')">&times;2</button>';
                } else {
                    // SOLO el +. El − de esta columna se retiró: para bajar
                    // porciones se usa el − de la columna «Quitar», que ya
                    // hace de decremento y termina en «Sin».
                    //
                    // El número de porciones NO se repite aquí: la columna
                    // «Actualmente» ya lo dice («1», «×2», «×3»). Dos veces
                    // el mismo dato en la misma fila solo confunde.
                    botonAgrandar =
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
                      '<span class="cust-ing-cant">' +
                        '<span id="cantidad_ing_' + idx + '">' + cantTxt + '</span>' +
                        '<span id="precio_ing_' + idx + '">' + precioTxt + '</span>' +
                      '</span>' +
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

        }

        html += '</div>' +   // #ingredientesList
                '</div>' +   // .cust-cuerpo
                '</div>';    // .cust-layout

        body.innerHTML = html;

        // La ventana arranca en «Completo», así que la franja también: el
        // plato recién abierto no tiene nada que personalizar todavía.
        //
        // Se apaga SIEMPRE al abrir, y no según `_isCompleto`, porque ese
        // valor es el del plato anterior: si el cliente personalizó uno y
        // cerró con la X, quedaba en false y el siguiente plato nacía con
        // la franja encendida y la lista apagada.
        _pintarFranjaNota(false);

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

        // LA PROPORCIÓN SE MIDE EN CADA APERTURA, DESDE CERO.
        //
        // Si el cliente abre un plato apaisado y después uno vertical, el
        // ensanche del primero no puede quedarse pegado al segundo: la
        // clase y la variable se borran antes de medir la foto nueva.
        _limpiarAspectoFoto(contenedor);
        _medirAspectoFoto(contenedor);

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

        // ── ARRASTRAR SOBRE LA FOTO DESPLAZA LA LISTA ──
        //
        // En dos columnas la foto ya no scrollea (está fija a la izquierda)
        // y el único que se desplaza es .cust-cuerpo. Pero el dedo no sabe
        // eso: quien arrastra sobre la imagen espera que la lista baje.
        // Sin este puente, arrastrar ahí no hace NADA y parece que la
        // ventana se trabó.
        //
        // SOLO EN DOS COLUMNAS. En el teléfono la foto va arriba y scrollea
        // con la ventana entera; ahí no hace falta ningún puente.
        //
        // Se engancha al contenedor de la foto (.cust-foto-wrap), no a la
        // imagen: así también responde al arrastre sobre la estrella de
        // favoritos, que vive en esa misma esquina.
        var fotoWrap = modal.querySelector('.cust-foto-wrap');
        var cuerpoDatos = modal.querySelector('.cust-cuerpo');
        // Se comprueba que ambos elementos existan Y que sepan escuchar:
        // si el contenedor de la foto no está, o el DOM no trae la API
        // completa, se omite el puente sin romper la apertura del platillo.
        // El resto de la ventana —cantidad, ingredientes, añadir— sigue
        // funcionando igual.
        if (fotoWrap && cuerpoDatos &&
            typeof fotoWrap.addEventListener === 'function' &&
            cuerpoDatos.style !== undefined) {
            var reenviarScroll = function (delta) {
                if (!delta) return;
                cuerpoDatos.scrollTop += delta;
            };

            // Ratón y rueda: `deltaY` ya viene en píxeles.
            fotoWrap.addEventListener('wheel', function (e) {
                // Solo cuando de verdad hay dos columnas. Si la foto está
                // arriba (teléfono), el scroll normal de la ventana manda.
                if (window.innerWidth < 600) return;
                reenviarScroll(e.deltaY);
                e.preventDefault();
            }, { passive: false });

            // Dedo: se calcula el desplazamiento entre el toque anterior y
            // el actual. El toque (sin arrastre) NO entra aquí, así que el
            // click que abre el visor ampliado sigue funcionando.
            var ultimoY = null;
            fotoWrap.addEventListener('touchstart', function (e) {
                if (window.innerWidth < 600) return;
                ultimoY = e.touches.length === 1 ? e.touches[0].clientY : null;
            }, { passive: true });

            fotoWrap.addEventListener('touchmove', function (e) {
                if (window.innerWidth < 600 || ultimoY === null || e.touches.length !== 1) return;
                var y = e.touches[0].clientY;
                reenviarScroll(ultimoY - y);
                ultimoY = y;
                // Sin esto el navegador cancela el gesto y además desplaza
                // el overlay entero. El `touch-action:pan-y` del CSS es lo
                // que permite que el gesto llegue hasta aquí.
                if (e.cancelable) e.preventDefault();
            }, { passive: false });

            fotoWrap.addEventListener('touchend', function () { ultimoY = null; }, { passive: true });
            fotoWrap.addEventListener('touchcancel', function () { ultimoY = null; }, { passive: true });
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

    // Se exponen para que las pruebas puedan afirmar sobre las porciones y la
    // regla de «extra de todo» EJECUTANDO el código real, sin inventarse una
    // copia de la lógica que podría divergir de la de producción.
    window._porcionesParaPrueba = _porciones;

    /** Lo que se lee en la columna «Actualmente». */
    function _textoEstado(n) {
        if (n === 0) return 'Sin';
        // En 1 se muestra «1», no «Normal»: el número es el mismo lenguaje
        // que el resto de la columna («×2», «×3») y se lee de un vistazo.
        if (n === 1) return '1';
        return '\u00d7' + n;
    }

    /**
     * Abrevia la unidad para que la línea de ayuda quepa en el teléfono.
     *
     * Los valores reales que existen en la base son tres (el admin solo
     * ofrece esos): unidades, kilogramos y litros. Los demás están por si
     * mañana se agregan, y cualquier valor desconocido se devuelve TAL CUAL:
     * inventar una abreviatura sería peor que mostrar la palabra entera.
     */
    var _ABREV_UNIDAD = {
        'unidades': 'unid',
        'kilogramos': 'Kg',
        'gramos': 'g',
        'litros': 'L',
        'mililitros': 'ml'
    };

    function _abrevUnidad(u) {
        if (!u) return '';
        var clave = String(u).trim().toLowerCase();
        return _ABREV_UNIDAD.hasOwnProperty(clave) ? _ABREV_UNIDAD[clave] : String(u).trim();
    }
    window._abrevUnidadParaPrueba = _abrevUnidad;

    /**
     * Lo que el cliente paga DE MÁS por las porciones extra de un ingrediente.
     *
     * UNA SOLA FÓRMULA, usada en los dos sitios: el total del plato y la
     * línea de ayuda de cada ingrediente. Si se escribieran por separado,
     * un día uno cambiaría y el otro no, y el cliente vería un número en la
     * fila y otro en el total.
     */
    function _recargoDeIngrediente(ing, n) {
        if (!ing || typeof n !== 'number' || n <= 1) return 0;
        return (ing.precio_porcion || 0) * (n - 1);
    }
    window._recargoDeIngredienteParaPrueba = _recargoDeIngrediente;

    /** Cantidad efectiva: lo que lleva el plato con las porciones pedidas. */
    function _cantidadEfectiva(ing, n) {
        if (!ing) return 0;
        var base = Number(ing.cantidad) || 0;
        var porciones = (typeof n === 'number') ? n : 1;
        // 3 decimales y fuera: 0.1 × 3 daba 0.30000000000000004.
        return Math.round(base * porciones * 1000) / 1000;
    }
    window._cantidadEfectivaParaPrueba = _cantidadEfectiva;

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

        // En «Sin» el − de Quitar no tiene a dónde bajar, así que se apaga:
        // un botón que se puede pulsar y no hace nada parece roto. Se apaga
        // visualmente pero NO se deshabilita el elemento, para que el lector
        // de pantalla siga anunciando qué es.
        if (botonQuitar) {
            if (n === 0) botonQuitar.setAttribute('aria-disabled', 'true');
            else botonQuitar.removeAttribute('aria-disabled');
            if (n === 0) botonQuitar.classList.add('cust-ing-btn--inerte');
            else botonQuitar.classList.remove('cust-ing-btn--inerte');
        }

        // ── La línea de ayuda se repinta con las porciones elegidas ──
        //
        // Antes se pintaba una sola vez al abrir la ventana: el cliente subía
        // a ×3 y seguía leyendo la cantidad de una porción mientras el precio
        // ya había cambiado. Los dos números tienen que moverse juntos.
        var ing = _ingredientesActuales[idx];
        var numEl = document.getElementById('cantidad_ing_' + idx);
        if (numEl && ing) {
            numEl.textContent = _cantidadEfectiva(ing, n) + ' ' + _abrevUnidad(ing.unidad);
        }
        var precEl = document.getElementById('precio_ing_' + idx);
        if (precEl && ing) {
            var recargo = _recargoDeIngrediente(ing, n);
            // «en este plato» solo aparece cuando hay algo que contar:
            // cuando el cliente AGRANDA. En el platillo original y sin tocar
            // nada, la línea se queda limpia: repetir «en este plato» en cada
            // ingrediente llenaba la lista de texto que no aporta nada.
            if (recargo > 0) {
                precEl.textContent = ' · +' + S.utils.formatBs(S.utils.usdToBs(recargo)) + ' en este plato';
            } else {
                precEl.textContent = '';
            }
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
        // La franja acompaña a la lista: sin «Personalizar platillo» no hay
        // nada que anunciar, y en «Completo» solo ocuparía alto.
        _pintarFranjaNota(false);

        _quitados = [];
        calcularPrecioPersonalizado();
    }
    window.selectCompleto = selectCompleto;
    S.modules.customize.selectCompleto = selectCompleto;

    /** Enciende o apaga la franja de la nota que vive sobre el pie.
     *
     * La franja es hermana de `.modal-body` y de `.modal-footer`, no hija de
     * ellos: su texto está en el HTML y aquí solo se controla si se ve.
     *
     * SE USA UNA CLASE, NO `style.display`. La franja solo debe verse en
     * teléfono vertical, y esa condición vive en una media query del CSS.
     * Un `display` escrito en línea desde aquí gana sobre cualquier media
     * query, así que en horizontal aparecería igual. La clase deja decidir
     * al CSS, que es el que sabe el ancho y la orientación.
     *
     * Si la franja no existe (HTML viejo en caché) no pasa nada: la ventana
     * sigue funcionando sin la nota. Los dos `if` cubren el caso de un DOM
     * de prueba que no la monte.
     */
    function _pintarFranjaNota(visible) {
        var franja = document.getElementById('custFranjaNota');
        if (!franja || !franja.classList) return;
        if (visible) franja.classList.add('activa');
        else franja.classList.remove('activa');
    }

    function selectPersonalizado() {
        _isCompleto = false;
        document.getElementById('personalizadoOption').classList.add('activo');
        document.getElementById('personalizadoCircle').classList.add('activo');
        document.getElementById('completoOption').classList.remove('activo');
        document.getElementById('completoCircle').classList.remove('activo');
        document.getElementById('ingredientesList').style.display = 'block';
        _pintarFranjaNota(true);
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
    /**
     * ¿Agrandar `idx` dejaría TODOS los ingredientes PRINCIPALES agrandados?
     *
     * REGLA DEL DUEÑO: el «extra de todo» que equivale a otro plato se mide
     * SOLO sobre los principales, no sobre los opcionales.
     *
     * Tiene sentido: agrandar todos los principales es pedir dos platos
     * completos, porque esos son los que definen el plato. Agrandar además
     * el aguacate o el sésamo es un capricho, no otro plato.
     *
     * Antes miraba TODOS los ingredientes. Con un plato de 2 principales y
     * 2 opcionales, el cliente podía agrandar todo lo que definiría el
     * plato y NO se le avisaba, porque los opcionales seguían en ×1.
     */
    function _seriaExtraDeTodo(idx, porciones) {
        if (!_ingredientesActuales.length) return false;
        var nuevo = (typeof porciones === 'number') ? porciones : 2;
        var hayPrincipal = false;

        for (var i = 0; i < _ingredientesActuales.length; i++) {
            if (!_ingredientesActuales[i].principal) continue;   // se salta los opcionales
            hayPrincipal = true;
            var n = (i === idx) ? nuevo : _porciones(i);
            if (n < 2) return false;
        }
        return hayPrincipal;
    }

    /**
     * Cambia las porciones de un ingrediente.
     *
     *   'quitar' → EL DECREMENTO. En un opcional baja una porción cada vez
     *              (×3 → ×2 → 1 → Sin) y en «Sin» ya no hace nada: se vuelve
     *              con el +. En un principal NO quita nada y avisa por qué.
     *   'extra'  → ×2 y de vuelta a 1. Es el único aumento de los
     *              principales: una porción más, no una cantidad libre.
     *   'mas'    → una porción más, sin tope. Solo opcionales, y es el único
     *              camino de vuelta desde «Sin» (0 → 1).
     *
     * Ya NO existe 'menos': el − de la columna Agrandar se retiró porque
     * había dos maneras de bajar la misma cantidad y una de ellas sobraba.
     *
     * Una "porción" es la MISMA cantidad que ya lleva el plato: si lleva
     * 25 g de salmón, una porción extra son otros 25 g, y se cobra.
     */
    window._seriaExtraDeTodoParaPrueba = _seriaExtraDeTodo;

    window.cambiarEstadoIngrediente = function cambiarEstadoIngrediente (idx, accion) {
        var ing = _ingredientesActuales[idx];
        if (!ing) return;

        var actual = _porciones(idx);
        var nuevo;
        if (accion === 'quitar') {
            // UN INGREDIENTE PRINCIPAL NO SE PUEDE QUITAR.
            //
            // Es la regla de negocio del dueño, y es correcta: sin el arroz
            // y sin el atún, un Nigiri deja de ser un Nigiri.
            //
            // El defecto NO era la regla: era que se aplicaba en silencio.
            // El botón − respondía al toque y no pasaba nada, así que parecía
            // que la app estaba rota. La regla se queda; lo que se añade es
            // la explicación.
            //
            // Se permite QUITARLO (volver de "Sin" a normal) si ya estaba
            // quitado, para que el botón nunca quede trabado.
            // ── PERO SI ESTÁ AGRANDADO, EL "−" BAJA ──
            //
            // Un principal en ×2 que pulsa "−" NO está intentando quitar el
            // ingrediente: está deshaciendo el agrandamiento. Debe volver a
            // 1, no recibir el aviso de que no se puede quitar.
            //
            // Antes el aviso saltaba con solo mirar `actual !== 0`, así que
            // en ×2 el botón decía "no se puede quitar" en vez de bajar. El
            // cliente quedaba atrapado en ×2 sin manera de deshacerlo.
            if (ing.principal && actual >= 2) {
                _estadosIng[idx] = actual - 1;
                _pintarEstadoIng(idx);
                calcularPrecioPersonalizado();
                return;
            }

            if (ing.principal && actual !== 0) {
                if (window.mostrarToast) {
                    window.mostrarToast(
                        '🔒 Es un ingrediente principal que define el plato, no se puede quitar.',
                        'warning'
                    );
                }
                // Se agita el botón para que el cliente vea QUE respondió,
                // aunque no cambie nada. Sin esto, el aviso puede pasar
                // desapercibido y el toque sigue pareciendo muerto.
                var btnQ = document.querySelector('[data-ing="' + idx + '"][data-estado="quitar"]');
                if (btnQ) {
                    btnQ.classList.remove('no-se-puede');
                    void btnQ.offsetWidth;   // reinicia la animación
                    btnQ.classList.add('no-se-puede');
                }
                return;
            }
            // EL "−" DE QUITAR HACE DE DECREMENTO (opcionales).
            //
            //   ×3 --(−)--> ×2 --(−)--> 1 --(−)--> Sin
            //
            // Y en «Sin» NO hace nada: para devolverlo a 1 se usa el "+" de
            // la columna Agrandar. Un sentido para subir, otro para bajar.
            //
            // No se avisa nada al pulsar en «Sin»: aquí no hay ninguna regla
            // de negocio que explicar (a diferencia de un principal, que sí
            // lleva aviso). El botón se apaga para que no parezca roto.
            if (actual === 0) return;
            nuevo = actual - 1;
        } else if (accion === 'extra') {
            nuevo = (actual >= 2) ? 1 : 2;
        } else if (accion === 'mas') {
            // De «Sin» el + devuelve a 1: no salta a ×2 de golpe. Este es el
            // único camino de vuelta cuando el ingrediente está en Sin.
            nuevo = (actual === 0) ? 1 : actual + 1;
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
            _confirmarDosPlatos(idx, nuevo, precioPlato);
            return;
        }

        _estadosIng[idx] = nuevo;
        _pintarEstadoIng(idx);
        calcularPrecioPersonalizado();
    };

    /**
     * Aviso de "esto son DOS platos", con la paleta del logo.
     *
     * Antes era `confirm()`: el diálogo gris del NAVEGADOR, que dice
     * "lokeraar.github.io dice" y rompe por completo la estética de la
     * carta. Además bloquea la página entera mientras está abierto.
     *
     * Ahora es una ventana del propio proyecto, la misma que usa la carta
     * para "¿continuar con tu pedido anterior?", con el carmesí de marca y
     * el dorado del logo.
     */
    function _confirmarDosPlatos(idx, nuevo, precioPlato) {
        var ID = 'avisoDosPlatos';
        if (document.getElementById(ID)) return;   // ya está abierto

        var precioDoble = precioPlato * 2;
        var overlay = document.createElement('div');
        overlay.className = 'modal-overlay active';
        overlay.id = ID;
        overlay.innerHTML =
            '<div class="confirm-dialog">' +
              '<i class="fas fa-utensils"></i>' +
              '<h3>Esto son dos platos</h3>' +
              '<p>Pediste extra de todos los ingredientes principales de ' +
                (currentCustomizeItem.nombre || 'este plato') + '. Eso equivale a ' +
                'un segundo plato, no a un plato agrandado.</p>' +
              '<p class="dlg-precio">' +
                '<span class="dlg-precio-antes">' + S.utils.formatBs(precioPlato * _currentQty) + '</span>' +
                ' <i class="fas fa-arrow-right"></i> ' +
                '<span class="dlg-precio-ahora">' + S.utils.formatBs(precioDoble * _currentQty) + '</span>' +
              '</p>' +
              '<p class="dlg-nota">La cocina va a preparar ' + (_currentQty * 2) + ' platos.</p>' +
              '<div class="confirm-dialog-buttons">' +
                '<button class="btn-cancel" id="' + ID + 'No">Cancelar</button>' +
                '<button class="btn-confirm" id="' + ID + 'Si">Sí, dos platos</button>' +
              '</div>' +
            '</div>';

        document.body.appendChild(overlay);

        function cerrar() {
            if (overlay.parentNode) overlay.parentNode.removeChild(overlay);
            document.removeEventListener('keydown', alTeclear);
        }
        function alTeclear(e) { if (e.key === 'Escape') cerrar(); }
        document.addEventListener('keydown', alTeclear);

        document.getElementById(ID + 'No').addEventListener('click', cerrar);

        document.getElementById(ID + 'Si').addEventListener('click', function () {
            cerrar();
            _estadosIng[idx] = nuevo;
            _pintarEstadoIng(idx);
            calcularPrecioPersonalizado();
        });

        // Tocar fuera cierra, igual que el resto de ventanas de la carta.
        overlay.addEventListener('click', function (e) {
            if (e.target === overlay) cerrar();
        });
    }
    window._confirmarDosPlatosParaPrueba = _confirmarDosPlatos;

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
                // La fórmula vive en _recargoDeIngrediente, la MISMA que usa
                // la línea de ayuda: así no pueden dar números distintos.
                recargo += _recargoDeIngrediente(ing, n);
                extras += (n - 1);
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
        // Mismo criterio que el aviso: cuenta SOLO los principales.
        //
        // Si se dejaran dentro los opcionales, un plato con todos los
        // principales agrandados NO se convertiría en dos platos cuando el
        // cliente no subiera el aguacate, y el precio se cobraría por
        // porciones en vez de como dos platos completos. Las dos reglas
        // tienen que medir lo mismo, o el aviso y el cobro no coinciden.
        var principales = _ingredientesActuales.filter(function (ing) { return ing.principal; });
        var todosEnExtra = principales.length > 0 &&
            principales.every(function (ing) {
                var i = _ingredientesActuales.indexOf(ing);
                return _porciones(i) >= 2;
            });

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
