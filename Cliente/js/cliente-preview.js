// cliente-preview.js - Modal preview de platillos
(function() {
    window.Saki = window.Saki || {};
    window.Saki.modules = window.Saki.modules || {};
    window.Saki.modules.preview = {};
    var S = window.Saki;

    var _currentPreviewId = null;

    function abrirPreview(platilloId) {
        var item = (S.state.menuItems || []).find(function(i) { return i.id == platilloId; });
        if (!item) return;
        _currentPreviewId = platilloId;

        var modal = document.getElementById('customizeModal'); // Reuse same modal
        var body = document.getElementById('customizeModalBody');
        if (!modal || !body) return;

        var precioBs = S.utils.usdToBs(item.precio || 0);
        // LA MISMA FOTO QUE YA ESTÁ EN PANTALLA, NO UNA NUEVA.
        //
        // Antes esta vista pedía `w=1200` mientras la tarjeta sirve `w=800`.
        // Son URLs distintas para el navegador, así que abrir el modal
        // obligaba a bajar la foto otra vez: medido con el Dragon Roll,
        // 283 KB por una imagen que ya estaba en caché a 125 KB.
        // Eso es lo que hacía que el modal tardara.
        //
        // La tarjeta se ve a 160 px de alto y la imagen del modal a 250,
        // y en un teléfono de 390 px de ancho 800 px sobra. Se usa la misma
        // URL optimizada: carga instantánea, sin volver a la red.
        var imagen = item.imagen || '';
        if (window.optimizarUrlImagen && item.imagen) {
            imagen = window.optimizarUrlImagen(item.imagen);
        }
        // Si no hay foto, no se inventa un hueco: se pinta un aviso legible.
        var bloqueImagen = imagen
            ? '<img id="previewImagenAmpliable" src="' + imagen + '" alt="' + item.nombre + '" ' +
              'title="Toca para ampliar" ' +
              'style="width:100%;height:250px;object-fit:cover;border-radius:var(--radius-md);' +
              'margin-bottom:1rem;cursor:zoom-in;display:block">'
            : '<div style="height:120px;display:flex;align-items:center;justify-content:center;' +
              'color:var(--text-muted);background:var(--superficie-2);border-radius:var(--radius-md);' +
              'margin-bottom:1rem"><i class="fas fa-image" style="margin-right:.5rem"></i>Sin foto</div>';
        // ingredientes en DB es objeto {id: {nombre, cantidad}}, convertimos a array
        var ingredientesObj = item.ingredientes || {};
        var ingredientes = Object.entries(ingredientesObj).map(function(e) {
            var ingInfo = e[1];
            return { nombre: ingInfo.nombre || e[0] };
        });

        var html = '<div class="preview-modal">' +
            bloqueImagen +
            '<h3 style="color:var(--accent);margin-bottom:.3rem;font-size:1.3rem">' + item.nombre + '</h3>' +
            '<p style="color:var(--text-secondary);font-size:.9rem;margin-bottom:.8rem">' + (item.descripcion || 'Sin descripción') + '</p>' +
            '<div style="font-size:1.2rem;font-weight:700;color:var(--accent);margin-bottom:1rem">' + S.utils.formatBs(precioBs) + '</div>';

        if (ingredientes.length > 0) {
            html += '<div class="preview-ingredientes" style="background:rgba(0,0,0,.2);padding:1rem;border-radius:var(--radius-md);margin-bottom:1rem">' +
                '<h4 style="color:var(--accent);margin-bottom:.5rem;font-size:.9rem"><i class="fas fa-list"></i> Ingredientes</h4>' +
                '<ul style="list-style:none;display:flex;flex-wrap:wrap;gap:.5rem">';
            ingredientes.forEach(function(ing) {
                html += '<li style="background:rgba(255,255,255,.1);padding:.3rem .8rem;border-radius:20px;font-size:.8rem">' + ing.nombre + '</li>';
            });
            html += '</ul></div>';
        }

        // Stock info inline (evita getStockTexto que no existe)
        var stock = window._stockPrecalculado?.[platilloId] ?? 999;
        var stockInfo = stock <= 0
            ? '<span style="color:var(--danger)"><i class="fas fa-times-circle"></i> Agotado</span>'
            : (stock < 5
                ? '<span style="color:var(--warning)"><i class="fas fa-exclamation-triangle"></i> Últimas ' + stock + ' disponibles</span>'
                : '');
        if (stockInfo) {
            html += '<div class="stock-info" style="margin-bottom:1rem">' + stockInfo + '</div>';
        }

        // EL FOOTER YA EXISTE Y ES EL DEL MODAL.
        //
        // Antes se inyectaba aquí un segundo par de botones DENTRO del
        // cuerpo, y el footer del modal seguía visible: la pantalla
        // mostraba «Personalizar / Añadir» arriba y «Cancelar / Añadir»
        // abajo. Dos «Añadir», y ninguno era el que el usuario esperaba.
        //
        // Ahora este modal solo pinta su contenido y se apoya en el
        // footer que ya está en el HTML: «Cancelar» + «Añadir». Para
        // personalizar se toca la tarjeta del menú (estrella) o el
        // propio plato; aquí no hace falta un segundo camino.
        body.innerHTML = html;

        // El <h3> del modal es quien muestra el nombre. Se usa textContent
        // para que un nombre con `<` no rompa el encabezado.
        var titulo = document.getElementById('customizeModalHeader');
        if (titulo) titulo.textContent = item.nombre;
        modal.classList.add('active');

        // El botón «Añadir» del footer NO se reconecta aquí.
        //
        // cliente-ui.js ya lo deja atado a `conAccionUnica` (el freno que
        // evita que un doble toque meta el plato dos veces). Reemplazar el
        // nodo habría borrado ese freno en silencio. En su lugar se marca
        // el modo: el handler mira `window._previewPlatilloId` y sabe si
        // debe agregar el plato tal cual o el personalizado.
        window._previewPlatilloId = platilloId;

        // «Cancelar» y la X sí necesitan un cierre limpio, y su binding
        // base solo quita la clase: se dejan como están. Al cerrar se
        // limpia el modo para no dejar el flag vivo.
        var cancelBtn = document.getElementById('cancelCustomize');
        if (cancelBtn) {
            cancelBtn.addEventListener('click', function() {
                window._previewPlatilloId = null;
            });
        }
        var closeBtn = document.getElementById('closeCustomizeModal');
        if (closeBtn) {
            closeBtn.addEventListener('click', function() {
                window._previewPlatilloId = null;
            });
        }

        // La imagen del modal se expande a pantalla completa al tocarla.
        var imgPreview = document.getElementById('previewImagenAmpliable');
        if (imgPreview) {
            imgPreview.addEventListener('click', function() {
                if (window.ampliarImagen) window.ampliarImagen(imagen, item.nombre);
            });
        }
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
        img.addEventListener('click', cerrarImagen);
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
