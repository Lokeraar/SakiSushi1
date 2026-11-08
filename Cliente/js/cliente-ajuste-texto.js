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
    var CAPACIDAD_POR_DEFECTO = { lineas: 1, maxLineas: 3 };

    // Cuántas líneas puede ocupar cada campo COMO MÍNIMO. Si el texto no cabe
    // ni al piso en estas líneas, se le da una más y se repite el ajuste.
    // `maxLineas` es el techo de ese crecimiento, para que un texto absurdo no
    // empuje la ventana entera fuera de la pantalla.
    var CAPACIDAD = {
        titulo:      { lineas: 2, maxLineas: 3 },
        descripcion: { lineas: 3, maxLineas: 5 },
        nota:        { lineas: 2, maxLineas: 3 },
        // El nombre del ingrediente puede partir en dos renglones: el dueño
        // aprobó que la fila crezca antes que la letra encogerse.
        ingrediente: { lineas: 2, maxLineas: 2 },
        rotulo:      { lineas: 2, maxLineas: 2 }
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
        function cabe(px, lineas) {
            el.style.fontSize = px + 'px';
            // Forzar el cálculo de una vez: sin leer una propiedad geométrica,
            // el navegador puede agrupar los cambios y medir el valor viejo.
            var alto = el.scrollHeight;
            var altoLinea = altoDeLinea(px);
            // El presupuesto se mide AL TAMAÑO ACTIVO, no al base: si se
            // midiera al base, al encoger la letra cabrían más líneas de las
            // declaradas y aparecería una de más.
            return alto <= altoLinea * lineas + TOLERANCIA;
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
        while (lineas <= capacidad.maxLineas) {
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

    /**
     * Ajusta todos los textos de la ventana del platillo.
     *
     * SE LLAMA UNA VEZ POR APERTURA, nunca en `resize` ni por frame. Cada
     * medición obliga al navegador a recalcular la maquetación; hacerlo en
     * cada gesto convertiría el scroll en un tirón.
     */
    function ajustarVentanaPlatillo() {
        var modal = document.getElementById('customizeModal');
        if (!modal || !modal.querySelector) return;

        // Sin la clase `cust-ventana` no estamos en el platillo (es el
        // historial), y ahí no se ajusta nada.
        var contenedor = modal.querySelector('.modal-container');
        if (!contenedor || !contenedor.classList.contains('cust-ventana')) return;

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
            // Todos los nombres de la lista comparten tamaño: es una sola
            // columna, y tres nombres con tres tamaños distintos se leerían
            // como un error.
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

    window.ajustarVentanaPlatillo = ajustarVentanaPlatillo;
    window.limpiarAjusteTexto = limpiarAjuste;
    // ── LA REGLA GENERAL, DISPONIBLE PARA CUALQUIER CAJA ──
    // Cualquier elemento con texto puede autoajustarse a su espacio con
    // `ajustarCaja(el, {techo, lineas, maxLineas})`, sin tocar este archivo.
    window.ajustarCaja = ajustarCaja;
    window.ajustarCajas = ajustarCajas;
    window.ajusteTexto = {
        TECHO: TECHO,
        PISO: PISO,
        CAPACIDAD: CAPACIDAD,
        PX_POR_PT: PX_POR_PT,
        ajustarElemento: ajustarElemento,
        ajustarGrupo: ajustarGrupo
    };
})();
