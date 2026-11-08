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
        titulo:      { lineas: 2, maxLineas: 3 },
        descripcion: { lineas: 3, maxLineas: 4 },
        nota:        { lineas: 2, maxLineas: 3 },
        // El nombre del ingrediente lleva el nombre, la marca «(define el
        // plato)», la unidad de medida y el precio: cuatro datos en un hueco
        // estrecho. Con tres renglones se recortaba («+Bs. 1,...») y el dueño
        // pidió cuatro. Cuatro es además `lineas + 2`, así que aquí la
        // capacidad declarada es mayor a propósito: son cuatro datos, no un
        // texto que se estira.
        ingrediente: { lineas: 3, maxLineas: 4, permiteMasLineas: true },
        // Los tres controles ocupan UN renglón siempre. No pueden partir: son
        // botones de una sola línea por diseño, y si el texto no cabe se
        // encoge hasta el piso en vez de crecer de alto.
        rotulo:      { lineas: 1, maxLineas: 1 }
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

        // El alto de una línea al tamaño que se está probando. Se mide de
        // verdad en vez de suponerlo: depende de la familia y del interlineado.
        function altoDeLinea(px) {
            // `line-height` se lee una vez por prueba; si el CSS no lo declara,
            // el navegador devuelve el valor computado, que es lo que aplica.
            var lh = parseFloat(window.getComputedStyle(el).lineHeight);
            if (!isFinite(lh) || lh <= 0) lh = px * 1.3;
            return lh;
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
            // Forzar el cálculo de una vez: sin leer una propiedad geométrica,
            // el navegador puede agrupar los cambios y medir el valor viejo.
            var alto = el.scrollHeight;
            var ancho = el.scrollWidth;
            var anchoDisponible = el.clientWidth;
            var altoLinea = altoDeLinea(px);

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

            return cabeAlto && cabeAncho;
        }

        // El ajuste: se busca el MAYOR tamaño que cabe en `lineasMin`.
        // Primero se comprueba si cabe al techo; si sí, se queda en el techo
        // y no se toca nada más (el caso barato y el más común).
        if (cabe(techo, lineasMin)) {
            el.style.fontSize = techo + 'px';
            return techo;
        }

        // No cabe al techo: se biseca entre el piso y el techo.
        var bajo = PISO;
        var alto = techo;
        var mejor = null;

        // Si ni al piso cabe en las líneas declaradas, se gana una línea y se
        // vuelve a intentar, hasta `maxLineas`. Nunca se baja del piso: por
        // debajo, el texto deja de leerse.
        var lineas = lineasMin;
        // La gracia es UNA línea y no más, aunque quien llame haya pedido un
        // `maxLineas` mayor: es la regla de producto, y aquí es donde se hace
        // cumplir. La excepción está declarada en CAPACIDAD para los casos que
        // no son «un texto que se estira» sino varios datos en una celda.
        var topeLineas = Math.min(capacidad.maxLineas, lineasMin + 1);
        if (capacidad.permiteMasLineas) topeLineas = capacidad.maxLineas;
        while (lineas <= topeLineas) {
            if (cabe(PISO, lineas)) {
                mejor = PISO;
                break;
            }
            lineas++;
        }

        // Si ni con todas las líneas permitidas cabe al piso, se queda en el
        // piso y se RECORTA: la capacidad declarada era demasiado pequeña para
        // este texto. Es el único caso en que se acepta, y es mejor un recorte
        // visible con puntos suspensivos que una letra de 6 px. El navegador
        // recorta con `ellipsis`; aquí solo se marca el elemento para que el
        // CSS lo sepa.
        if (mejor === null) {
            el.style.fontSize = PISO + 'px';
            el.style.overflow = 'hidden';
            el.style.textOverflow = 'ellipsis';
            if (el.style.display !== 'block') el.style.display = 'block';
            el.setAttribute('data-ajuste', 'recortado');
            return PISO;
        }

        // Bisección entre `bajo` y `alto`, con el número de líneas ya fijado.
        for (var i = 0; i < 6; i++) {
            var medio = (bajo + alto) / 2;
            if (cabe(medio, lineas)) {
                mejor = medio;
                bajo = medio;
            } else {
                alto = medio;
            }
        }

        el.style.fontSize = mejor.toFixed(2) + 'px';
        // Un texto que sí cabía no se recorta: se limpia la marca por si el
        // mismo nodo se reutiliza con contenido más corto.
        el.style.textOverflow = '';
        el.removeAttribute('data-ajuste');
        return mejor;
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
            maxLineas: op.maxLineas || Math.max(op.lineas || 1, CAPACIDAD_POR_DEFECTO.maxLineas)
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
            maxLineas: op.maxLineas || Math.max(op.lineas || 1, CAPACIDAD_POR_DEFECTO.maxLineas)
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
        if (!(util > 0)) return false;

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
        // Es una reserva en píxeles y no un porcentaje a propósito: al nombre
        // se le mide en caracteres que puede mostrar, y eso no escala con la
        // pantalla.
        var NOMBRE_MINIMO = 90; // ~8 letras por línea a 16 pt
        var presupuesto = Math.floor(util - fijo - NOMBRE_MINIMO);
        if (presupuesto < 0) presupuesto = 0;

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
        var cabecera = modal.querySelectorAll('.cust-ing-cab');
        if (cabecera && cabecera.length) {
            ajustarGrupo(cabecera, TECHO.ingrediente, CAPACIDAD.rotulo);
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
            // Categorías de la barra lateral: una línea, y son cortas.
            { sel: '.category-item span', lineas: 1, maxLineas: 2 },
            // Eslogan de la cabecera.
            { sel: '.header-slogan', lineas: 1, maxLineas: 2 },
            // Categoría activa, en el título de la sección.
            { sel: '#categoryTitle', lineas: 1, maxLineas: 2, techo: TECHO.titulo },
            // Título del carrito y del panel de categorías.
            { sel: '.cart-header h3', lineas: 1, maxLineas: 2 },
            { sel: '.category-header span', lineas: 1, maxLineas: 2 }
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
                maxLineas: o.maxLineas
            });
        }
    }

    /** Devuelve los textos de la página a su tamaño de CSS. */
    function limpiarPagina() {
        var sels = ['.menu-card-title', '.menu-card-price', '.category-item span',
                    '.header-slogan', '#categoryTitle', '.cart-header h3',
                    '.category-header span'];
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
