(function() {
    window.Saki = window.Saki || {};
    window.Saki.state = window.Saki.state || {};
    window.Saki.utils = window.Saki.utils || {};
    window.Saki.modules = window.Saki.modules || {};

    // Private variables to hold references and observers
    let cartItems = null; // #cartItems element
    let flechasOverlay = null; // #flechasOverlay element
    let flechasObserver = null; // IntersectionObserver instance
    let scrollTimeout = null; // For resize handling

    // Function to initialize the scroll tracking
    function iniciarSeguimientoScroll() {
        // Cache elements if not already done
        if (!cartItems) cartItems = document.getElementById('cartItems');
        if (!flechasOverlay) flechasOverlay = document.getElementById('flechasOverlay');
        if (!cartItems || !flechasOverlay) return;

        // If there's an existing observer, disconnect it first
        if (flechasObserver) {
            flechasObserver.disconnect();
            flechasObserver = null;
        }

        // Populate the overlay with a clone of the scroll indicator
        flechasOverlay.innerHTML = '';
        const src = cartItems.querySelector('.scroll-indicator-cascade');
        if (!src) return;
        const clone = src.cloneNode(true);
        clone.style.cssText = ''; // Remove inline styles, overlay will have its own
        clone.addEventListener('click', irABotonesAccion);
        flechasOverlay.appendChild(clone);

        // Set up IntersectionObserver to watch the original scroll indicator
        // The root is the cartItems container, so we detect visibility within the cart's scroll
        flechasObserver = new IntersectionObserver(function(entries) {
            const visible = entries[0].isIntersecting;
            flechasOverlay.style.display = visible ? 'none' : 'block';
        }, { root: cartItems, threshold: 0.1 });

        flechasObserver.observe(src);
    }

    // Function to stop the scroll tracking
    function detenerSeguimientoScroll() {
        if (cartItems && flechasObserver) {
            flechasObserver.disconnect();
            flechasObserver = null;
        }
        if (flechasOverlay) {
            flechasOverlay.style.display = 'none';
            flechasOverlay.innerHTML = '';
        }
    }

    // Function to smoothly scroll to the action buttons (cart footer)
    function irABotonesAccion() {
        const cartFooter = document.getElementById('cartFooter');
        if (!cartFooter) return;

        // Scroll the cart footer into view with smooth behavior
        cartFooter.scrollIntoView({ behavior: 'smooth', block: 'center' });

        // Optional: animate the action buttons (the original code had a button nudge effect)
        // We'll replicate the button nudge animation from the original code
        setTimeout(() => {
            const botonesAccion = document.querySelectorAll('#cartButtons .btn-primary, #cartButtons .btn-secondary');
            botonesAccion.forEach(btn => {
                // Wrap the button in a span that reserves the fixed space in the layout.
                // The rotate is applied to the button internally — the span doesn't move.
                let wrapper = btn.parentElement;
                if (!wrapper || !wrapper.classList.contains('btn-nudge-wrapper')) {
                    wrapper = document.createElement('span');
                    wrapper.className = 'btn-nudge-wrapper';
                    wrapper.style.cssText = 'display:inline-flex;flex:1;min-width:0;';
                    btn.parentElement.insertBefore(wrapper, btn);
                    wrapper.appendChild(btn);
                }
                btn.classList.remove('btn-accion-animate');
                // Trigger reflow to restart animation
                void btn.offsetWidth;
                btn.classList.add('btn-accion-animate');
                btn.addEventListener('animationend', () => btn.classList.remove('btn-accion-animate'), { once: true });
            });
        }, 350);
    }

    // Function to scroll to a specific item in the cart (by instance ID)
    function scrollAlItemAgregado(itemId) {
        setTimeout(() => {
            const itemElement = document.querySelector(`[data-instancia-id="${itemId}"]`);
            if (itemElement) {
                itemElement.scrollIntoView({ behavior: 'smooth', block: 'center' });
            }
        }, 300);
    }

    // Function to pre-expand cart levels and scroll to the last added item
    // This is called after adding an item to the cart to ensure the item is visible
    function _enfocarUltimoItemCarrito(instancia) {
        if (!instancia) return;

        // Pre-expand levels using the exact IDs that the render function generates
        const grupoId = instancia.platilloId.replace(/[^a-zA-Z0-9]/g, '_');
        const persKey = (instancia.personalizacion || []).slice().sort().join('|');
        const subgrupoId = `${grupoId}_${instancia.platilloId}_${persKey.replace(/[^a-zA-Z0-9]/g, '_')}`;
        // Set the globals that the render function uses (if they exist)
        // Note: These globals are set by the cart module (cliente-carrito.js) before calling actualizarCarritoUI.
        // We are setting them here to ensure the cart renders expanded.
        // However, the cart module is responsible for setting these before calling actualizarCarritoUI.
        // We'll set them here as well to be safe, but note that the cart module will overwrite them.
        // Actually, the original code in the inline JS sets these in _enfocarUltimoItemCarrito and then calls actualizarCarritoUI.
        // We are replicating that: we set the globals and then call actualizarCarritoUI (which is in the cart module).
        // But we are in the scroll module, and we don't have direct access to actualizarCarritoUI.
        // Instead, we will set the globals and then trigger a cart UI update by calling the cart module's function if available.
        // However, to keep the modules independent, we will only set the globals and let the cart module handle the rest.
        // The cart module's actualizarCarritoUI function reads nivel1Activo and nivel2Activo from the global scope.
        // So we set them here.
        window.nivel1Activo = grupoId;
        window.nivel2Activo = subgrupoId;

        // Now we need to trigger a cart UI update. We'll do this by checking if the cart module has a function to update the UI.
        // Since we are in the scroll module, we cannot directly call the cart module's function without creating a dependency.
        // Instead, we will rely on the fact that the cart module will be listening for changes to carrito and will update the UI.
        // However, the original code in the inline JS did:
        //   _enfocarUltimoItemCarrito(instancia) {
        //       ... set nivel1Activo/nivel2Activo ...
        //       actualizarCarritoUI();
        //       ... then scroll ...
        //   }
        // We are going to break the dependency by having the scroll module only set the globals and then the cart module will
        // call actualizarCarritoUI in its own flow. But note: the cart module's agregarAlCarrito function calls _enfocarUltimoItemCarrito
        // at the end. We are changing that by moving the logic to the scroll module? Actually, we are not.
        // We are implementing _enfocarUltimoItemCarrito in the scroll module, and the cart module's agregarAlCarrito will call this function.
        // So we must provide a way to update the cart UI. We can do that by exposing a function from the cart module that we can call.
        // However, to avoid circular dependencies, we will have the scroll module set the globals and then dispatch a custom event that the cart module listens to.
        // But given the time, we will keep it simple: we will set the globals and then call a global function if it exists (actualizarCarritoUI).
        // This is acceptable because the cart module will have defined actualizarCarritoUI in the global scope (or we will attach it to Saki.modules.cart).
        // We'll check for the existence of actualizarCarritoUI in the global scope and call it.
        // If it doesn't exist, we'll try to get it from Saki.modules.cart.

        // Attempt to update the cart UI
        if (typeof window.actualizarCarritoUI === 'function') {
            window.actualizarCarritoUI();
        } else if (window.Saki.modules.cart && typeof window.Saki.modules.cart.actualizarCarritoUI === 'function') {
            window.Saki.modules.cart.actualizarCarritoUI();
        }

        // Now scroll to the item
        function ejecutarScroll() {
            const itemEl = document.querySelector(`[data-instancia-id="${instancia.id}"]`);
            if (itemEl) {
                itemEl.scrollIntoView({ behavior: 'smooth', block: 'center' });
            }
        }

        const cartSidebarEl = document.getElementById('cartSidebar');
        const esMobil = window.innerWidth <= 992;

        if (esMobil && cartSidebarEl && cartSidebarEl.classList.contains('open')) {
            cartSidebarEl.addEventListener('transitionend', function onEnd(e) {
                if (e.propertyName !== 'transform') return;
                cartSidebarEl.removeEventListener('transitionend', onEnd);
                ejecutarScroll();
            });
        } else {
            setTimeout(ejecutarScroll, 50);
        }
    }

    // Exponer en Saki.modules y window para compatibilidad
    window.Saki.modules.scroll = {
        iniciarSeguimientoScroll: iniciarSeguimientoScroll,
        detenerSeguimientoScroll: detenerSeguimientoScroll,
        irABotonesAccion: irABotonesAccion,
        scrollAlItemAgregado: scrollAlItemAgregado,
        _enfocarUltimoItemCarrito: _enfocarUltimoItemCarrito
    };
    window.iniciarSeguimientoScroll = iniciarSeguimientoScroll;
    window.detenerSeguimientoScroll = detenerSeguimientoScroll;
    window.irABotonesAccion = irABotonesAccion;
    window.scrollAlItemAgregado = scrollAlItemAgregado;
    window._enfocarUltimoItemCarrito = _enfocarUltimoItemCarrito;

})();