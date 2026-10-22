(function() {
    window.Saki = window.Saki || {};
    window.Saki.state = window.Saki.state || {};
    window.Saki.utils = window.Saki.utils || {};
    window.Saki.modules = window.Saki.modules || {};

    // Initialize favoritos from localStorage if not already set
    if (!Array.isArray(window.Saki.state.favoritos)) {
        const saved = localStorage.getItem('saki_favoritos');
        window.Saki.state.favoritos = saved ? JSON.parse(saved) : [];
    }

    // Function to save favoritos to localStorage
    function guardarFavoritos() {
        localStorage.setItem('saki_favoritos', JSON.stringify(window.Saki.state.favoritos));
    }

    function toggleFavorito(platilloId) {
        const index = window.Saki.state.favoritos.indexOf(platilloId);
        if (index === -1) {
            window.Saki.state.favoritos.push(platilloId);
            window.Saki.utils.mostrarToast('⭐ Agregado a favoritos', 'success');
        } else {
            window.Saki.state.favoritos.splice(index, 1);
            window.Saki.utils.mostrarToast('⭐ Eliminado de favoritos', 'info');
        }
        guardarFavoritos();

        // Attempt to re-render the menu to reflect the favorite change
        // First try the global function from inline JS (available during transition),
        // then try the menu module (available after inline JS is removed).
        function renderizarMenuActual() {
            const activeCategoryEl = document.querySelector('.category-item.active');
            const activeCategory = activeCategoryEl ? activeCategoryEl.dataset.categoria : null;
            const searchValue = document.getElementById('searchInput')?.value || '';
            let renderFn = null;
            if (typeof window.renderizarMenuPaginado === 'function') {
                renderFn = window.renderizarMenuPaginado;
            } else if (window.Saki.modules.menu && typeof window.Saki.modules.menu.renderizarMenuPaginado === 'function') {
                renderFn = window.Saki.modules.menu.renderizarMenuPaginado;
            }
            if (renderFn) {
                if (activeCategory === 'favoritos') {
                    renderFn('favoritos', null, searchValue);
                } else {
                    const catToRender = activeCategory === 'todos' ? null : activeCategory;
                    renderFn(catToRender, null, searchValue);
                }
            }
        }
        renderizarMenuActual();
    }

    function esFavorito(platilloId) {
        return window.Saki.state.favoritos.includes(platilloId);
    }

    // Exponer en Saki.modules y window para compatibilidad
    window.Saki.modules.favoritos = {
        toggleFavorito: toggleFavorito,
        esFavorito: esFavorito
    };
    window.toggleFavorito = toggleFavorito;
    window.esFavorito = esFavorito;

})();