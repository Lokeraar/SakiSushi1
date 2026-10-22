// cliente-pedidos.js - Confirmación de mesa y pedido transaccional
(function() {
    window.Saki = window.Saki || {};
    window.Saki.modules = window.Saki.modules || {};
    window.Saki.modules.pedidos = {};
    var S = window.Saki;

    function abrirConfirmacionMesa() {
        if (!S.state.carrito || S.state.carrito.length === 0) return;
        var modal = document.getElementById('confirmMesaModal');
        if (!modal) return;

        var summary = document.getElementById('mesaOrderSummary');
        var tableNum = document.getElementById('confirmTableNumber');
        if (tableNum) tableNum.textContent = S.state.mesaId || '--';

        var html = '';
        var total = 0;
        S.state.carrito.forEach(function(item) {
            var subtotal = (item.precio || 0) * (item.cantidad || 1);
            total += subtotal;
            html += '<div style="display:flex;justify-content:space-between;padding:.3rem 0;font-size:.9rem">' +
                '<span style="color:var(--text-primary)">' + (item.cantidad || 1) + 'x ' + item.nombre + '</span>' +
                '<span style="color:var(--accent);font-weight:600">' + S.utils.formatBs(subtotal) + '</span></div>';
        });
        html += '<div style="border-top:1px solid rgba(255,255,255,.1);margin-top:.5rem;padding-top:.5rem;display:flex;justify-content:space-between;font-weight:700;font-size:1rem">' +
            '<span style="color:var(--text-primary)">Total</span><span style="color:var(--accent)">' + S.utils.formatBs(total) + '</span></div>';
        if (summary) summary.innerHTML = html;
        modal.classList.add('active');
    }
    window.abrirConfirmacionMesa = abrirConfirmacionMesa;
    S.modules.pedidos.abrirConfirmacionMesa = abrirConfirmacionMesa;

    function crearPedidoBase(tipo) {
        var items = (S.state.carrito || []).map(function(item) {
            return {
                // El id real de `menu` es TEXT con forma `plat_<uuid>_<n>`.
                // `parseInt` sobre eso devuelve NaN, y NaN se serializa a JSON
                // como null: la RPC recibía platillo_id null y rechazaba el
                // pedido. Se envía el id tal cual viene del menú.
                platillo_id: item.platilloId,
                nombre: item.nombre,
                cantidad: item.cantidad || 1,
                precio: item.precio || 0,
                personalizacion: item.personalizacion,
                ingredientes_quitados: item.ingredientesQuitados || []
            };
        });
        var total = S.state.carrito.reduce(function(sum, i) { return sum + (i.precio || 0) * (i.cantidad || 1); }, 0);
        var pedido = {
            id: S.utils.generarId('ped_'),
            tipo: tipo,
            items: items,
            total: total,
            total_usd: S.state.carrito.reduce(function(sum, i) {
                var menuItem = (S.state.menuItems || []).find(function(m) { return m.id == i.platilloId; });
                return sum + (menuItem ? parseFloat(menuItem.precio || 0) : 0) * (i.cantidad || 1);
            }, 0),
            mesa_id: S.state.mesaId ? parseInt(S.state.mesaId) : null,
            cliente_nombre: document.getElementById('clienteNombre') ? document.getElementById('clienteNombre').value.trim() : '',
            fecha: new Date().toISOString()
        };
        return pedido;
    }
    S.modules.pedidos.crearPedidoBase = crearPedidoBase;

    function crearPedidoTransaccional(pedido) {
        if (!window.supabaseClient) return Promise.reject('No supabase client');
        var supabase = window.supabaseClient;

        return supabase.rpc('crear_pedido_con_reserva', {
            p_items: pedido.items,
            p_tipo: pedido.tipo,
            p_total: pedido.total,
            p_total_usd: pedido.total_usd,
            p_mesa_id: pedido.mesa_id,
            p_cliente_nombre: pedido.cliente_nombre,
            p_notas: ''
        });
    }
    S.modules.pedidos.crearPedidoTransaccional = crearPedidoTransaccional;

    function confirmarPedidoMesa() {
        if (!S.state.carrito || S.state.carrito.length === 0) return;
        var btn = document.getElementById('confirmMesaOrder');
        if (btn) { btn.disabled = true; btn.innerHTML = '<i class="fas fa-spinner fa-spin"></i> Enviando...'; }

        var pedido = crearPedidoBase('mesa');

        crearPedidoTransaccional(pedido)
            .then(function(resp) {
                if (resp.error) throw resp.error;
                if (window.agregarPedidoAHistorial) window.agregarPedidoAHistorial(pedido);
                S.state.carrito = [];
                if (window.guardarCarrito) window.guardarCarrito();
                if (window.actualizarCarritoUI) window.actualizarCarritoUI();
                if (window.actualizarCarritoBadge) window.actualizarCarritoBadge();
                if (window.precalcularStockMenu) window.precalcularStockMenu();
                if (window.mostrarToast) window.mostrarToast('✅ Pedido enviado a la cocina', 'success');
                document.getElementById('confirmMesaModal').classList.remove('active');
                if (window.detenerSeguimientoScroll) window.detenerSeguimientoScroll();
            })
            .catch(function(err) {
                if (window.mostrarToast) window.mostrarToast('❌ Error al crear pedido: ' + (err.message || err), 'error');
            })
            .finally(function() {
                if (btn) { btn.disabled = false; btn.innerHTML = '<i class="fas fa-check"></i> Hacer Pedido'; }
            });
    }
    window.confirmarPedidoMesa = confirmarPedidoMesa;
    S.modules.pedidos.confirmarPedidoMesa = confirmarPedidoMesa;
})();
