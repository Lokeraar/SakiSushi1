// cliente-historial.js - Historial de pedidos anteriores
(function() {
    window.Saki = window.Saki || {};
    window.Saki.modules = window.Saki.modules || {};
    window.Saki.modules.historial = {};
    var S = window.Saki;

    var MAX_HISTORIAL = 5;

    function agregarPedidoAHistorial(pedido) {
        S.state.historialPedidos = S.state.historialPedidos || [];
        S.state.historialPedidos.unshift({
            id: pedido.id || S.utils.generarId('ped_'),
            items: (pedido.items || S.state.carrito || []).map(function(item) {
                var menuItem = (S.state.menuItems || []).find(function(m) { return m.id == item.platilloId; });
                return {
                    platilloId: item.platilloId,
                    nombre: menuItem ? menuItem.nombre : item.nombre,
                    cantidad: item.cantidad || 1,
                    precio: item.precio || 0,
                    personalizacion: item.personalizacion || null
                };
            }),
            total: pedido.total || S.state.carrito.reduce(function(sum, i) { return sum + (i.precio || 0) * (i.cantidad || 1); }, 0),
            fecha: new Date().toISOString(),
            tipo: pedido.tipo || 'mesa'
        });
        if (S.state.historialPedidos.length > MAX_HISTORIAL) {
            S.state.historialPedidos = S.state.historialPedidos.slice(0, MAX_HISTORIAL);
        }
        try {
            localStorage.setItem('saki_historial', JSON.stringify(S.state.historialPedidos));
        } catch(e) {}
        actualizarBotonHistorial();
    }
    window.agregarPedidoAHistorial = agregarPedidoAHistorial;
    S.modules.historial.agregarPedidoAHistorial = agregarPedidoAHistorial;

    function actualizarBotonHistorial() {
        var btn = document.getElementById('historialPedidosBtn');
        var count = document.getElementById('historialCount');
        if (!btn) return;
        if (S.state.historialPedidos && S.state.historialPedidos.length > 0) {
            btn.style.display = 'flex';
            if (count) count.textContent = S.state.historialPedidos.length;
        } else {
            btn.style.display = 'none';
        }
    }
    window.actualizarBotonHistorial = actualizarBotonHistorial;
    S.modules.historial.actualizarBotonHistorial = actualizarBotonHistorial;

    function abrirHistorialPedidos() {
        if (!S.state.historialPedidos || S.state.historialPedidos.length === 0) {
            if (window.mostrarToast) window.mostrarToast('No hay pedidos anteriores', 'info');
            return;
        }
        var modal = document.getElementById('customizeModal');
        var body = document.getElementById('customizeModalBody');
        if (!modal || !body) return;

        var html = '<div class="historial-modal">' +
            '<h3 style="color:var(--accent);margin-bottom:1rem"><i class="fas fa-history"></i> Pedidos anteriores</h3>';

        S.state.historialPedidos.forEach(function(pedido) {
            var fecha = new Date(pedido.fecha + 'Z');
            var fechaStr = fecha.toLocaleDateString('es-VE', { day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit' });
            html += '<div class="pedido-item" data-pedido-id="' + pedido.id + '" style="padding:.8rem;border-bottom:1px solid rgba(255,255,255,.1);cursor:pointer;transition:background .2s">' +
                '<div style="display:flex;justify-content:space-between;align-items:center">' +
                '<span style="font-weight:600;color:var(--text-primary)">' + (pedido.tipo === 'delivery' ? '🛵 Delivery' : '🍽️ Mesa') + '</span>' +
                '<span class="pedido-total" style="font-weight:700;color:var(--accent)">' + S.utils.formatBs(pedido.total) + '</span>' +
                '</div>' +
                '<div class="pedido-fecha" style="font-size:.8rem;color:var(--gray-400);margin-top:.3rem">' + fechaStr + '</div>' +
                '<div style="font-size:.8rem;color:var(--text-secondary);margin-top:.2rem">' + (pedido.items || []).length + ' items</div>' +
                '</div>';
        });

        html += '</div>';
        body.innerHTML = html;
        document.getElementById('customizeModalHeader').textContent = 'Historial';
        modal.classList.add('active');

        document.getElementById('closeCustomizeModal').addEventListener('click', function() { modal.classList.remove('active'); });
        document.getElementById('cancelCustomize').addEventListener('click', function() { modal.classList.remove('active'); });

        // Click to repeat order
        body.querySelectorAll('.pedido-item').forEach(function(el) {
            el.addEventListener('click', function() {
                var pedidoId = this.dataset.pedidoId;
                modal.classList.remove('active');
                if (pedidoId && window.repetirPedido) window.repetirPedido(pedidoId);
            });
        });
    }
    window.abrirHistorialPedidos = abrirHistorialPedidos;
    S.modules.historial.abrirHistorialPedidos = abrirHistorialPedidos;

    function cerrarHistorial() {
        document.getElementById('customizeModal').classList.remove('active');
        // Comprimir botón si está expandido
        var btn = document.getElementById('historialPedidosBtn');
        if (btn) btn.classList.add('comprimido');
    }
    window.cerrarHistorial = cerrarHistorial;
    S.modules.historial.cerrarHistorial = cerrarHistorial;

    function repetirPedido(pedidoId) {
        var pedido = (S.state.historialPedidos || []).find(function(p) { return p.id === pedidoId; });
        if (!pedido || !pedido.items) return;
        S.state.carrito = [];
        pedido.items.forEach(function(item) {
            var menuItem = (S.state.menuItems || []).find(function(m) { return m.id == item.platilloId; });
            if (menuItem) {
                for (var i = 0; i < (item.cantidad || 1); i++) {
                    S.state.carrito.push({
                        id: S.utils.generarId('cart_'),
                        platilloId: item.platilloId,
                        nombre: item.nombre,
                        precio: S.utils.usdToBs(menuItem.precio || 0),
                        cantidad: 1,
                        personalizacion: item.personalizacion || null,
                        ingredientesQuitados: [],
                        tipo: item.personalizacion ? 'personalizado' : 'completo',
                        ts: Date.now()
                    });
                }
            }
        });
        if (window.guardarCarrito) window.guardarCarrito();
        if (window.actualizarCarritoUI) window.actualizarCarritoUI();
        if (window.actualizarCarritoBadge) window.actualizarCarritoBadge();
        if (window.mostrarToast) window.mostrarToast('🔄 Pedido restaurado al carrito', 'success');
        if (window.precalcularStockMenu) window.precalcularStockMenu();
        if (window.actualizarStockTarjetas) window.actualizarStockTarjetas();
    }
    window.repetirPedido = repetirPedido;
    S.modules.historial.repetirPedido = repetirPedido;

    // Load from localStorage on init
    try {
        var saved = localStorage.getItem('saki_historial');
        if (saved) S.state.historialPedidos = JSON.parse(saved);
    } catch(e) {
        S.state.historialPedidos = [];
    }
})();
