(function() {
    window.Saki = window.Saki || {};
    window.Saki.state = window.Saki.state || {};
    window.Saki.utils = window.Saki.utils || {};
    window.Saki.modules = window.Saki.modules || {};

    // Private variables that will be set by external code (from Supabase or other modules)
    let menuItems = []; // Array of menu items from Supabase
    let filteredMenuItems = []; // Array after filtering
    // RESPALDO, no fuente de verdad.
    //
    // La carta real vive en la tabla `secciones` desde la migración 13 y se
    // lee en cliente-init.js. Esta lista queda solo para que el cliente no se
    // quede sin carta si la consulta falla (sin señal, base caída).
    //
    // Antes esta lista ERA la carta: renombrar una sección desde el admin
    // hacía desaparecer sus platos, porque el filtro buscaba un nombre que ya
    // no existía. Esa lista quedó congelada y ya no se actualiza.
    let categoriasPredefinidas = [
        {id:'todos',nombre:'Todos los platillos'},
        {id:'favoritos',nombre:'⭐ Favoritos'},
        {id:'entradas',nombre:'Entradas'},
        {id:'sushi',nombre:'Sushi'},
        {id:'rolls',nombre:'Rolls',subcategorias:['Rolls Fríos de 10 piezas','Rolls Tempura de 12 piezas']},
        {id:'tragos',nombre:'Tragos y bebidas'},
        {id:'pokes',nombre:'Pokes'},
        {id:'ensaladas',nombre:'Ensaladas'},
        {id:'china',nombre:'Comida China',subcategorias:['Arroz Chino','Arroz Cantones','Chopsuey','Lomey','Chow Mein','Fideos de Arroz','Tallarines Cantones','Mariscos','Foo Yong','Sopas','Entremeses']},
        {id:'japonesa',nombre:'Comida Japonesa',subcategorias:['Yakimeshi','Yakisoba','Pasta Udon','Churrasco']},
        {id:'ofertas',nombre:'OFERTAS ESPECIALES'},
        {id:'ninos',nombre:'Para Niños'},
        {id:'ejecutivo',nombre:'Combo Ejecutivo'}
    ];
    // Etiqueta corta para la barra lateral.
    //
    // Se separa del `nombre` a propósito: el nombre es el que FILTRA (tiene
    // que coincidir con menu.categoria) y la etiqueta es la que SE VE.
    //
    // Sin esto, "Todos los platillos" (el nombre real) aparecía completo en
    // la barra y empujaba el ancho. Y el filtro de "Sushi" quedaba como
    // " Sushi", con un espacio adelante, por un recorte con expresión regular
    // que le comía la primera letra al ícono.
    let etiquetasCortas = {
        'todos': 'Todos los platillos',
        'favoritos': 'Favoritos'
    };

    let iconosCategorias = {
        'todos':'fa-utensils','entradas':'fa-leaf','sushi':'fa-fish','rolls':'fa-egg',
        'tragos':'fa-wine-glass-alt','pokes':'fa-bowl-food','ensaladas':'fa-carrot',
        'china':'fa-dragon','japonesa':'fa-sun','ofertas':'fa-fire','favoritos':'fa-star',
        'ninos':'fa-child','ejecutivo':'fa-briefcase'
    };
    let ITEMS_POR_PAGINA = 6;
    let _paginaActual = 1;
    let _imageCache = new Set(); // Set of image URLs that have been preloaded
    let _stockPrecalculado = {}; // Will be set by stock module (we'll read from window._stockPrecalculado or Saki.state?)

    // We'll also need references to DOM elements that we will cache
    let menuGrid = null;
    let categoryList = null;
    let categoryTitle = null;
    let searchInput = null;

    // Function to cache DOM elements (called after DOMContentLoaded)
    function cacheDomElements() {
        menuGrid = document.getElementById('menuGrid');
        categoryList = document.getElementById('categoryList');
        categoryTitle = document.getElementById('categoryTitle');
        searchInput = document.getElementById('searchInput');
    }

    // Function to preload images (called when menuItems are loaded)
    function _precargarImagenes(items) {
        items.forEach(item => {
            if (item.imagen && !_imageCache.has(item.imagen)) {
                _imageCache.add(item.imagen);
                const img = new Image();
                img.src = item.imagen;
            }
        });
    }

    // Function to generate HTML for a single menu card
    function _htmlTarjeta(item) {
        // El stock se DERIVA de los ingredientes (stock - reservado), no es un campo
        // propio del platillo. Si no se pudo calcular, se trata como agotado: es mejor
        // bloquear de mas que vender algo que no se puede preparar.
        const stock = window._stockPrecalculado?.[item.id] ?? 0;
        const agotado = stock <= 0 || item.disponible === false;
        const sc = agotado ? 'sold-out' : (stock < 5 ? 'low' : 'available');
        const fav = window.Saki.state.favoritos && window.Saki.state.favoritos.includes(item.id) ? 'active' : '';
        const img = item.imagen || 'https://via.placeholder.com/400x300?text=Sushi';
        const badge = agotado
            ? '<div class="menu-card-sold-overlay"><span>🚫 Agotado</span></div>'
            : (sc === 'low' ? '<div class="menu-card-badge low"><i class="fas fa-exclamation-triangle"></i> Últimas</div>' : '');
        const footer = agotado
            ? '<span class="btn-add disabled" aria-disabled="true" data-id="' + item.id + '"><i class="fas fa-ban"></i> Agotado</span>'
            : `<button class="btn-add" data-id="${item.id}" onclick="agregarAlCarrito('${item.id}')" data-tooltip="Agregar al carrito"><i class="fas fa-plus"></i></button><button class="btn-customize" data-id="${item.id}" onclick="abrirPersonalizacion('${item.id}')" data-tooltip="Personalizar platillo y cantidades"><i class="fas fa-star"></i> Personalizar</button>`;
        // Se muestra el estado tambien cuando esta agotado: antes quedaba vacio y el
        // cliente no entendia por que no habia boton de agregar.
        const stockInfo = `<div class="stock-info"><i class="fas fa-box ${sc}"></i><span>${agotado ? 'Agotado' : stock + ' disponibles'}</span></div>`;
        return `<div class="menu-card${agotado?' agotado':''}" data-id="${item.id}"><div class="menu-card-image" style="background-image:url('${img}')"${agotado?'':` onclick="abrirPreview('${item.id}')"`}>${badge}</div><div class="menu-card-content"><div class="menu-card-header"><div style="display:flex;align-items:center"><button class="favorite-btn ${fav}" onclick="event.stopPropagation();toggleFavorito('${item.id}')" data-id="${item.id}" data-tooltip="${fav?'Quitar de favoritos':'Agregar a favoritos'}"><i class="fas fa-star"></i></button><h3 class="menu-card-title">${item.nombre}</h3></div><span class="menu-card-price">${window.Saki.utils.formatBs(window.Saki.utils.usdToBs(item.precio))}</span></div><p class="menu-card-description">${item.descripcion||''}</p><div class="menu-card-footer">${footer}</div>${stockInfo}</div></div>`;
    }

    // Function to generate pagination HTML
    function _htmlPaginacion(paginaActual, totalPaginas) {
        if (totalPaginas <= 1) return '';
        let inicio = Math.max(1, paginaActual - 1);
        let fin    = Math.min(totalPaginas, inicio + 3);
        if (fin - inicio < 3) inicio = Math.max(1, fin - 3);
        let nums = '';
        for (let p = inicio; p <= fin; p++) {
            nums += `<button class="pagination-num ${p === paginaActual ? 'active' : ''}" onclick="irAPagina(${p})">${p}</button>`;
        }
        return `<div class="pagination-controls"><button class="pagination-btn" onclick="irAPagina(${paginaActual - 1})" ${paginaActual === 1 ? 'disabled' : ''}><i class="fas fa-chevron-left"></i> Anterior</button><div class="pagination-nums">${nums}</div><button class="pagination-btn" onclick="irAPagina(${paginaActual + 1})" ${paginaActual === totalPaginas ? 'disabled' : ''}>Siguiente <i class="fas fa-chevron-right"></i></button></div>`;
    }

    // Function to render the current page of the menu
    function renderizarPaginaActual() {
        if (!menuGrid) return;
        if (filteredMenuItems.length === 0) {
            menuGrid.innerHTML = '<div class="loading-container"><p>No hay platillos</p></div>';
            return;
        }
        const totalPaginas = Math.ceil(filteredMenuItems.length / ITEMS_POR_PAGINA);
        _paginaActual = Math.max(1, Math.min(_paginaActual, totalPaginas));
        const pagItems = filteredMenuItems.slice((_paginaActual - 1) * ITEMS_POR_PAGINA, _paginaActual * ITEMS_POR_PAGINA);
        // Render directo, síncrono, sin observer ni RAF — tarjetas siempre visibles
        menuGrid.innerHTML = pagItems.map(_htmlTarjeta).join('') + _htmlPaginacion(_paginaActual, totalPaginas);

        // Punto de enganche de la disponibilidad.
        //
        // Cada repintado reescribe el innerHTML, así que cualquier marca
        // anterior desaparece: filtros, búsqueda, cambio de página. Si la
        // capa se aplicara solo en el arranque (como estaba), la regla se
        // perdía en el primer clic en una categoría.
        //
        // Se engancha AQUÍ y no en renderizarMenuPaginado porque esta función
        // también se llama al paginar, que no pasa por allá.
        //
        // La referencia se guarda al cargar para no depender del orden de los
        // scripts: cliente-disponibilidad.js puede no haber corrido aún.
        if (window.actualizarDisponibilidadMenu) {
            window.actualizarDisponibilidadMenu();
        } else {
            (window._pendientesDisponibilidad = window._pendientesDisponibilidad || []).push(1);
        }
    }

    // Function to render the menu with given filters
    function renderizarMenuPaginado(filtroCategoria = null, filtroSubcategoria = null, busqueda = '') {
        // Start with all menu items from shared state
        let items = [...(window.Saki.state.menuItems || [])];
        // Apply category filter
        if (filtroCategoria === 'favoritos') {
            items = items.filter(i => window.Saki.state.favoritos && window.Saki.state.favoritos.includes(i.id));
        } else if (filtroCategoria === 'ofertas') {
            items = items.filter(i => i.categoria === 'Ofertas Especiales' || i.precio < 10);
        } else if (filtroCategoria && filtroCategoria !== 'todos') {
            items = items.filter(i => i.categoria === filtroCategoria);
        }
        // Apply subcategory filter
        if (filtroSubcategoria) {
            items = items.filter(i => i.subcategoria === filtroSubcategoria);
        }
        // Apply search
        if (busqueda) {
            const t = busqueda.toLowerCase().split(/\s+/).filter(x => x.length > 0);
            items = items.filter(i => t.every(x => i.nombre.toLowerCase().includes(x)));
        }
        filteredMenuItems = items;
        // Update last category in localStorage
        if (filtroCategoria) {
            localStorage.setItem('saki_ultima_categoria', filtroCategoria);
        } else if (filtroCategoria === null) {
            localStorage.setItem('saki_ultima_categoria', 'todos');
        }
        _paginaActual = 1;
        renderizarPaginaActual();
    }

    /**
     * Arma la lista de secciones para pintar la barra lateral.
     *
     * Prioridad:
     *   1. La tabla `secciones` (fuente de verdad, la administra el dueño).
     *   2. La lista de respaldo escrita acá, si la consulta falló.
     *
     * Ojo con "Todos los platillos": en la tabla su id es 'todos' y su nombre
     * es largo. La barra lateral necesita el nombre corto, así que se respeta
     * el nombre que ya se mostraba para no cambiar la vista en el paso 2.
     */
    /**
     * ¿La sección se puede mostrar ahora?
     *
     * Dos motivos para ocultarla:
     *   - el admin la marcó como no visible
     *   - está fuera de su horario (ej: Tragos antes de las 11 o después de
     *     la 1 de la mañana, por el horario legal de expendio de alcohol)
     *
     * El horario puede cruzar la medianoche (11:00 a 01:00). En ese caso
     * "hasta" es menor que "desde", y la condición se invierte.
     */
    function _seccionVisibleAhora(s, ahora) {
        if (s.visible === false) return false;

        if (!s.hora_desde || !s.hora_hasta) return true;

        var minutosAhora = ahora.getHours() * 60 + ahora.getMinutes();
        var d = _aMinutos(s.hora_desde);
        var h = _aMinutos(s.hora_hasta);
        if (d === null || h === null) return true;

        if (d === h) return true;                 // todo el día
        if (d < h) return minutosAhora >= d && minutosAhora < h;
        // Cruza la medianoche: 11:00 -> 01:00
        return minutosAhora >= d || minutosAhora < h;
    }

    function _aMinutos(hhmm) {
        if (!hhmm) return null;
        var partes = String(hhmm).split(':');
        var hh = parseInt(partes[0], 10);
        var mm = parseInt(partes[1] || '0', 10);
        if (isNaN(hh) || isNaN(mm)) return null;
        return hh * 60 + mm;
    }

    function _obtenerSecciones() {
        var deBase = (window.Saki.state.secciones || []);
        if (!deBase.length) return categoriasPredefinidas;

        var ahora = new Date();
        var madres = deBase
            .filter(function (s) { return !s.madre_id; })
            .filter(function (s) { return _seccionVisibleAhora(s, ahora); });
        return madres.map(function (s) {
            var hijas = deBase
                .filter(function (h) { return h.madre_id === s.id; })
                .sort(function (a, b) { return a.orden - b.orden; })
                .map(function (h) { return h.nombre; });

            var seccion = {
                id: s.id,
                // `nombre` es el valor que FILTRA: tiene que coincidir con
                // menu.categoria o menu.subcategoria. Viene de la base.
                nombre: s.nombre,
                // `etiqueta` es lo que SE VE en la barra lateral.
                etiqueta: etiquetasCortas[s.id] || s.nombre,
                icono: s.icono,
                hora_desde: s.hora_desde,
                hora_hasta: s.hora_hasta
            };
            // Solo las que tienen hijas llevan subcategorías; si va vacío, el
            // código de abajo dibuja la sección sin la flechita.
            if (hijas.length) seccion.subcategorias = hijas;
            return seccion;
        });
    }

    // Function to load categories into the sidebar
    function cargarCategorias() {
        if (!categoryList) return;
        let html = '';
        _obtenerSecciones().forEach(cat => {
            // Sección nueva creada desde el admin: si no tiene ícono propio,
            // se usa el genérico. Nunca queda sin dibujar.
            const icono = cat.icono || iconosCategorias[cat.id] || 'fa-utensils';
            const activeClass = cat.id === 'todos' ? 'active' : '';
            // data-filtro lleva el NOMBRE real (el que compara el filtro).
            // El texto visible lleva la etiqueta corta.
            // `cat.etiqueta` puede venir undefined cuando se usa la lista de
            // RESPALDO (esa lista solo tiene `nombre`). Sin el respaldo acá, la
            // barra lateral mostraba la palabra "undefined" en cada sección.
            const textoVisible = cat.etiqueta || cat.nombre;
            html += `<li class="category-item ${activeClass}" data-categoria="${cat.id}" data-filtro="${cat.nombre}"><span><i class="fas ${icono}"></i> ${textoVisible}</span>${cat.subcategorias ? '<i class="fas fa-chevron-right"></i>' : ''}</li>`;
            if (cat.subcategorias) {
                html += `<ul class="subcategory-list" data-categoria="${cat.id}">`;
                cat.subcategorias.forEach(sub => html += `<li class="subcategory-item" data-subcategoria="${sub}">${sub}</li>`);
                html += `</ul>`;
            }
        });
        categoryList.innerHTML = html;

        // Add event listeners to category items
        document.querySelectorAll('.category-item').forEach(item => {
            item.addEventListener('click', (e) => {
                e.stopPropagation();
                const categoria = item.dataset.categoria;
                const tieneSubcategorias = item.querySelector('i.fa-chevron-right') !== null;
                if (tieneSubcategorias && categoria !== 'todos' && categoria !== 'favoritos') {
                    const subList = document.querySelector(`.subcategory-list[data-categoria="${categoria}"]`);
                    if (subList) {
                        subList.classList.toggle('expanded');
                    }
                    return;
                }
                document.querySelectorAll('.category-item').forEach(c => c.classList.remove('active'));
                item.classList.add('active');
                document.querySelectorAll('.subcategory-list').forEach(list => list.classList.remove('expanded'));
                if (categoryTitle) {
                    categoryTitle.textContent = categoria === 'todos' ? 'Menú' : item.querySelector('span').textContent.replace(/^[^\s]+\s/, '');
                }
                if (searchInput) {
                    searchInput.value = '';
                }
                // Se filtra por el NOMBRE (data-filtro), no por la clave.
                // Antes se pasaba la clave ('sushi') y la base guarda el
                // nombre ('Sushi'): nunca coincidían y la sección salía vacía.
                const nombreFiltro = item.dataset.filtro || categoria;
                renderizarMenuPaginado(categoria === 'todos' ? null : nombreFiltro);
                // Close sidebar on mobile if needed
                if (window.innerWidth <= 992) {
                    // We'll close the category sidebar by removing the 'open' class if present
                    const categorySidebar = document.getElementById('categorySidebar');
                    if (categorySidebar) {
                        categorySidebar.classList.remove('open');
                    }
                }
            });
        });

        // Add event listeners to subcategory items
        document.querySelectorAll('.subcategory-item').forEach(item => {
            item.addEventListener('click', (e) => {
                e.stopPropagation();
                const subcategoria = item.dataset.subcategoria;
                const categoria = item.closest('.subcategory-list').dataset.categoria;
                document.querySelectorAll('.category-item').forEach(c => c.classList.remove('active'));
                document.querySelector(`.category-item[data-categoria="${categoria}"]`).classList.add('active');
                document.querySelectorAll('.subcategory-item').forEach(s => s.classList.remove('active'));
                item.classList.add('active');
                if (categoryTitle) {
                    categoryTitle.textContent = subcategoria;
                }
                if (searchInput) {
                    searchInput.value = '';
                }
                // Igual que arriba: se filtra por el NOMBRE de la madre
                // ('Rolls'), no por su clave ('rolls'). Con la clave, el
                // filtro de categoría descartaba todo antes de llegar a la
                // subcategoría, y la sección salía vacía.
                const madreEl = document.querySelector(`.category-item[data-categoria="${categoria}"]`);
                const nombreMadre = (madreEl && madreEl.dataset.filtro) || categoria;
                renderizarMenuPaginado(nombreMadre, subcategoria);
                // Close sidebar on mobile if needed
                if (window.innerWidth <= 992) {
                    const categorySidebar = document.getElementById('categorySidebar');
                    if (categorySidebar) {
                        categorySidebar.classList.remove('open');
                    }
                }
            });
        });
    }

    // Function to reset to all categories
    function resetToAllCategories(scroll = true) {
        // Close all panels (we'll assume a function exists, but we can also just remove active classes)
        document.querySelectorAll('.category-item').forEach(c => c.classList.remove('active'));
        const todosItem = document.querySelector('.category-item[data-categoria="todos"]');
        if (todosItem) todosItem.classList.add('active');
        document.querySelectorAll('.subcategory-list').forEach(l => l.classList.remove('expanded'));
        if (categoryTitle) {
            categoryTitle.textContent = 'Menú';
        }
        if (searchInput) {
            searchInput.value = '';
        }
        renderizarMenuPaginado(null);
        if (scroll) {
            window.scrollTo({ top: 0, behavior: 'smooth' });
        }
    }

    // Function to select a category by name (used by tagline items)
    function selectCategoria(cat) {
        const catEl = document.querySelector(`.category-item[data-categoria="${cat}"]`);
        if (catEl) {
            catEl.click();
        }
    }

    // Exponer en Saki.modules y window para compatibilidad
    window.Saki.modules.menu = {
        cacheDomElements: cacheDomElements,
        _precargarImagenes: _precargarImagenes,
        _htmlTarjeta: _htmlTarjeta,
        _htmlPaginacion: _htmlPaginacion,
        renderizarPaginaActual: renderizarPaginaActual,
        renderizarMenuPaginado: renderizarMenuPaginado,
        cargarCategorias: cargarCategorias,
        resetToAllCategories: resetToAllCategories,
        selectCategoria: selectCategoria
    };
    window.cacheDomElements = cacheDomElements;
    window._precargarImagenes = _precargarImagenes;
    window._htmlTarjeta = _htmlTarjeta;
    window._htmlPaginacion = _htmlPaginacion;
    window.renderizarPaginaActual = renderizarPaginaActual;
    window.renderizarMenuPaginado = renderizarMenuPaginado;
    window.cargarCategorias = cargarCategorias;
    window.resetToAllCategories = resetToAllCategories;
    window.selectCategoria = selectCategoria;

})();