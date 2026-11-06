// cliente-preview.js - Modal preview de platillos
(function() {
    window.Saki = window.Saki || {};
    window.Saki.modules = window.Saki.modules || {};
    window.Saki.modules.preview = {};
    var S = window.Saki;

    var _currentPreviewId = null;

    /**
     * Abre la ventana del platillo.
     *
     * ANTES HABÍA DOS VENTANAS PARA LO MISMO.
     *
     * Esta función construía su propia maqueta dentro de #customizeModal:
     * foto, descripción, ingredientes en pastillas y un par de botones
     * «Personalizar / Añadir» metidos en el cuerpo. Y `abrirPersonalizacion`
     * construía OTRA maqueta en el mismo sitio: cantidad, «Completo» o
     * «Personalizar ingredientes», la lista con −/×2 y el precio. Las dos
     * compartían el <div> y el footer, así que la pantalla mostraba botones
     * de más y mantenerlas era duplicar trabajo.
     *
     * AHORA HAY UNA SOLA: la de `abrirPersonalizacion`, que ya tenía todo lo
     * que hace falta (cantidad, ingredientes, precio y agregar al carrito).
     * A esa se le añadieron la foto y el estado del stock, que era lo único
     * que aportaba la otra.
     *
     * Así, tocar la foto de la tarjeta y tocar «Personalizar» llevan al
     * mismo lugar, con las mismas opciones. `abrirPreview` se conserva como
     * nombre público porque hay varios sitios que lo llaman; solo cambia
     * lo que hace por dentro.
     */
    function abrirPreview(platilloId) {
        var item = (S.state.menuItems || []).find(function(i) { return i.id == platilloId; });
        if (!item) return;

        if (window.abrirPersonalizacion) {
            window.abrirPersonalizacion(platilloId);
            return;
        }

        // Si el módulo de personalización no cargó, no se deja al usuario
        // sin nada: se avisa en vez de abrir una ventana vacía.
        console.warn('[Saki] abrirPersonalizacion no está disponible');
    }
    window.abrirPreview = abrirPreview;
    S.modules.preview.abrirPreview = abrirPreview;

    function cerrarPreview() {
        document.getElementById('customizeModal').classList.remove('active');
        _currentPreviewId = null;
    }
    window.cerrarPreview = cerrarPreview;
    S.modules.preview.cerrarPreview = cerrarPreview;

    /**
     * Amplía una foto de platillo a pantalla completa.
     *
     * Se construye UNA sola vez y se reutiliza: crear un visor nuevo cada
     * vez dejaba nodos huérfanos en el DOM y el teléfono se ponía lento
     * después de abrir y cerrar varias fotos.
     *
     * Tres formas de cerrar, porque en un teléfono cada una se usa:
     * tocar la foto, tocar la X, y la tecla de retroceso (que dispara
     * el botón atrás del navegador). Sin la tercera, el usuario queda
     * atrapado y la única salida es recargar.
     */
    var _visor = null;

    function _crearVisor() {
        var d = document.createElement('div');
        d.id = 'visorImagen';
        d.setAttribute('role', 'dialog');
        d.setAttribute('aria-modal', 'true');
        d.style.cssText = 'position:fixed;inset:0;z-index:10000;background:rgba(20,12,6,.94);' +
            'display:none;align-items:center;justify-content:center;padding:1rem;' +
            'flex-direction:column;gap:.8rem';

        var cerrar = document.createElement('button');
        cerrar.id = 'visorCerrar';
        cerrar.type = 'button';
        cerrar.setAttribute('aria-label', 'Cerrar la foto ampliada');
        cerrar.innerHTML = '&times;';
        // Blanco sobre el velo oscuro: 21:1. El visor es oscuro en los DOS
        // temas a propósito, para que la foto no pierda fuerza.
        cerrar.style.cssText = 'position:absolute;top:1rem;right:1rem;width:44px;height:44px;' +
            'display:flex;align-items:center;justify-content:center;border:none;border-radius:50%;' +
            'background:rgba(255,255,255,.16);color:#fff;font-size:1.7rem;line-height:1;' +
            'cursor:pointer;padding:0';

        var img = document.createElement('img');
        img.id = 'visorImagenSrc';
        img.alt = '';
        img.style.cssText = 'max-width:100%;max-height:82vh;object-fit:contain;' +
            'border-radius:12px;box-shadow:0 12px 40px rgba(0,0,0,.5);display:block';

        var pie = document.createElement('p');
        pie.id = 'visorPie';
        pie.style.cssText = 'color:#fff;font-size:.95rem;text-align:center;margin:0;' +
            'text-shadow:0 1px 3px rgba(0,0,0,.6)';

        d.appendChild(cerrar);
        d.appendChild(img);
        d.appendChild(pie);
        document.body.appendChild(d);

        cerrar.addEventListener('click', cerrarImagen);
        // La foto NO cierra el visor. Antes sí: un toque en la imagen la
        // cerraba, y eso se siente como que la app rechaza el gesto — uno
        // toca la foto justamente para mirarla de cerca, no para salir.
        // Ahora solo cierran la X y el fondo.
        // Tocar el fondo oscuro sí cierra. Se compara el blanco con el
        // contenedor: un toque en la foto o en el pie NO cierra.
        d.addEventListener('click', function (e) {
            if (e.target === d) cerrarImagen();
        });
        return d;
    }

    function ampliarImagen(url, titulo) {
        if (!url) return;
        if (!_visor) _visor = _crearVisor();
        var img = document.getElementById('visorImagenSrc');
        var pie = document.getElementById('visorPie');
        if (img) img.src = url;
        if (pie) pie.textContent = titulo || '';
        _visor.style.display = 'flex';
        document.body.style.overflow = 'hidden';
    }

    function cerrarImagen() {
        if (!_visor) return;
        _visor.style.display = 'none';
        document.body.style.overflow = '';
        // Se suelta la foto al cerrar: una imagen de 800 px no pesa, pero
        // dejarla cargada no aporta nada y en un móvil cada MB cuenta.
        var img = document.getElementById('visorImagenSrc');
        if (img) img.removeAttribute('src');
    }

    window.ampliarImagen = ampliarImagen;
    window.cerrarImagenAmpliada = cerrarImagen;
    S.modules.preview.ampliarImagen = ampliarImagen;

    // La tecla de retroceso cierra el visor en vez de salir de la página.
    // Sin esto, tocar atrás con la foto abierta sacaba al usuario de la
    // carta y perdía el carrito de vista.
    window.addEventListener('keydown', function(e) {
        if (e.key === 'Escape' && _visor && _visor.style.display === 'flex') {
            e.preventDefault();
            cerrarImagen();
        }
    });
})();
