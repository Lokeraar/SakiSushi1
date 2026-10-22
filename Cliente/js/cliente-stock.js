(function() {
    window.Saki = window.Saki || {};
    window.Saki.state = window.Saki.state || {};
    window.Saki.utils = window.Saki.utils || {};
    window.Saki.modules = window.Saki.modules || {};

    // Private variables for stock management
    let stockCache = new Map(); // Map<ingredienteId, disponible>
    let stockPrecalculado = {}; // Map<platilloId, disponible>
    let inventario = []; // Will be set by external code (from Supabase)
    let menuItems = []; // Will be set by external code (from Supabase)
    let carrito = []; // Will be set by external code (from Supabase or localStorage)

    // Reverse index: Map<ingredienteId, Set<platilloId>>
    // Permite invalidar solo platillos afectados cuando cambia un ingrediente
    let ingredientePlatillosIndex = new Map();

    // Build/rebuild the reverse index from menuItems
    function construirIndiceInverso() {
        ingredientePlatillosIndex.clear();
        for (const item of menuItems) {
            if (item.ingredientes && typeof item.ingredientes === 'object') {
                for (const ingId of Object.keys(item.ingredientes)) {
                    if (!ingredientePlatillosIndex.has(ingId)) {
                        ingredientePlatillosIndex.set(ingId, new Set());
                    }
                    ingredientePlatillosIndex.get(ingId).add(item.id);
                }
            }
        }
    }

    // Target stock update for a single ingredient change
    // Recalculates ONLY platillos that use this ingredient
    // O(changed) instead of O(80) — diseño spec R-06
    function actualizarStockPorIngrediente(ingredienteId) {
        if (!ingredientePlatillosIndex.has(ingredienteId)) return;

        const platillosAfectados = ingredientePlatillosIndex.get(ingredienteId);

        // Build reservadoPorCarrito (needs full carrito loop — unavoidable)
        const reservadoPorCarrito = {};
        carrito.forEach(function(inst) {
            const pl = menuItems.find(function(p) { return p.id === inst.platilloId; });
            if (!pl || !pl.ingredientes) return;
            Object.entries(pl.ingredientes).forEach(function(_a) {
                var ingId = _a[0], ingInfo = _a[1];
                if (!(inst.personalizacion && inst.personalizacion.includes(ingId))) {
                    reservadoPorCarrito[ingId] = (reservadoPorCarrito[ingId] || 0) + (ingInfo.cantidad || 1);
                }
            });
        });

        // Only recalculate affected platillos
        platillosAfectados.forEach(function(platilloId) {
            var item = menuItems.find(function(p) { return p.id === platilloId; });
            if (!item || !item.ingredientes) return;

            var minStock = Infinity;
            for (var ingId in item.ingredientes) {
                if (!item.ingredientes.hasOwnProperty(ingId)) continue;
                var ingInfo = item.ingredientes[ingId];
                var ing = inventario.find(function(i) { return i.id === ingId; });
                if (!ing) { minStock = 0; break; }
                var libre = (ing.stock || 0) - (ing.reservado || 0) - (reservadoPorCarrito[ingId] || 0);
                minStock = Math.min(minStock, Math.floor(libre / (ingInfo.cantidad || 1)));
            }
            stockPrecalculado[platilloId] = minStock === Infinity ? 999 : Math.max(0, minStock);
        });

        window._stockPrecalculado = stockPrecalculado;
        actualizarStockTarjetas();
    }

    // Initialize stockCache as a Map with a method to invalidate
    stockCache.invalidate = function() {
        this.clear();
    };

    // Function to get stock disponibility for an ingredient
    // Uses cache if available, otherwise calculates and caches
    async function getStockDisponible(ingredienteId) {
        // Check cache first
        if (stockCache.has(ingredienteId)) {
            return stockCache.get(ingredienteId);
        }

        // If not in cache, calculate
        const ingrediente = inventario.find(i => i.id === ingredienteId);
        if (!ingrediente) {
            stockCache.set(ingredienteId, 0);
            return 0;
        }

        // Calculate reserved in carrito for this ingredient
        let reservadoEnCarrito = 0;
        carrito.forEach(instancia => {
            if (instancia.platilloId) {
                const platillo = menuItems.find(p => p.id === instancia.platilloId);
                if (platillo && platillo.ingredientes && platillo.ingredientes[ingredienteId] && 
                    !(instancia.personalizacion && instancia.personalizacion.includes(ingredienteId))) {
                    reservadoEnCarrito += platillo.ingredientes[ingredienteId].cantidad || 1;
                }
            }
        });

        const disponible = (ingrediente.stock || 0) - (ingrediente.reservado || 0) - reservadoEnCarrito;
        stockCache.set(ingredienteId, disponible);
        return disponible;
    }

    // Function to update stock badges on already rendered menu cards
    // Called after precalcularStockMenu() to update the DOM without full re-render
    function actualizarStockTarjetas() {
        // We'll use the globally available function from the inline JS if it exists,
        // but we are going to reimplement it here in a way that uses our internal state.
        // However, note that the original function in the inline JS uses:
        //   _stockPrecalculado (which we are calling stockPrecalculado)
        //   and updates the DOM elements.

        // Since we are in the process of extracting, we'll try to use the global variable if it exists,
        // but we also want to be self-contained. However, the design says we should not rely on
        // globals from the inline JS after extraction. We'll assume that the external code (like
        // cliente-menu.js) will have set the necessary globals.

        // We'll try to use the global _stockPrecalculado if it exists, otherwise use our own.
        const stockPrecalculadoGlobal = window._stockPrecalculado || stockPrecalculado;

        document.querySelectorAll('.menu-card').forEach(card => {
            // El id sale del contenedor, NO del boton: una tarjeta agotada no tiene
            // boton de agregar, y antes eso hacia que la tarjeta nunca se actualizara.
            const platilloId = card.dataset.id;
            if (!platilloId) return;

            const stock = stockPrecalculadoGlobal[platilloId] ?? 0;
            const agotado = stock <= 0;
            const sc = agotado ? 'sold-out' : (stock < 5 ? 'low' : 'available');

            // Update stock-info
            const stockInfo = card.querySelector('.stock-info:not(.menu-card-footer .stock-info)') 
                            || card.querySelector('div.stock-info');
            if (stockInfo) {
                if (agotado) {
                    stockInfo.innerHTML = '';
                } else {
                    stockInfo.innerHTML = `<i class="fas fa-box ${sc}"></i><span>${stock} disponibles</span>`;
                }
            }

            // Update badge agotado (sold out overlay)
            const overlay = card.querySelector('.menu-card-sold-overlay');
            const badge = card.querySelector('.menu-card-badge');
            if (agotado && !overlay) {
                const imgDiv = card.querySelector('.menu-card-image');
                if (imgDiv) imgDiv.insertAdjacentHTML('beforeend', '<div class="menu-card-sold-overlay"><span>🚫 Agotado</span></div>');
            } else if (!agotado && overlay) {
                overlay.remove();
            }
            if (!agotado && !badge && stock < 5) {
                const imgDiv = card.querySelector('.menu-card-image');
                if (imgDiv) imgDiv.insertAdjacentHTML('beforeend', '<div class="menu-card-badge low"><i class="fas fa-exclamation-triangle"></i> Últimas</div>');
            } else if ((agotado || stock >= 5) && badge) {
                badge.remove();
            }

            // Disable/enable buttons
            card.querySelectorAll('.btn-add, .btn-customize').forEach(b => {
                b.disabled = agotado;
                b.style.opacity = agotado ? '0.4' : '';
            });
            card.classList.toggle('agotado', agotado);
        });
    }

    // Function to precalculate stock for the entire menu
    // This should be called whenever carrito, menuItems, or inventario changes
    function precalcularStockMenu() {
        // Sync from shared state
        if (window.Saki && window.Saki.state) {
            menuItems = window.Saki.state.menuItems || [];
            inventario = window.Saki.state.inventario || [];
            carrito = window.Saki.state.carrito || [];
        }

        // Reset the stockPrecalculado
        stockPrecalculado = {};

        // Build a map of how many units each ingredient is reserved by the current carrito
        const reservadoPorCarrito = {};
        carrito.forEach(inst => {
            const pl = menuItems.find(p => p.id === inst.platilloId);
            if (!pl?.ingredientes) return;
            Object.entries(pl.ingredientes).forEach(([ingId, ingInfo]) => {
                // Only count if the ingredient is not removed via personalizacion
                if (!(inst.personalizacion && inst.personalizacion.includes(ingId))) {
                    reservadoPorCarrito[ingId] = (reservadoPorCarrito[ingId] || 0) + (ingInfo.cantidad || 1);
                }
            });
        });

        // For each menu item, calculate the minimum stock across its ingredients
        for (const item of menuItems) {
            if (item.ingredientes && Object.keys(item.ingredientes).length > 0) {
                let minStock = Infinity;
                for (const [ingId, ingInfo] of Object.entries(item.ingredientes)) {
                    const ing = inventario.find(i => i.id === ingId);
                    if (!ing) { 
                        minStock = 0; 
                        break; 
                    }
                    // The free stock of the ingredient is: stock - reserved (by others) - reservedByCarrito
                    const libre = (ing.stock || 0) - (ing.reservado || 0) - (reservadoPorCarrito[ingId] || 0);
                    // The maximum number of this dish we can make is libre divided by the quantity per dish
                    minStock = Math.min(minStock, Math.floor(libre / (ingInfo.cantidad || 1)));
                }
                stockPrecalculado[item.id] = minStock === Infinity ? 0 : Math.max(0, minStock);
            } else {
                // Sin receta no hay forma de calcular disponibilidad. Antes se usaba
                // stock_maximo || 999 y eso pintaba platillos agotados como disponibles.
                // Se asume 0 (agotado) y se avisa por consola para poder corregir la receta.
                console.warn('[stock] platillo sin receta de ingredientes:', item.nombre || item.id);
                stockPrecalculado[item.id] = 0;
            }
        }

        // Rebuild reverse index for targeted updates
        construirIndiceInverso();

        // Also set the global variable so that the inline JS (if still present) can use it
        window._stockPrecalculado = stockPrecalculado;
    }

    // Get stock display text for a platillo (used by preview, etc.)
    function getStockTexto(platilloId) {
        var stock = window._stockPrecalculado?.[platilloId] ?? 999;
        if (stock <= 0) return '<span style="color:var(--danger)"><i class="fas fa-times-circle"></i> Agotado</span>';
        if (stock < 5) return '<span style="color:var(--warning)"><i class="fas fa-exclamation-triangle"></i> Últimas ' + stock + ' disponibles</span>';
        return '<span style="color:var(--success)"><i class="fas fa-check-circle"></i> ' + stock + ' disponibles</span>';
    }

    // Expose the necessary functions to Saki.modules and window for compatibility
    window.Saki.modules.stock = {
        getStockDisponible: getStockDisponible,
        getStockTexto: getStockTexto,
        actualizarStockTarjetas: actualizarStockTarjetas,
        precalcularStockMenu: precalcularStockMenu,
        construirIndiceInverso: construirIndiceInverso,
        actualizarStockPorIngrediente: actualizarStockPorIngrediente,
    };
    window.getStockTexto = getStockTexto;
    window.getStockDisponible = getStockDisponible;
    window.actualizarStockTarjetas = actualizarStockTarjetas;
    window.precalcularStockMenu = precalcularStockMenu;
    window.construirIndiceInverso = construirIndiceInverso;
    window.actualizarStockPorIngrediente = actualizarStockPorIngrediente;

})();