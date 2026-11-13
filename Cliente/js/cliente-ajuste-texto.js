// cliente-ajuste-texto.js — Auto-ajuste de letra por capacidad de líneas
//
// QUÉ ES ESTO
//
// Un texto tiene que ocupar EXACTAMENTE N líneas, ni medias ni de más. Si el
// texto es corto, la letra crece hasta llenar esas líneas (con un techo). Si
// es largo, encoge hasta caber (con un piso). Si ni al piso cabe, se le da una
// línea más y se vuelve a ajustar.
//
// Es el «Fit to box» de Photoshop, no la tipografía fluida de `clamp()`.
//
// POR QUÉ NO `clamp()`
//
// `clamp()` escala con el ANCHO de la pantalla, no con el LARGO del texto. Un
// título de 20 caracteres y uno de 60 reciben el mismo tamaño. Aquí el tamaño
// depende del contenido, y por eso hace falta medir.
//
// LAS UNIDADES
//
// El dueño piensa en puntos, como en Word. CSS usa la misma unidad:
//
//     1 pt = 96/72 px = 1.3333 px        1 rem = 16 px
//
//     Word 12 pt = 1rem         Word 16 pt = 1.333rem       Word 8 pt = 0.667rem
//
// Confundir pt con px encoge el texto un 25 %. Fue el error que costó dos
// vueltas, así que las constantes van aquí arriba, en pt, con la conversión a
// la vista.

(function () {
    'use strict';

    // ── CONSTANTES: una sola fuente de verdad ──
    //
    // Se declaran en PT, que es la unidad en la que el dueño piensa, y se
    // convierten a px una vez. Cambiar un techo es cambiar un número aquí.
    var PX_POR_PT = 96 / 72;

    var TECHO = {
        // El título es lo primero que se lee: puede crecer hasta 24 pt.
        titulo:      24 * PX_POR_PT,   // 32 px
        // El resto del contenido de lectura, 16 pt.
        descripcion: 16 * PX_POR_PT,   // 21,33 px
        nota:        16 * PX_POR_PT,   // 21,33 px
        // La fila de ingredientes también parte de 16 pt: el dueño la vio a
        // 12 y dijo que se veía más chica de lo que debería. Ahora la fila
        // crece de alto antes que la letra bajar del techo.
        ingrediente: 16 * PX_POR_PT   // 21,33 px
    };

    // El piso absoluto, igual para todo: 8 pt. Por debajo, la gente puede
    // leer pero no con comodidad. Es el criterio del dueño y coincide con la
    // práctica: 8 pt es donde termina la lectura cómoda.
    var PISO = 8 * PX_POR_PT;          // 10,67 px

    // ── REGLA GENERAL: CUALQUIER CAJA CON TEXTO ──
    //
    // El dueño lo fijó así: «text fitting sería para aplicar en toda área en la
    // que haya algún tipo de texto, sea dentro de un cajón o dentro de otro
    // elemento, con tal de que se autoajuste a las dimensiones que tiene
    // disponibles».
    //
    // Los roles de abajo ya NO son una lista cerrada de cuatro cosas: son los
    // valores por defecto de los campos conocidos de la ventana. Cualquier
    // otro elemento se ajusta llamando a `ajustarCaja(el, opciones)` con su
    // propio techo y su propia capacidad, sin tocar este archivo.
    // El defecto también respeta la línea de gracia única: una línea pedida,
    // dos permitidas. Antes concedía tres (dos de gracia), que es una capacidad
    // que nadie declaró.
    var CAPACIDAD_POR_DEFECTO = { lineas: 1, maxLineas: 2 };

    // Cuántas líneas puede ocupar cada campo COMO MÍNIMO. Si el texto no cabe
    // ni al piso en estas líneas, se le da UNA más y se repite el ajuste.
    //
    // ── LA LÍNEA DE GRACIA ES UNA, Y SOLO UNA ──
    //
    // `maxLineas` NUNCA puede ser mayor que `lineas + 1`. La regla la fijó el
    // dueño y es de producto, no de maquetación:
    //
    //     cabe en N líneas                    -> N líneas, sin tocar nada
    //     no cabe a 8 pt en N                 -> se concede UNA línea (N+1)
    //     cabe en N+1                         -> se usa N+1, SIN puntos suspensivos
    //     tampoco cabe en N+1 a 8 pt          -> recién ahí se permite recortar
    //
    // El corte con puntos suspensivos NO significa «hay más texto»: significa
    // que ni con la excepción de una línea el contenido entra en los
    // parámetros establecidos. Mientras el texto esté completo, unos puntos
    // dirían que falta algo cuando no falta nada.
    //
    // Antes de esta regla `descripcion` concedía DOS líneas extra (3 -> 5) y el
    // valor por defecto otras dos (1 -> 3). Eso no es una concesión: es una
    // capacidad que nunca se declaró.
    var CAPACIDAD = {
        // Los tres primeros van por LETRA: cuando el texto cabe con la letra
        // más grande gastando un renglón de gracia, se le concede. Un título de
        // 24 pt no debe caer a 16 pt solo por ahorrarse un renglón.
        titulo:      { lineas: 2, maxLineas: 3, estrategia: 'letra' },
        descripcion: { lineas: 3, maxLineas: 4, estrategia: 'letra' },
        nota:        { lineas: 2, maxLineas: 3, estrategia: 'letra' },
        // ── EL INGREDIENTE VA POR RENGLONES, Y ES EL ÚNICO ──
        //
        // El nombre del ingrediente lleva el nombre, la marca «(define el
        // plato)», la unidad de medida y el precio: cuatro datos en un hueco
        // estrecho. Con tres renglones se recortaba («+Bs. 1,...») y el dueño
        // pidió cuatro. Cuatro es además `lineas + 2`, así que aquí la
        // capacidad declarada es mayor a propósito: son cuatro datos, no un
        // texto que se estira.
        //
        // ── POR QUÉ ESTE SÍ VA POR RENGLONES ──
        //
        // Es la regla que el dueño fijó y eligió entre dos opciones explícitas:
        //
        //     «Bajar la letra hasta 8 pt antes de pasar a 4 renglones»
        //
        // O sea: se agota el presupuesto de TRES renglones bajando la letra por
        // todo el rango (16 → 8 pt). El cuarto renglón se usa solo si ni al piso
        // cabe en tres.
        //
        // ── Y POR QUÉ NO SE APLICA AL RESTO ──
        //
        // Aplicada a un título produce un despropósito medible: «Combinado
        // Especial del Chef con Salmón, Atún y Anguila Glaseada» cabe a 32 px en
        // tres renglones, pero por ahorrarse el tercero caería a 21 px. El dueño
        // fijó los títulos en 24 pt: encogerlos un tercio para que la fila mida
        // menos contradice esa decisión. En la tabla, en cambio, la altura de la
        // fila es el recurso escaso —hay ocho ingredientes uno debajo de otro— y
        // ahí sí manda el renglón.
        ingrediente: { lineas: 3, maxLineas: 4, permiteMasLineas: true, estrategia: 'renglones' },
        // ── LA CABECERA DE LA TABLA: UN SOLO CUPO PARA LOS CUATRO RÓTULOS ──
        //
        // «Nombre del ingrediente», «Quitar», «Actualmente» y «Agrandar»
        // comparten el renglón de la cabecera, así que son UNA decisión, no
        // cuatro: un cupo solo, y el auto-ajuste les da a los cuatro el tamaño
        // del más restrictivo (la regla de consistencia).
        //
        // ── POR QUÉ DOS RENGLONES Y NO UNO ──
        //
        // «Nombre del ingrediente» son tres palabras y 22 caracteres. Los otros
        // tres son palabras sueltas y entran en un renglón, pero el grupo se
        // dimensiona por el más largo: con cupo de una línea el nombre se
        // recortaba a «Nombre del ingre...».
        //
        // ── POR QUÉ NO SE SEPARAN EN DOS GRUPOS ──
        //
        // Se intentó, y salió peor: al ajustarse solo, el rótulo del nombre
        // crecía hasta el techo de 16 pt mientras los controles se encogían para
        // caber. Cuatro rótulos en el mismo renglón con dos tamaños distintos, y
        // el dueño lo vio al instante: «quedó desproporcionado con el resto de
        // la fila». Un grupo, un tamaño.
        //
        // La cabecera tiene altura libre, así que gastar el segundo renglón no
        // le quita espacio a nadie. Sin línea de gracia: no hay contenido
        // dinámico que pueda estirarse.
        //
        // (Antes había además una entrada `rotulo` con una línea, para los tres
        // controles. Quedó sin uso al unificar el grupo, y dos entradas para un
        // mismo renglón son dos sitios donde el número puede desincronizarse.
        // Se eliminó: este es el único cupo de la cabecera.)
        rotuloCabecera: { lineas: 2, maxLineas: 2, estrategia: 'letra' }
    };

    // Tolerancia en píxeles para dar por bueno un ajuste. Sin ella, el
    // redondeo subpíxel hace que el bucle no converja y se quede en el piso.
    var TOLERANCIA = 1;

    /**
     * Ajusta UN elemento para que ocupe `lineas` líneas como mínimo.
     *
     * Devuelve el tamaño en px que se aplicó, o `null` si el elemento no se
     * pudo medir (por ejemplo, está oculto: `scrollHeight` de un elemento con
     * `display:none` es 0 y el ajuste daría un resultado falso).
     *
     * POR QUÉ BÚSQUEDA BINARIA. Cada lectura de `scrollHeight` fuerza al
     * navegador a recalcular la maquetación. Bajar de 1 en 1 px desde 32 hasta
     * 10,67 son 22 mediciones; bisecando el intervalo, unas 5. Con varios
     * campos por apertura, la diferencia se nota en el teléfono.
     */
    function ajustarElemento(el, techo, capacidad) {
        if (!el || !el.style) return null;

        // Un elemento oculto no se puede medir: su scrollHeight es 0 y el
        // bucle creería que todo cabe. Se sale sin tocar nada.
        if (!el.offsetParent && el.offsetHeight === 0) return null;

        var lineasMin = capacidad.lineas;

        // ── CUÁNTOS RENGLONES SE PUEDEN USAR ──
        //
        // La gracia es UNA línea y no más, aunque quien llame haya pedido un
        // `maxLineas` mayor: es la regla de producto, y aquí es donde se hace
        // cumplir. La excepción está declarada en CAPACIDAD para los casos que
        // no son «un texto que se estira» sino varios datos en una celda.
        var topeLineas = capacidad.permiteMasLineas
            ? capacidad.maxLineas
            : Math.min(capacidad.maxLineas, lineasMin + 1);
        // Un techo por debajo del mínimo dejaría el bucle sin recorrer y el
        // texto sin ajustar. Se corrige en vez de fallar en silencio.
        if (!(topeLineas >= lineasMin)) topeLineas = lineasMin;

        // ── EL RECORTE SE SUELTA ANTES DE MEDIR, Y NO SE HEREDA ──
        //
        // El elemento medido NO debe recortar nunca: su `scrollHeight` es lo
        // único que dice cuánto texto hay. Si una pasada anterior lo dejó en
        // `recortado` —y la rama de recorte escribe `overflow:hidden` y
        // `textOverflow:ellipsis` en este mismo nodo—, la medición siguiente
        // arranca con un estado que no es el de reposo. El dueño lo vio como
        // «cuatro renglones con poco contenido y tres con más contenido» en la
        // misma fila: el mismo texto, dos geometrías, según lo que hubiera
        // pasado antes.
        //
        // El recorte es una marca DE ESTA FUNCIÓN, no un estilo del diseño, así
        // que se suelta al entrar y se vuelve a poner solo si hace falta al
        // salir. Ningún otro sitio escribe estas tres propiedades en el nodo
        // medido.
        // ── TAMBIÉN SE SUELTA EL `max-height` DEL CSS ──
        //
        // `.cust-ing-nombre` lleva ahora su propio tope de cuatro renglones en
        // `em`, que es el que sí manda en el motor. Ese tope NO puede estar
        // puesto mientras se mide: si recorta el bloque, el alto que se lee deja
        // de ser el del texto y el medidor vuelve a estar ciego —el mismo
        // defecto que causaba `line-clamp`.
        //
        // Se neutraliza con un valor en línea y se retira al salir de la
        // función, dejando que el CSS vuelva a aplicar el suyo. El tope y la
        // medición no se pisan porque nunca están activos a la vez.
        function soltarRecorte() {
            el.style.overflow = 'visible';
            el.style.textOverflow = '';
            el.style.maxHeight = 'none';
            if (el.style.webkitLineClamp) el.style.webkitLineClamp = 'unset';
            if (el.style.lineClamp) el.style.lineClamp = 'unset';
        }
        soltarRecorte();

        // ── EL ALTO DE UNA LÍNEA, SIN SUPONER QUE SIGUE AL NOMBRE ──
        //
        // `line-height` en `el` da el interlineado DEL NOMBRE. Pero dentro del
        // nombre viven spans con su propio `font-size`, y hay uno que NO sigue
        // al nombre hacia abajo:
        //
        //     #customizeModal .cust-ing-cant {
        //         font-size: clamp(.8125rem, .82em, 1.0625rem);
        //     }
        //
        // El término central (`.82em`) sigue al nombre, pero el PISO del clamp
        // son 13 px (0,8125rem). Cuando el nombre baja de 13 px —o sea, en todo
        // el tramo de 8 a 9,75 pt, que es justo donde vive la fila del dueño—
        // la unidad deja de encoger y se queda en 13. Como `line-height:1.25`
        // es un número y se resuelve POR ELEMENTO, la caja de línea de ese span
        // mide 1,25 × 13 = 16,3 px y la manda ella, no el nombre.
        //
        // QUÉ ROMPÍA SUPONERLO. El medidor creía que cuatro renglones a 8 pt
        // medían 4 × 13,3 = 53 px cuando en realidad miden 4 × 16,3 = 65 px.
        // Decía «cabe» y el padre recortaba con su `line-clamp`: el precio
        // desaparecía aunque el medidor jurara que sobraba sitio. Es la otra
        // mitad del defecto que el dueño vio como «el precio queda recortado».
        //
        // ── CÓMO SE MIDE BIEN ──
        //
        // Se recorre el contenido en línea del elemento y se toma el interlineado
        // REAL más alto: el de cada hijo con su tamaño ya resuelto por el
        // navegador. La línea mide lo que mide el contenido más alto que la
        // comparte, que es como funciona la caja de línea en CSS.
        //
        // Se leen los estilos computados y no se deduce la herencia a mano: el
        // `clamp()` de la unidad lo resuelve el navegador, y repetir esa cuenta
        // aquí sería tener dos fuentes de verdad para el mismo número.
        //
        // SE RECUERDA POR TAMAÑO. Cada lectura de `getComputedStyle` fuerza un
        // recálculo de estilo, y la búsqueda prueba el mismo tamaño más de una
        // vez (la rama del techo y la bisección coinciden). Con ocho
        // ingredientes en pantalla, repetir esa lectura por prueba se nota en
        // el teléfono. El resultado solo depende del tamaño del nombre, así
        // que un mapa pequeño lo resuelve sin volver a preguntar.
        var memoAltoLinea = {};
        function altoDeLinea(px) {
            var clave = String(px);
            if (memoAltoLinea[clave] !== undefined) return memoAltoLinea[clave];

            var estiloEl = window.getComputedStyle(el);
            var lh = parseFloat(estiloEl && estiloEl.lineHeight);
            if (!isFinite(lh) || lh <= 0) lh = px * 1.3;

            var mayor = lh;
            // Solo los hijos del primer nivel: son los spans en línea que
            // comparten caja de línea con el texto del nombre. Bajar más hondo
            // mediría spans que ya no aportan alto propio.
            var hijos = el.children;
            for (var i = 0; hijos && i < hijos.length; i++) {
                var ec = window.getComputedStyle(hijos[i]);
                if (!ec) continue;
                var fsH = parseFloat(ec.fontSize);
                var lhH = parseFloat(ec.lineHeight);
                // `line-height:normal` no da número: se aproxima con el factor
                // habitual de la tipografía, que es lo que aplica el motor.
                if (!isFinite(lhH) || lhH <= 0) {
                    lhH = (isFinite(fsH) && fsH > 0) ? fsH * 1.3 : 0;
                }
                if (lhH > mayor + TOLERANCIA) mayor = lhH;
            }
            memoAltoLinea[clave] = mayor;
            return mayor;
        }

        // ¿Cabe en `lineas` líneas al tamaño `px`?
        //
        // ── CABE EN DOS DIMENSIONES, NO EN UNA ──
        //
        // La versión anterior solo miraba `scrollHeight`. Con `white-space:
        // nowrap` —los rótulos de una tabla— el texto NUNCA crece de alto: si
        // no cabe a lo ancho, se DESBORDA en horizontal y `scrollHeight` no se
        // entera. El medidor decía «cabe» y el rótulo se montaba encima de la
        // columna vecina. El dueño lo vio: «el contenido de una columna me
        // puede chocar con el texto de otras columnas».
        //
        // Un texto cabe en su celda solo si no se sale ni por abajo ni por los
        // lados:
        //   alto  -> scrollHeight <= altoDeLinea * lineas
        //   ancho -> scrollWidth  <= clientWidth
        //
        // Con `nowrap` la segunda es la que manda, porque la primera nunca
        // falla.
        function cabe(px, lineas) {
            el.style.fontSize = px + 'px';

            // ── SE MIDE SIN EL RECORTE PUESTO ──
            //
            // Este era el defecto que hacía CRECER la letra con el texto
            // desbordado, y el dueño lo vio en su teléfono: «aunque aumentamos
            // la capacidad de filas a 1 más, ahora quedó menos espacio, y veo
            // que aumentaste el tamaño de letra».
            //
            // CAUSA: cuando el elemento medido lleva `line-clamp`, el navegador
            // recorta el contenido y `scrollHeight` se queda clavado en
            // `lineas * altoDeLinea` PARA SIEMPRE. La comparación «¿cabe?»
            // respondía sí a cualquier tamaño, así que el medidor subía la
            // letra al techo y el texto seguía cortado: el que decide no podía
            // ver el desborde que tenía que corregir.
            //
            // El arreglo es medir con el recorte levantado. Se quitan las tres
            // propiedades que recortan, se lee el alto real, se comparan las
            // dimensiones y se devuelven tal como estaban. Sin esto, cualquier
            // elemento con `line-clamp` miente sobre su tamaño.
            var recortePrevio = {
                clamp: el.style.webkitLineClamp || el.style.lineClamp,
                overflow: el.style.overflow,
                display: el.style.display
            };
            // Solo se levanta el recorte si de verdad lo tiene puesto; tocar el
            // estilo de un elemento sin recorte sería trabajo inútil en cada
            // una de las cinco pruebas de la búsqueda binaria.
            var estiloActual = window.getComputedStyle(el);
            var tieneRecorte = (el.style.webkitLineClamp || el.style.lineClamp ||
                                (estiloActual && estiloActual.webkitLineClamp &&
                                 estiloActual.webkitLineClamp !== 'none'));
            if (tieneRecorte) {
                el.style.webkitLineClamp = 'unset';
                el.style.lineClamp = 'unset';
                el.style.overflow = 'visible';
            }

            // Forzar el cálculo de una vez: sin leer una propiedad geométrica,
            // el navegador puede agrupar los cambios y medir el valor viejo.
            var alto = el.scrollHeight;
            var ancho = el.scrollWidth;
            var anchoDisponible = el.clientWidth;

            // El alto de UNA línea al tamaño que se está probando. Se mide de
            // verdad en vez de suponerlo: depende de la familia y del
            // interlineado, y la comparación contra el padre lo necesita.
            var altoLinea = altoDeLinea(px);

            if (tieneRecorte) {
                el.style.webkitLineClamp = recortePrevio.clamp || '';
                el.style.lineClamp = recortePrevio.clamp || '';
                el.style.overflow = recortePrevio.overflow || '';
            }

            // ── Y NO PUEDE SALIRSE DE SU RECIPIENTE ──
            //
            // El recorte de la tabla vive en el PADRE (`.cust-ing-info`), que
            // es quien limita la fila. Ese padre recorta y esconde lo que
            // sobra, así que un texto puede «caber» en sí mismo y aun así
            // quedar cortado para quien lo lee. Sin esta comprobación, el
            // recorte del contenedor es invisible para el ajuste.
            //
            // ── SE COMPARA CONTRA LA CAPACIDAD DECLARADA, NO CONTRA UNA ALTURA MEDIDA ──
            //
            // Antes se comparaba contra `padre.clientHeight`. Ese número no
            // sirve cuando el padre limita con `display:-webkit-box` y
            // `line-clamp`: depende de cómo cada motor cuente las cajas de
            // línea, y hay motores que ven UNA sola línea donde hay cuatro.
            // Con ese valor, cualquier texto «excedía su recipiente» a
            // CUALQUIER tamaño, ninguna prueba cabía, y la fila caía al piso
            // con recorte. Es exactamente el «tres renglones a letra mínima y
            // el precio cortado» que reportó el dueño.
            //
            // Lo que de verdad limita al hijo es el NÚMERO de renglones que el
            // padre declara. Ese número está en el CSS y no depende del motor:
            // si el padre permite N renglones y el candidato cabe en N o menos,
            // el padre no puede estar cortando nada.
            var excedeRecipiente = false;
            var padre = el.parentNode;
            if (padre && padre.nodeType === 1) {
                var estiloPadre = window.getComputedStyle(padre);
                var recortaPadre = estiloPadre &&
                    (estiloPadre.overflow === 'hidden' || estiloPadre.overflowY === 'hidden');
                if (recortaPadre) {
                    var clampPadre = parseInt(
                        estiloPadre.webkitLineClamp || estiloPadre.lineClamp, 10
                    );
                    if (isFinite(clampPadre) && clampPadre > 0) {
                        // El padre declara cuántos renglones admite: se compara
                        // contra esos, al tamaño que se está probando.
                        if (alto > altoLinea * clampPadre + TOLERANCIA) {
                            excedeRecipiente = true;
                        }
                    } else if (padre.clientHeight > 0 &&
                               alto > padre.clientHeight + TOLERANCIA) {
                        // Sin `line-clamp` el padre solo puede recortar por
                        // altura, y ahí `clientHeight` sí es la medida válida.
                        excedeRecipiente = true;
                    }
                }
            }

            // El presupuesto se mide AL TAMAÑO ACTIVO, no al base: si se
            // midiera al base, al encoger la letra cabrían más líneas de las
            // declaradas y aparecería una de más.
            var cabeAlto = alto <= altoLinea * lineas + TOLERANCIA;

            // `clientWidth` a 0 significa que el elemento no tiene ancho
            // resuelto todavía (navegador sin maquetar, `display:none` a
            // medias). Sin un ancho de referencia no se puede juzgar el
            // desborde horizontal, así que solo se exige el alto. Rechazar el
            // ajuste por esto dejaría el texto sin tocar en la primera pasada.
            var cabeAncho = !anchoDisponible || ancho <= anchoDisponible + TOLERANCIA;

            return cabeAlto && cabeAncho && !excedeRecipiente;
        }

        // El ajuste: se busca el MAYOR tamaño que cabe en `lineasMin`.
        // Primero se comprueba si cabe al techo; si sí, se queda en el techo
        // y no se toca nada más (el caso barato y el más común).
        if (cabe(techo, lineasMin)) {
            el.style.fontSize = techo + 'px';
            // El nodo queda limpio: sin recorte inline y sin marcas. Es lo que
            // permite que la siguiente medición parta del estado de reposo.
            //
            // `maxHeight` incluido: se neutralizó para medir y aquí se devuelve
            // al CSS, que es quien pone el tope de cuatro renglones.
            el.style.overflow = '';
            el.style.textOverflow = '';
            el.style.display = '';
            el.style.maxHeight = '';
            el.removeAttribute('data-ajuste');
            el.setAttribute('data-ajuste-lineas', String(lineasMin));
            return techo;
        }

        /** El MAYOR tamaño que cabe en `n` renglones, o `null` si ni el piso cabe. */
        function mayorQueCabe(n) {
            // El caso barato va primero: si ya cabe al TECHO, el mayor tamaño
            // posible es el techo y no hay nada que bisecar. Es el caso más
            // común y el que se ahorra las seis mediciones de la búsqueda.
            if (cabe(techo, n)) return techo;
            if (!cabe(PISO, n)) return null;
            // Bisección entre el piso y el techo, con el número de renglones
            // ya fijado. Seis pasos dejan el resultado a menos de 0,2 px: por
            // debajo de eso no hay diferencia legible, y cada paso cuesta una
            // medición de maquetación.
            var bajo = PISO;
            var alto = techo;
            var mejor = PISO;
            for (var i = 0; i < 6; i++) {
                var medio = (bajo + alto) / 2;
                if (cabe(medio, n)) {
                    mejor = medio;
                    bajo = medio;
                } else {
                    alto = medio;
                }
            }
            return mejor;
        }

        // ── EL PRESUPUESTO DE RENGLONES SE GASTA ANTES DE ENCOGER LA LETRA ──
        //
        // LA REGLA DEL DUEÑO, tal cual: «si el texto cabe a 10 pt en 4
        // renglones, el resultado correcto son 4 renglones a 10 pt, no 3
        // renglones a 8 pt». Primero se aprovecha el presupuesto de renglones,
        // después se encoge la letra.
        //
        // ── POR QUÉ SE PROBABA AL REVÉS, Y QUÉ ROMPÍA ──
        //
        // Antes había un bucle que preguntaba «¿cabe al PISO en 3 renglones?» y,
        // si la respuesta era sí, CONGELABA el número de renglones en 3 y
        // buscaba el mayor tamaño dentro de esos 3:
        //
        //     while (lineas <= topeLineas) {
        //         if (cabe(PISO, lineas)) { mejor = PISO; break; }
        //         lineas++;
        //     }
        //
        // Esa condición regala la línea de gracia SOLO cuando el texto ya no
        // cabe ni a 8 pt en 3 renglones. O sea: la cuarta línea no era
        // presupuesto, era el último recurso del peor caso. Un texto que a 4
        // renglones llega a 18 px se quedaba en 3 renglones a 12,8 px, y ese es
        // el resultado que el dueño describió como «tres renglones con letra
        // mínima».
        //
        // ── DOS ESTRATEGIAS, DECLARADAS POR CAPACIDAD ──
        //
        // Todo esto se probó al revés y las dos formas tienen su caso. Cuál
        // manda no lo decide el medidor: lo decide la capacidad, porque depende
        // de qué recurso es el escaso en esa parte de la pantalla.
        //
        //   'letra'      -> gana la letra MÁS GRANDE. Si el texto cabe a 32 px
        //                   gastando un renglón de gracia, se le concede:
        //                   ahorrarse ese renglón costaría 11 px de letra. Es lo
        //                   correcto para títulos y descripciones, donde el alto
        //                   de la caja no es un recurso escaso.
        //
        //   'renglones'  -> gana la capacidad MÁS CORTA en la que algo cabe,
        //                   agotando la letra antes de crecer. Es lo correcto
        //                   para la tabla de ingredientes, donde ocho filas van
        //                   una debajo de otra y cada renglón de más empuja el
        //                   pie fuera de la pantalla. Es la regla que el dueño
        //                   eligió: «bajar la letra hasta 8 pt antes de pasar a
        //                   4 renglones».
        //
        // Sin esta distinción, una de las dos partes sale mal siempre: con
        // «letra» para todo, el ingrediente gasta el cuarto renglón por medio
        // punto y la fila crece sin que el texto lo pida; con «renglones» para
        // todo, un título de 24 pt cae a 16 pt por ahorrarse un renglón.
        var porRenglones = capacidad.estrategia === 'renglones';

        var mejorTamano = null;
        var mejorLineas = lineasMin;
        for (var n = lineasMin; n <= topeLineas; n++) {
            var tam = mayorQueCabe(n);
            if (tam === null) continue;
            if (porRenglones) {
                // La primera capacidad en la que cabe, de la más corta a la más
                // larga. Dentro de ella, `mayorQueCabe` ya devolvió la letra más
                // grande posible.
                mejorTamano = tam;
                mejorLineas = n;
                break;
            }
            // Estrictamente mayor: a igualdad de tamaño gana la capacidad que se
            // encontró primero, y el recorrido va de menos a más renglones.
            if (mejorTamano === null || tam > mejorTamano + 0.01) {
                mejorTamano = tam;
                mejorLineas = n;
            }
        }

        // Si ni con todas las líneas permitidas cabe al piso, se queda en el
        // piso y se RECORTA: la capacidad declarada era demasiado pequeña para
        // este texto. Es el único caso en que se acepta, y es mejor un recorte
        // visible con puntos suspensivos que una letra de 6 px. El navegador
        // recorta con `ellipsis`; aquí solo se marca el elemento para que el
        // CSS lo sepa.
        if (mejorTamano === null) {
            el.style.fontSize = PISO + 'px';
            el.style.overflow = 'hidden';
            el.style.textOverflow = 'ellipsis';
            if (el.style.display !== 'block') el.style.display = 'block';
            el.setAttribute('data-ajuste', 'recortado');
            return PISO;
        }

        el.style.fontSize = mejorTamano.toFixed(2) + 'px';
        // Un texto que sí cabía no se recorta: se limpia el nodo para que la
        // próxima medición no herede esta pasada. Antes solo se borraba
        // `textOverflow`, y un `overflow:hidden` de una pasada anterior se
        // quedaba pegado al elemento medido para siempre: la fila que había
        // sido recortada seguía recortando aunque el texto nuevo cupiera.
        el.style.overflow = '';
        el.style.textOverflow = '';
        el.style.display = '';
        el.style.maxHeight = '';
        el.removeAttribute('data-ajuste');
        // `mejorLineas` es la capacidad elegida. Se deja anotada porque es el
        // dato que explica el resultado cuando alguien audita una fila.
        el.setAttribute('data-ajuste-lineas', String(mejorLineas));
        return mejorTamano;
    }

    /**
     * Ajusta un GRUPO de elementos que comparten renglón.
     *
     * REGLA DE CONSISTENCIA, pedida por el dueño: cuando varios textos van en
     * la misma línea por diseño (los rótulos Quitar · Actualmente · Agrandar,
     * un precio con su unidad), todos toman el tamaño del MÁS restrictivo.
     * Sin esto, cada uno se ajustaría a su ancho y la línea saldría con tres
     * tamaños distintos: «un carnaval de tamaños en el pintado de una misma
     * línea», en sus palabras.
     *
     * Devuelve el tamaño aplicado al grupo, o `null` si no se pudo medir.
     */
    function ajustarGrupo(elementos, techo, capacidad) {
        if (!elementos || !elementos.length) return null;

        var aplicado = null;
        for (var i = 0; i < elementos.length; i++) {
            var t = ajustarElemento(elementos[i], techo, capacidad);
            // El tamaño del grupo es el MENOR de todos: el que más restringe.
            if (t !== null && (aplicado === null || t < aplicado)) aplicado = t;
        }
        if (aplicado === null) return null;

        for (var j = 0; j < elementos.length; j++) {
            if (elementos[j] && elementos[j].style) {
                elementos[j].style.fontSize = aplicado.toFixed(2) + 'px';
            }
        }
        return aplicado;
    }

    /**
     * Ajusta CUALQUIER caja con texto a las dimensiones que tenga disponibles.
     *
     * ESTA ES LA REGLA GENERAL que pidió el dueño. `ajustarElemento` es el
     * motor; esto es la puerta pública para usar el motor en cualquier parte,
     * no solo en los cuatro campos de la ventana del platillo.
     *
     * Uso:
     *
     *     ajustarCaja(document.querySelector('.mi-titulo'), {
     *         techo: 24 * 96/72,      // 24 pt
     *         lineas: 2,              // capacidad mínima
     *         maxLineas: 3            // hasta dónde puede crecer
     *     });
     *
     * Sin `techo` se usa el de contenido (16 pt). Sin capacidad, una línea y
     * hasta tres. Devuelve el tamaño aplicado en px, o `null` si no se pudo
     * medir.
     */
    function ajustarCaja(el, opciones) {
        var op = opciones || {};
        var techo = op.techo || TECHO.descripcion;
        var cap = {
            lineas: op.lineas || CAPACIDAD_POR_DEFECTO.lineas,
            maxLineas: op.maxLineas || Math.max(op.lineas || 1, CAPACIDAD_POR_DEFECTO.maxLineas),
            // ── LA ESTRATEGIA VIAJABA EN EL VACÍO ──
            //
            // Estas dos puertas aceptaban `estrategia` en el objeto de
            // opciones y la tiraban al construir la capacidad, así que quien
            // pedía 'renglones' recibía el valor por defecto ('letra') sin
            // enterarse: la llamada no fallaba, simplemente no hacía lo que
            // decía. Se vio al ajustar el menú hamburguesa, donde la
            // diferencia entre las dos estrategias es un renglón entero.
            estrategia: op.estrategia
        };
        return ajustarElemento(el, techo, cap);
    }

    /**
     * Ajusta un CONJUNTO de cajas que comparten renglón, con la regla de
     * consistencia: todas toman el tamaño de la más restrictiva.
     */
    function ajustarCajas(elementos, opciones) {
        var op = opciones || {};
        var techo = op.techo || TECHO.descripcion;
        var cap = {
            lineas: op.lineas || CAPACIDAD_POR_DEFECTO.lineas,
            maxLineas: op.maxLineas || Math.max(op.lineas || 1, CAPACIDAD_POR_DEFECTO.maxLineas),
            estrategia: op.estrategia
        };
        return ajustarGrupo(elementos, techo, cap);
    }

    // ── LOS ANCHOS DE LAS TRES COLUMNAS DE CONTROL SE MIDEN EN EL APARATO ──
    //
    // El reparto de la rejilla de ingredientes sale del TEXTO REAL de los
    // rótulos y del ancho que de verdad deja la pantalla, no de una tabla de
    // píxeles calculada sobre la captura de un teléfono. Esos números, en
    // otro aparato o con otra letra del sistema, dejaban el rótulo cortado o
    // se comían el nombre del ingrediente.
    //
    // Se publica como variables CSS en la CABECERA y en CADA FILA porque cada
    // fila es su propia rejilla: una variable puesta solo en la cabecera no
    // llegaría a las filas, que no son hijas suyas.
    var VARS_COLUMNAS = ['--cust-col-q', '--cust-col-a', '--cust-col-ag'];

    /**
     * Ancho del TEXTO de `el`, sin el ancho de su caja.
     *
     * POR QUÉ NO `scrollWidth` A SECAS. Un rótulo es una celda de la rejilla:
     * su caja ocupa la columna entera aunque el texto sea más corto, y
     * `scrollWidth` devuelve `max(texto, caja)`. Midiendo así, un rótulo que ya
     * cabía cómodo devolvía el ancho de su columna —90 px de caja con 59 px de
     * texto daban 90— y el reparto se quedaba congelado en los números viejos
     * en vez de recalcularse. Un `Range` sobre el contenido mide las letras y
     * nada más.
     */
    function anchoTexto(el) {
        if (document.createRange) {
            var rango = document.createRange();
            rango.selectNodeContents(el);
            var caja = rango.getBoundingClientRect ? rango.getBoundingClientRect() : null;
            if (caja && caja.width > 0) return caja.width;
        }
        return el.scrollWidth;
    }

    /**
     * Calcula y publica el ancho de las columnas Quitar · Actualmente ·
     * Agrandar de la tabla de ingredientes.
     *
     * QUÉ MANDA Y QUÉ NO. De este aparato salen tres cosas: el ancho útil de
     * la rejilla, y el ancho real de cada rótulo a 16 pt y a 8 pt. Del diseño
     * salen dos, y no se tocan: la miniatura y el aire entre columnas. La
     * miniatura es un icono con un tamaño decidido a mano, no texto que haya
     * que leer.
     *
     * EL ORDEN DE PREFERENCIA, de mejor a peor:
     *   1. Los tres rótulos caben a 16 pt → cada columna mide su texto.
     *   2. No caben a 16 pt pero sí a 8 pt → se encogen los tres por igual, con
     *      el mismo factor, y cada columna mide su texto ya encogido.
     *   3. No caben ni a 8 pt → se quedan a 8 pt y el que se comprime es el
     *      nombre. Es el único caso degenerado, y es honesto: en una pantalla
     *      así no hay reparto que haga entrar tres rótulos y un nombre.
     *
     * Devuelve `true` si llegó a publicar los anchos, `false` si no había nada
     * que medir.
     */
    // Cuenta los reintentos de medición de columnas mientras la ventana aún no
    // tiene ancho. Vive fuera de la función para no reiniciarse en cada cuadro.
    var _reintentosColumnas = {};

    function medirColumnasTabla(modal) {
        if (!modal) modal = document.getElementById('customizeModal');
        if (!modal || !modal.querySelector) return false;

        var cabecera = modal.querySelector('.cust-ing-cabecera');
        if (!cabecera) return false;
        var rotulos = modal.querySelectorAll('.cust-ing-cab--ctrl');
        if (!rotulos || rotulos.length < 3) return false;

        // ── NO SE MIDE LO QUE NO ESTÁ EN PANTALLA ──
        //
        // Ojo con el criterio del resto del archivo: allí se comprueba
        // `offsetParent`, pero aquí no sirve. El modal es `position:fixed`, y
        // en un elemento fijo `offsetParent` vale `null` SIEMPRE, también con
        // la ventana abierta y perfectamente visible. Con ese guardia esta
        // función no mediría nunca. Lo que sí distingue los dos estados es el
        // ancho: oculta, la cabecera mide 0.
        var estiloCab = window.getComputedStyle(cabecera);
        if (!estiloCab) return false;
        var util = cabecera.clientWidth
            - (parseFloat(estiloCab.paddingLeft) || 0)
            - (parseFloat(estiloCab.paddingRight) || 0);

        // ── SI AÚN NO HAY ANCHO, SE REINTENTA; NO SE RINDE ──
        //
        // La ventana se abre con una transición y el DOM se pinta en varios
        // pasos, así que la primera llamada puede llegar cuando la cabecera
        // todavía mide 0. Antes se devolvía `false` y ahí se acababa todo: las
        // columnas se quedaban con los valores de RESPALDO del CSS
        // (`50px 90px 64px`), que son justo los que recortaban «Nombre del
        // ingre…» y dejaban al nombre sin espacio. El síntoma se veía como un
        // problema de reparto cuando en realidad era una medición que nunca
        // llegó a ocurrir.
        //
        // Se reintenta en los siguientes cuadros de animación, con un tope de
        // intentos para no dejar un bucle vivo si la ventana se cerró.
        if (!(util > 0)) {
            if (typeof window.requestAnimationFrame !== 'function') return false;
            if (!_reintentosColumnas) _reintentosColumnas = {};
            var clave = 'v';
            var intentos = _reintentosColumnas[clave] || 0;
            if (intentos >= 40) { _reintentosColumnas[clave] = 0; return false; }
            _reintentosColumnas[clave] = intentos + 1;
            window.requestAnimationFrame(function () {
                medirColumnasTabla(modal);
            });
            return false;
        }
        if (_reintentosColumnas) _reintentosColumnas['v'] = 0;

        // ── LO QUE VIENE DEL DISEÑO, NO DEL APARATO ──
        //
        // La miniatura y el aire se leen del CSS en vez de repetirlos aquí:
        // el día que cambien (en horizontal la miniatura crece a 32 px), esta
        // cuenta se entera sola.
        var mini = 0;
        var celdaMini = modal.querySelector('.cust-ing-mini-celda');
        if (celdaMini) {
            var anchoMini = parseFloat(window.getComputedStyle(celdaMini).width);
            if (isFinite(anchoMini) && anchoMini > 0) mini = anchoMini;
        }
        var hueco = parseFloat(estiloCab.columnGap);
        if (!isFinite(hueco) || hueco < 0) hueco = 0;
        // Cinco columnas dejan CUATRO huecos entre ellas.
        var fijo = mini + hueco * 4;

        // ── EL TEXTO, A LOS DOS TAMAÑOS EXTREMOS ──
        //
        // Se mide a 16 pt (techo) y a 8 pt (piso) porque entre esos dos vive
        // cualquier reparto posible. El tamaño en línea se guarda y se
        // devuelve tal cual estaba: si el ajuste de letra ya había escrito uno,
        // esta medición no puede borrarlo.
        var naturalTecho = [];
        var naturalPiso = [];
        var i;
        for (i = 0; i < 3; i++) {
            var rotulo = rotulos[i];
            var previo = rotulo.style.fontSize;
            rotulo.style.fontSize = TECHO.ingrediente + 'px';
            naturalTecho.push(anchoTexto(rotulo));
            rotulo.style.fontSize = PISO + 'px';
            naturalPiso.push(anchoTexto(rotulo));
            rotulo.style.fontSize = previo;
        }

        // ── EL AIRE DE CADA CELDA SE SUMA AL ANCHO DEL TEXTO ──
        //
        // `anchoTexto` mide el TEXTO, no la caja. Ahora cada celda lleva relleno
        // a sus dos lados para que las columnas respiren; si no se sumara aquí,
        // la columna se publicaría del ancho justo del texto y el relleno se
        // comería las últimas letras: el rótulo volvería a recortarse, ahora por
        // una causa distinta y más difícil de ver.
        //
        // Se mide del propio rótulo en vez de escribir el número otra vez: el
        // día que el relleno cambie en el CSS, esta cuenta se entera sola.
        var aire = 0;
        if (rotulos[0]) {
            var csRot = window.getComputedStyle(rotulos[0]);
            aire = (parseFloat(csRot.paddingLeft) || 0) + (parseFloat(csRot.paddingRight) || 0);
        }
        for (i = 0; i < 3; i++) {
            naturalTecho[i] += aire;
            naturalPiso[i] += aire;
        }

        // Se redondea hacia arriba ANTES de comparar: son los píxeles que se
        // van a publicar, y comparar con una suma que luego crece al redondear
        // daba el caso tonto de «cabe» seguido de un nombre de 0 px.
        var anchos = [];
        var necesTecho = 0;
        var necesPiso = 0;
        // El piso de CADA columna, por separado: es hasta dónde se puede
        // apretar esa columna sin dejar su rótulo por debajo de 8 pt.
        var necesPisoPorColumna = [];
        for (i = 0; i < 3; i++) {
            anchos[i] = Math.ceil(naturalTecho[i]);
            necesTecho += anchos[i];
            necesPisoPorColumna[i] = Math.ceil(naturalPiso[i]);
            necesPiso += necesPisoPorColumna[i];
        }

        // ── EL PRESUPUESTO ES UNA COTA, NO UNA INTENCIÓN ──
        //
        // Cada columna se redondea hacia arriba por separado porque una
        // rejilla no acepta medios píxeles en la práctica: lo que se publica
        // tiene que ser entero. Pero redondear tres veces puede pasarse del
        // presupuesto por hasta 3 px, y el que paga es el nombre, que es la
        // columna `1fr`: con el presupuesto agotado se queda en cero y el
        // nombre del ingrediente desaparece. Por eso, después de repartir, se
        // corrige la suma: se recorta de la columna de texto MÁS ANCHO hasta
        // volver a entrar, sin bajar ninguna de lo que mide su propio texto a
        // 8 pt. Es el suelo por debajo del cual el rótulo ya no se lee.
        function ajustarAlPresupuesto(anchos, pisos, limite) {
            var total = 0;
            for (var j = 0; j < anchos.length; j++) total += anchos[j];
            var sobra = total - limite;
            // De mayor a menor: recortar a la columna ancha cuesta menos
            // legibilidad que apretar la corta, que ya iba justa.
            var orden = [0, 1, 2].sort(function (x, y) { return anchos[y] - anchos[x]; });
            for (var o = 0; o < orden.length && sobra > 0; o++) {
                var idx = orden[o];
                var disponible = Math.max(0, anchos[idx] - pisos[idx]);
                var quitar = Math.min(disponible, sobra);
                anchos[idx] -= quitar;
                sobra -= quitar;
            }
            return anchos;
        }

        // ── EL NOMBRE TIENE PRIORIDAD, Y ESO ES UN PRESUPUESTO, NO UN DESEO ──
        //
        // El dueño lo fijó: «los nombres de los ingredientes tienen
        // prioridad». Sin esta reserva, el reparto automático tenía un agujero
        // grave: en una tarjeta de 340-360 px los tres rótulos a 16 pt piden
        // ~268 px y el aire otros 34, así que «caben» y se los llevan todos,
        // dejando al nombre 18 px. El nombre es la columna `1fr`, así que
        // absorbe cualquier descuadre y puede quedarse en nada.
        //
        // Por eso los controles no reparten contra el ancho útil completo, sino
        // contra lo que queda DESPUÉS de reservar al nombre un mínimo legible.
        //
        // ── EL NOMBRE SE LLEVA LA MAYOR PARTE DEL ANCHO ──
        //
        // Antes era `NOMBRE_MINIMO = 90` px fijos, y se quedaba corto en el
        // teléfono: con 377 px útiles los tres rótulos se llevaban 287 y al
        // nombre le dejaban 90. Resultado, el que reportó el dueño:
        // «Nombre del ingre…» recortado en la cabecera y nombres reales
        // partidos en cuatro renglones, mientras «Quitar», «Actualmente» y
        // «Agrandar» —cinco a nueve letras— nadaban en columnas de 90 y 64 px.
        //
        // La reserva ahora es PROPORCIONAL: el nombre es la columna que se lee,
        // así que se lleva más de la mitad. Los controles se reparten el resto,
        // y el auto-ajuste encoge sus rótulos lo justo para entrar ahí. Se
        // mantiene un piso de 90 px para pantallas muy angostas, donde un
        // 55 % todavía podría dejar el nombre sin letras.
        // Cuánto se le QUIERE dar al nombre, y cuánto se le GARANTIZA. No son
        // lo mismo: el primero es el reparto deseable, el segundo es lo que no
        // se le quita pase lo que pase. Sin la garantía, unos rótulos que no
        // caben ni a 8 pt se comen el nombre entero y la columna queda en cero.
        var NOMBRE_DESEADO = Math.max(90, Math.round(util * 0.55));
        var NOMBRE_GARANTIZADO = 90;

        // ── LAS COLUMNAS DE CONTROL NO ACAPARAN ──
        //
        // Su rótulo son cinco a nueve letras: no necesitan media tabla. Tope
        // del 45 % del ancho útil. No es un número fijo, así que en una
        // pantalla ancha los rótulos conservan su tamaño cómodo y solo se
        // aprietan cuando de verdad falta sitio.
        var TOPE_CONTROLES = Math.floor(util * 0.45);
        if (TOPE_CONTROLES < 0) TOPE_CONTROLES = 0;

        // Y nunca por encima de lo que deja libre el mínimo garantizado del
        // nombre: eso es lo que impide que la columna del nombre se apague.
        var MAX_CONTROLES = util - fijo - NOMBRE_GARANTIZADO;
        if (MAX_CONTROLES < 0) MAX_CONTROLES = 0;

        var presupuesto = Math.floor(util - fijo - NOMBRE_DESEADO);
        if (presupuesto < 0) presupuesto = 0;
        if (presupuesto > TOPE_CONTROLES) presupuesto = TOPE_CONTROLES;
        if (presupuesto > MAX_CONTROLES) presupuesto = MAX_CONTROLES;

        if (necesTecho <= presupuesto) {
            // Caso bueno: los rótulos entran a 16 pt y al nombre le sobra su
            // reserva.
        } else if (necesPiso <= presupuesto) {
            // No entran a 16 pt, pero sí a 8. Se encogen los tres con el MISMO
            // factor: tres tamaños distintos en una misma línea se leerían
            // como un error de maquetación.
            var factor = presupuesto / necesTecho;
            factor = Math.max(factor, PISO / TECHO.ingrediente);
            factor = Math.min(factor, 1);
            for (i = 0; i < 3; i++) {
                anchos[i] = Math.ceil(naturalTecho[i] * factor);
            }
        } else {
            // Ni a 8 pt entran en el presupuesto: los rótulos se quedan en su
            // piso y el nombre conserva su reserva. El nombre NO se comprime
            // aquí: encogerlo es trabajo del ajuste de letra, que lo baja hasta
            // 8 pt y, si aun así no cabe, recorta con puntos suspensivos. Lo
            // que no se hace es dejarlo en cero por repartir mal.
            for (i = 0; i < 3; i++) {
                anchos[i] = Math.ceil(naturalPiso[i]);
            }
        }

        ajustarAlPresupuesto(anchos, necesPisoPorColumna, presupuesto);

        // ── ÚLTIMA RED: EL NOMBRE NO SE QUEDA SIN ANCHO ──
        //
        // `ajustarAlPresupuesto` no baja ninguna columna de su piso a 8 pt, así
        // que si los tres pisos juntos no entran, la suma se pasa del
        // presupuesto. El nombre es `minmax(0, 1fr)` y en ese caso absorbería
        // el descuadre hasta quedar en cero: desaparecería. Aquí se recorta el
        // exceso hasta `MAX_CONTROLES`, que es justo lo que deja libre el
        // mínimo garantizado. Se recorta a la columna más ancha primero, por la
        // misma razón de siempre.
        var sumaFinal = anchos[0] + anchos[1] + anchos[2];
        if (sumaFinal > MAX_CONTROLES && MAX_CONTROLES > 0) {
            var exceso = sumaFinal - MAX_CONTROLES;
            var orden3 = [0, 1, 2].sort(function (x, y) { return anchos[y] - anchos[x]; });
            for (var o3 = 0; o3 < orden3.length && exceso > 0; o3++) {
                var idx3 = orden3[o3];
                var quitar3 = Math.min(anchos[idx3], exceso);
                anchos[idx3] -= quitar3;
                exceso -= quitar3;
            }
        }

        // ── EL EXCEDENTE DE LOS CONTROLES VUELVE AL NOMBRE ──
        //
        // Si los tres rótulos suman más que su techo, se reparten ese techo en
        // la misma proporción. Lo que se ahorra aquí no se pierde: la columna
        // del nombre es `1fr` y absorbe el hueco libre, así que pasa a ser
        // espacio para el nombre del ingrediente.
        var sumaControles = anchos[0] + anchos[1] + anchos[2];
        if (TOPE_CONTROLES > 0 && sumaControles > TOPE_CONTROLES) {
            var sobra = sumaControles - TOPE_CONTROLES;
            // Se recorta primero a la columna más ancha, que es la que tiene
            // margen: es la misma idea que `ajustarAlPresupuesto`.
            var orden2 = [0, 1, 2].sort(function (x, y) { return anchos[y] - anchos[x]; });
            for (var o2 = 0; o2 < orden2.length && sobra > 0; o2++) {
                var idx2 = orden2[o2];
                var puede = Math.max(0, anchos[idx2] - necesPisoPorColumna[idx2]);
                var quitar2 = Math.min(puede, sobra);
                anchos[idx2] -= quitar2;
                sobra -= quitar2;
            }
        }

        publicarColumnas(modal, cabecera, anchos);
        return true;
    }

    /** Escribe los tres anchos en la cabecera y en cada fila de ingrediente. */
    function publicarColumnas(modal, cabecera, anchos) {
        var destinos = [cabecera];
        var filas = modal.querySelectorAll('.cust-ing');
        for (var f = 0; f < filas.length; f++) destinos.push(filas[f]);

        for (var d = 0; d < destinos.length; d++) {
            var destino = destinos[d];
            if (!destino || !destino.style || !destino.style.setProperty) continue;
            for (var k = 0; k < 3; k++) {
                destino.style.setProperty(VARS_COLUMNAS[k], anchos[k] + 'px');
            }
        }
    }

    /**
     * Ajusta todos los textos de la ventana del platillo.
     *
     * SE LLAMA UNA VEZ POR APERTURA, nunca por frame. Cada medición obliga al
     * navegador a recalcular la maquetación; hacerlo en cada gesto convertiría
     * el scroll en un tirón. La única excepción es girar el teléfono o cambiar
     * el tamaño de la ventana, que ocurre pocas veces y cambia el ancho útil:
     * eso lo pide `cliente-customize.js`, con su propio retardo.
     */
    function ajustarVentanaPlatillo() {
        var modal = document.getElementById('customizeModal');
        if (!modal || !modal.querySelector) return;

        // Sin la clase `cust-ventana` no estamos en el platillo (es el
        // historial), y ahí no se ajusta nada.
        var contenedor = modal.querySelector('.modal-container');
        if (!contenedor || !contenedor.classList.contains('cust-ventana')) return;

        // LOS ANCHOS VAN PRIMERO. El ajuste de letra mide cada rótulo contra
        // el ancho de su columna: si se midiera antes de fijar las columnas,
        // la letra quedaría ajustada a un reparto que ya no existe.
        medirColumnasTabla(modal);

        var titulo = modal.querySelector('.cust-titulo');
        if (titulo) ajustarElemento(titulo, TECHO.titulo, CAPACIDAD.titulo);

        var desc = modal.querySelector('.cust-desc');
        if (desc) ajustarElemento(desc, TECHO.descripcion, CAPACIDAD.descripcion);

        var nota = modal.querySelector('.cust-inferior-nota');
        if (nota) ajustarElemento(nota, TECHO.nota, CAPACIDAD.nota);

        // El nombre de cada ingrediente y los rótulos de columna comparten
        // renglón por diseño: cada fila se ajusta como grupo.
        // ── LOS RÓTULOS SE AJUSTAN EN DOS GRUPOS, NO EN UNO ──
        //
        // Los tres controles comparten una decisión: una línea, sin partirse.
        // El rótulo del nombre tiene otra: dos líneas, porque son tres palabras
        // y no cabe en una. Antes iban los cuatro en el mismo `ajustarGrupo` y
        // el cupo de los controles se le aplicaba al nombre, que salía
        // recortado.
        // ── LOS CUATRO RÓTULOS SE AJUSTAN COMO UN SOLO GRUPO ──
        //
        // Es la regla de consistencia, y aquí muerde fuerte: comparten el
        // renglón de la cabecera por diseño, así que un tamaño distinto se lee
        // como un error de maquetación.
        //
        // ── LO QUE ESTUVO MAL, Y POR QUÉ ──
        //
        // Hubo un tiempo en que los cuatro iban juntos pero con un cupo de UNA
        // línea. «Nombre del ingrediente» son tres palabras y no cabía en una,
        // así que se recortaba a «Nombre del ingre...». El diagnóstico fácil
        // fue culpar al reparto y darle al rótulo un grupo y un cupo propios.
        //
        // El dueño lo vio en su teléfono y lo describió exacto: «el texto de
        // nombre del ingrediente quedó desproporcionado con el resto de la
        // fila». Al sacarlo del grupo, el rótulo se ajustó SOLO contra su
        // columna: creció hasta el techo de 16 pt mientras los tres controles
        // se encogían para caber. Cuatro rótulos en un renglón, dos tamaños
        // distintos. Se cambió un recorte por un descuadre.
        //
        // ── CÓMO SE RESUELVE DE VERDAD ──
        //
        // Volviendo a UN grupo, que es lo que la regla pide, y arreglando el
        // reparto en vez del tamaño: la columna del nombre es ancha (más de la
        // mitad de la tabla), así que a 16 pt el rótulo entra en dos renglones
        // sin recortarse. El cupo de dos líneas se declara en el grupo, y ese
        // es el único número; los controles siguen entrando en su renglón.
        //
        // El techo se mantiene en 16 pt: los rótulos no son títulos.
        var rotulosCab = modal.querySelectorAll('.cust-ing-cab');
        if (rotulosCab && rotulosCab.length) {
            ajustarGrupo(rotulosCab, TECHO.ingrediente, CAPACIDAD.rotuloCabecera);
        }
        var nombres = modal.querySelectorAll('.cust-ing-nombre');
        if (nombres && nombres.length) {
            // Se mide el NOMBRE, no el bloque con la unidad: el nombre es lo
            // que tiene el tope de tres renglones, y la unidad es un dato
            // aparte con su propio tamaño, debajo.
            //
            // Todos comparten tamaño: es una sola columna, y tres nombres con
            // tres tamaños distintos se leerían como un error.
            ajustarGrupo(nombres, TECHO.ingrediente, CAPACIDAD.ingrediente);
        }
    }

    /** Devuelve un campo a su tamaño de CSS, borrando el ajuste.
     *
     * Se llama al cerrar y antes de cada ajuste, para que un texto que se
     * acortó (o un plato distinto) no herede el tamaño encogido del anterior.
     */
    function limpiarAjuste() {
        var modal = document.getElementById('customizeModal');
        if (!modal || !modal.querySelectorAll) return;
        var todos = modal.querySelectorAll(
            '.cust-titulo, .cust-desc, .cust-inferior-nota, .cust-ing-cab, .cust-ing-nombre'
        );
        for (var i = 0; i < todos.length; i++) {
            if (todos[i].style) todos[i].style.fontSize = '';
        }
    }

    /**
     * Ajusta los textos de TODA LA PÁGINA que deben adaptarse a su hueco.
     *
     * El dueño lo pidió así: «todos los textos de toda la página que
     * correspondan a redimensionar automáticamente según dimensiones de la
     * pantalla».
     *
     * QUÉ SE AJUSTA Y QUÉ NO.
     *
     * Solo los textos CORTOS que viven en una caja con ancho acotado: el título
     * y el precio de una tarjeta del menú, el nombre de una categoría, el
     * eslogan de la cabecera, el nombre de la marca en el pie. Son los que se
     * rompen cuando el nombre del plato es largo.
     *
     * NO se ajustan: los párrafos largos (una descripción de tres líneas es
     * prosa, ahí manda `clamp()`), el texto dentro de un `<input>` o `<textarea>`,
     * ni nada con `contenteditable`. Encogerlos haría el texto ilegible sin
     * ganar nada: el que lee un párrafo quiere poder ampliarlo.
     *
     * Se llama una vez al pintar la carta y cuando cambia el contenido. Nunca
     * en `resize` ni por cuadro.
     */
    function ajustarPagina() {
        // Cada entrada declara su techo y su capacidad en líneas. El techo por
        // defecto es el de contenido (16 pt): nada de la página arranca más
        // grande salvo el nombre de la marca.
        var objetivos = [
            // Tarjetas del menú: el nombre del plato es lo que más se rompe
            // cuando el nombre es largo. Dos líneas.
            { sel: '.menu-card-title', lineas: 2, maxLineas: 3 },
            // El precio: una sola línea, es un dato.
            { sel: '.menu-card-price', lineas: 1, maxLineas: 1 },
            // ── EL MENÚ HAMBURGUESA COMPLETO ──
            //
            // Cada opción ocupa UN renglón, con UNA línea de gracia si no cabe
            // ni al piso de 8 pt. Es la regla que fijó el dueño: «que utilice
            // solo 1 fila por opción (+1 de gracia por si el contenido no cabe
            // aún reduciendo al mínimo de 8 pt en ese renglón)».
            //
            // «🔥 OFERTAS ESPECIALES» era el caso visible: al ser dos palabras
            // largas se partía en dos renglones y descuadraba el ritmo del
            // menú, donde las demás ocupan uno.
            //
            // ── LA ESTRATEGIA ES 'renglones', Y ESO ES LO QUE HACE QUE MANDEN ──
            //
            // Con la estrategia por defecto ('letra'), el motor PREFIERE una
            // letra más grande aunque gaste el renglón de gracia: 16 pt en dos
            // renglones antes que 11 pt en uno. Para un título eso está bien,
            // porque su alto es libre.
            //
            // En el menú no: el dueño fue explícito —«que utilice solo 1 fila
            // por opción (+1 de gracia por si el contenido no cabe aún
            // reduciendo al mínimo de 8pt en ese renglón)»—. La gracia NO es
            // una preferencia estética, es el último recurso cuando ni a 8 pt
            // cabe en una. Eso es exactamente `'renglones'`: se agota la letra
            // antes de crecer de renglón.
            //
            // Medido en la prueba: «OFERTAS ESPECIALES» a 150 px de ancho sale
            // en DOS renglones a 21,33 px con 'letra', y en UN renglón a 11,2
            // px con 'renglones'. El segundo es el que se pidió.
            //
            // Se ajustan como GRUPO, igual que la cabecera de la tabla del
            // platillo: todas las opciones del menú comparten un tamaño, el de
            // la más larga. Con tamaños distintos se leería como un error.
            { sel: '.category-item span', lineas: 1, maxLineas: 2, estrategia: 'renglones' },
            // Las subcategorías cuelgan de su categoría y sufren lo mismo.
            { sel: '.subcategory-item', lineas: 1, maxLineas: 2, estrategia: 'renglones' },
            // El título del panel («Categorías») y los rótulos del carrito.
            { sel: '.category-header span', lineas: 1, maxLineas: 2 },
            // Eslogan de la cabecera.
            { sel: '.header-slogan', lineas: 1, maxLineas: 2 },
            // Categoría activa, en el título de la sección.
            { sel: '#categoryTitle', lineas: 1, maxLineas: 2, techo: TECHO.titulo },
            // Título del carrito y del panel de categorías.
            { sel: '.cart-header h3', lineas: 1, maxLineas: 2 }
        ];

        for (var i = 0; i < objetivos.length; i++) {
            var o = objetivos[i];
            var els = document.querySelectorAll(o.sel);
            if (!els || !els.length) continue;
            // Se ajustan como GRUPO: todas las tarjetas del menú comparten
            // tamaño. Tres platos con tres tamaños distintos en la misma
            // rejilla se leerían como un error de maquetación, que es la
            // misma regla de consistencia que se aplica dentro del platillo.
            ajustarGrupo(els, o.techo || TECHO.descripcion, {
                lineas: o.lineas,
                maxLineas: o.maxLineas,
                // Sin este paso la estrategia se perdía en el camino y todo se
                // ajustaba como 'letra', que es el valor por defecto del motor.
                estrategia: o.estrategia
            });
        }
    }

    /** Devuelve los textos de la página a su tamaño de CSS. */
    function limpiarPagina() {
        var sels = ['.menu-card-title', '.menu-card-price', '.category-item span',
                    '.subcategory-item', '.header-slogan', '#categoryTitle',
                    '.cart-header h3', '.category-header span'];
        for (var i = 0; i < sels.length; i++) {
            var els = document.querySelectorAll(sels[i]);
            for (var j = 0; j < els.length; j++) {
                if (els[j].style) els[j].style.fontSize = '';
            }
        }
    }

    window.ajustarVentanaPlatillo = ajustarVentanaPlatillo;
    window.limpiarAjusteTexto = limpiarAjuste;
    // Los anchos de la tabla también son públicos: el giro de pantalla y el
    // cambio de tamaño los vuelven a pedir desde `cliente-customize.js`.
    window.medirColumnasTabla = medirColumnasTabla;
    // ── LA REGLA GENERAL, DISPONIBLE PARA CUALQUIER CAJA ──
    // Cualquier elemento con texto puede autoajustarse a su espacio con
    // `ajustarCaja(el, {techo, lineas, maxLineas})`, sin tocar este archivo.
    window.ajustarCaja = ajustarCaja;
    window.ajustarCajas = ajustarCajas;
    // ── TODA LA PÁGINA ──
    window.ajustarPagina = ajustarPagina;
    window.limpiarPagina = limpiarPagina;
    window.ajusteTexto = {
        TECHO: TECHO,
        PISO: PISO,
        CAPACIDAD: CAPACIDAD,
        PX_POR_PT: PX_POR_PT,
        ajustarElemento: ajustarElemento,
        ajustarGrupo: ajustarGrupo
    };
})();
