// admin-reportes.js - Reportes y gráficos (con lazy loading de Chart.js)
(function() {
    window.cargarReportes = async function() {
        if (typeof Chart === 'undefined') {
            await new Promise((resolve, reject) => {
                const script = document.createElement('script');
                script.src = 'https://cdn.jsdelivr.net/npm/chart.js';
                script.onload = resolve;
                script.onerror = reject;
                document.head.appendChild(script);
            });
        }
        try {
            const desde = document.getElementById('reporteDesde').value;
            const hasta = document.getElementById('reporteHasta').value;
            let query = window.supabaseClient.from('pedidos').select('*').in('estado', ['cobrado', 'entregado', 'enviado', 'reserva_completada']);
            if (desde) query = query.gte('fecha', new Date(desde).toISOString());
            if (hasta) { const h = new Date(hasta); h.setDate(h.getDate() + 1); query = query.lt('fecha', h.toISOString()); }
            const { data, error } = await query.order('fecha', { ascending: false });
            if (error) throw error;
            window.actualizarEstadisticasReportes(data || []);
            window.actualizarGraficos(data || []);
            window.actualizarTablaVentas(data || []);
        } catch (e) { console.error('Error cargando reportes:', e); window.mostrarToast('Error cargando reportes', 'error'); }
    };

    window.actualizarEstadisticasReportes = function(pedidos) {
        const hoy = new Date(); hoy.setHours(0, 0, 0, 0);
        const ventasHoy = pedidos.filter(p => new Date(p.fecha) >= hoy).reduce((s, p) => s + (p.total || 0), 0);
        const semana = new Date(); semana.setDate(semana.getDate() - 7);
        const ventasSemana = pedidos.filter(p => new Date(p.fecha) >= semana).reduce((s, p) => s + (p.total || 0), 0);
        const ticketPromedio = pedidos.length > 0 ? pedidos.reduce((s, p) => s + (p.total || 0), 0) / pedidos.length : 0;
        
        const platillosCount = {};
        pedidos.forEach(p => { if (p.items) p.items.forEach(item => { platillosCount[item.nombre] = (platillosCount[item.nombre] || 0) + (item.cantidad || 0); }); });
        let platilloTop = '-', maxCount = 0;
        for (const [n, c] of Object.entries(platillosCount)) { if (c > maxCount) { maxCount = c; platilloTop = n; } }
        
        const tasa = window.configGlobal?.tasa_efectiva || 400;
        const _s=(id,v)=>{const el=document.getElementById(id);if(el)el.textContent=v;};
        _s('ventasDia',      `${window.formatUSD(ventasHoy)} / ${window.formatBs(ventasHoy * tasa)}`);
        _s('ventasSemana',   `${window.formatUSD(ventasSemana)} / ${window.formatBs(ventasSemana * tasa)}`);
        _s('ticketPromedio', `${window.formatUSD(ticketPromedio)} / ${window.formatBs(ticketPromedio * tasa)}`);
        _s('platilloTop',    platilloTop);
    };

    window.actualizarGraficos = function(pedidos) {
        if (typeof Chart === 'undefined') return;
        const ventasPorDia = {};
        for (let i = 6; i >= 0; i--) { const f = new Date(); f.setDate(f.getDate() - i); ventasPorDia[f.toISOString().split('T')[0]] = 0; }
        pedidos.forEach(p => { const f = new Date(p.fecha).toISOString().split('T')[0]; if (ventasPorDia.hasOwnProperty(f)) ventasPorDia[f] += p.total || 0; });
        if (window.charts.ventas) window.charts.ventas.destroy();
        window.charts.ventas = new Chart(document.getElementById('ventasChart'), {
            type: 'line',
            data: { labels: Object.keys(ventasPorDia), datasets: [{ label: 'Ventas (USD)', data: Object.values(ventasPorDia), borderColor: 'var(--primary)', backgroundColor: 'rgba(211,47,47,0.1)', tension: 0.1 }] }
        });
        
        const categorias = {};
        pedidos.forEach(p => { if (p.items) p.items.forEach(item => { const platillo = window.menuItems.find(m => m.nombre === item.nombre); const cat = platillo?.categoria || 'Otros'; categorias[cat] = (categorias[cat] || 0) + ((item.precioUnitarioUSD || 0) * (item.cantidad || 0)); }); });
        if (window.charts.categorias) window.charts.categorias.destroy();
        window.charts.categorias = new Chart(document.getElementById('categoriasChart'), {
            type: 'doughnut',
            data: { labels: Object.keys(categorias), datasets: [{ data: Object.values(categorias), backgroundColor: ['#D32F2F', '#FF9800', '#1976D2', '#388E3C', '#F57C00', '#6c757d'] }] }
        });
        
        const metodos = {};
        pedidos.forEach(p => {
            if (p.pagos_mixtos) p.pagos_mixtos.forEach(pago => { metodos[pago.metodo] = (metodos[pago.metodo] || 0) + (pago.monto || 0); });
            else if (p.metodo_pago) metodos[p.metodo_pago] = (metodos[p.metodo_pago] || 0) + (p.total || 0);
        });
        if (window.charts.pagos) window.charts.pagos.destroy();
        window.charts.pagos = new Chart(document.getElementById('pagosChart'), {
            type: 'bar',
            data: { labels: Object.keys(metodos).map(m => { const n = { efectivo_bs: 'Efectivo Bs', efectivo_usd: 'Efectivo USD', pago_movil: 'Pago Móvil', punto_venta: 'Punto de Venta', mixto: 'Mixto', invitacion: 'Invitación' }; return n[m] || m; }), datasets: [{ label: 'Monto (USD)', data: Object.values(metodos).map(v => v / (window.configGlobal?.tasa_efectiva || 400)), backgroundColor: 'var(--info)' }] }
        });
        
        const horas = {}; for (let i = 0; i < 24; i++) horas[i] = 0;
        pedidos.forEach(p => { const h = new Date(p.fecha).getHours(); horas[h] += p.total || 0; });
        if (window.charts.hora) window.charts.hora.destroy();
        window.charts.hora = new Chart(document.getElementById('horaChart'), {
            type: 'bar',
            data: { labels: Object.keys(horas).map(h => `${h}:00`), datasets: [{ label: 'Ventas (USD)', data: Object.values(horas), backgroundColor: 'var(--accent)' }] }
        });
    };

    window.actualizarTablaVentas = function(pedidos) {
        const tbody = document.getElementById('ventasTableBody');
        const tasa = (window.configGlobal && window.configGlobal.tasa_efectiva) || window.configGlobal?.tasa_cambio || 400;
        tbody.innerHTML = pedidos.slice(0, 50).map(p => {
            const items = p.items || [];
            const totalItems = items.reduce((s, i) => s + (i.cantidad || 0), 0);
            const resumen = items.length ? items.slice(0, 2).map(i => `${i.cantidad || 1}× ${i.nombre}`).join(', ') + (items.length > 2 ? ` +${items.length - 2} más` : '') : 'Sin detalle';
            const totalUSD = p.total || 0;
            const totalBs = window.formatBs(totalUSD * tasa);
            return `<tr>
                <td>${new Date(p.fecha).toLocaleDateString('es-VE', { timeZone: 'America/Caracas'})}</td>
                <td style="max-width:200px;font-size:.82rem">${resumen}</td>
                <td>${window.formatUSD(totalUSD)}<br><span style="font-size:.75rem;color:var(--text-muted)">${totalBs}</span></td>
                <td>${totalItems}</td>
                <td style="font-size:.78rem">${(function(){
                    if (p.pagos_mixtos && p.pagos_mixtos.length > 1) {
                        const labels = { efectivo_bs:'Ef.Bs', efectivo_usd:'Ef.USD', pago_movil:'P.Móvil', punto_venta:'Pto.Venta', invitacion:'Invitación' };
                        return p.pagos_mixtos.map(pg => labels[pg.metodo] || pg.metodo).join(' + ');
                    }
                    const labels2 = { efectivo_bs:'Ef. Bs', efectivo_usd:'Ef. USD', pago_movil:'Pago Móvil', punto_venta:'Punto Venta', invitacion:'Invitación' };
                    return labels2[p.metodo_pago] || p.metodo_pago || 'N/A';
                })()}</td>
                <td>${p.tipo || 'N/A'}</td>
            </tr>`;
        }).join('');
    };

    window.cargarPedidosRecientes = async function() {
        try {
            const { data, error } = await window.supabaseClient.from('pedidos').select('*').order('fecha', { ascending: false }).limit(5);
            if (error) throw error;
            const pedidosCount = document.getElementById('pedidosCountBadge');
            if (pedidosCount) pedidosCount.textContent = (data || []).length;
            document.getElementById('pedidosRecientes').innerHTML = (data || []).map(p => {
                const hora = new Date(p.fecha).toLocaleTimeString('es-VE', {hour:'2-digit',minute:'2-digit'});
                const fecha = new Date(p.fecha).toLocaleDateString('es-VE', {day:'2-digit',month:'2-digit'});
                const items = (p.items || []).slice(0,2).map(i => `${i.cantidad||1}x ${i.nombre}`).join(', ');
                const masItems = (p.items||[]).length > 2 ? ` +${(p.items||[]).length-2} más` : '';
                const tipoIcon = p.tipo==='delivery' ? '🛵' : p.tipo==='reserva' ? '📅' : '🍽️';
                const tipoColor = p.tipo==='delivery' ? 'var(--delivery)' : p.tipo==='reserva' ? 'var(--propina)' : 'var(--info)';
                const totalBs = window.formatBs(window.usdToBs(p.total||0));
                const estadoText = p.estado ? p.estado.replace(/_/g,' ') : '';
                const estadoColor = p.estado === 'entregado' ? 'var(--success)' : p.estado === 'en_camino' ? 'var(--delivery)' : p.estado === 'en_cocina' ? 'var(--warning)' : 'var(--text-muted)';
                return `<div class="pedido-item-modern" style="background:var(--card-bg); border-radius:12px; padding:.8rem 1rem; border:1px solid var(--border); transition:all .2s; cursor:pointer" onclick="window._abrirDetallePedidoAdmin('${p.id}')">
                    <div style="display:flex; justify-content:space-between; align-items:flex-start; flex-wrap:wrap; gap:.5rem; margin-bottom:.5rem">
                        <div style="display:flex; align-items:center; gap:.6rem; flex-wrap:wrap">
                            <span style="font-size:1.1rem">${tipoIcon}</span>
                            <span style="font-weight:700; color:${tipoColor}">${p.tipo || 'mesa'} ${p.mesa ? `· ${p.mesa}` : ''}</span>
                            <span style="font-size:.7rem; background:${estadoColor}20; color:${estadoColor}; padding:.2rem .6rem; border-radius:20px; font-weight:600">${estadoText || 'pendiente'}</span>
                        </div>
                        <div style="display:flex; align-items:center; gap:.5rem">
                            <span style="font-size:.7rem; color:var(--text-muted)">${fecha} ${hora}</span>
                            <span style="font-weight:800; color:var(--accent); font-size:.9rem">${totalBs}</span>
                        </div>
                    </div>
                    <div style="font-size:.75rem; color:var(--text-muted); display:flex; flex-wrap:wrap; gap:.3rem">
                        <span><i class="fas fa-receipt" style="width:14px; margin-right:.3rem"></i> ${items || 'Sin items'}</span>
                        ${masItems ? `<span style="color:var(--accent)">${masItems}</span>` : ''}
                    </div>
                </div>`;
            }).join('') || '<div style="text-align:center; padding:1rem; color:var(--text-muted)"><i class="fas fa-inbox"></i><p style="margin-top:.5rem">No hay pedidos recientes</p></div>';
        } catch (e) { console.error('Error cargando pedidos recientes:', e); }
    };

    window._abrirDetallePedidoAdmin = async function(pedidoId) {
        let pedido = (window.pedidos||[]).find(p=>p.id===pedidoId);
        if (!pedido) {
            try {
                const {data,error}=await window.supabaseClient.from('pedidos').select('*').eq('id',pedidoId).maybeSingle();
                if(error) throw error; pedido=data;
            } catch(e){ window.mostrarToast('Error al cargar pedido','error'); return; }
        }
        if (!pedido){ window.mostrarToast('Pedido no encontrado','error'); return; }
        const tasa=(window.configGlobal?.tasa_efectiva||window.configGlobal?.tasa_cambio||400);
        const tipoIcon=pedido.tipo==='delivery'?'🛵':pedido.tipo==='reserva'?'📅':'🍽️';
        const tipoLabel=pedido.tipo==='delivery'?'Delivery':pedido.tipo==='reserva'?'Reserva':('Mesa '+(pedido.mesa||''));
        const ecols={entregado:'var(--success)',cobrado:'var(--success)',en_camino:'var(--delivery)',enviado:'var(--delivery)',en_cocina:'var(--warning)'};
        const sc=ecols[pedido.estado]||'var(--text-muted)';
        const map={};
        (pedido.items||[]).forEach(it=>{if(map[it.nombre])map[it.nombre].cantidad+=(it.cantidad||1);else map[it.nombre]={...it,cantidad:it.cantidad||1};});
        const iHtml=Object.values(map).map(it=>{
            const pu=it.precioUnitarioUSD||it.precio||0; const su=pu*(it.cantidad||1);
            const qty=it.cantidad>1?`<span style="background:var(--primary);color:#fff;border-radius:12px;padding:1px 7px;font-size:.7rem;font-weight:700;margin-left:.3rem">×${it.cantidad}</span>`:'';
            return `<div style="display:flex;justify-content:space-between;align-items:center;padding:.45rem 0;border-bottom:1px solid var(--border)"><span style="font-size:.85rem;font-weight:500;color:var(--text-dark)">${it.nombre}${qty}</span><span style="font-size:.82rem;font-weight:700;color:var(--accent);white-space:nowrap;margin-left:.5rem">${window.formatUSD(su)} / ${window.formatBs(su*tasa)}</span></div>`;
        }).join('')||'<p style="color:var(--text-muted);font-size:.82rem;text-align:center;padding:.75rem">Sin items</p>';
        const metLbl={efectivo_bs:'Efectivo Bs',efectivo_usd:'Efectivo USD',pago_movil:'Pago Móvil',punto_venta:'Punto de Venta',invitacion:'Invitación'};
        let metodo='N/A';
        if(pedido.pagos_mixtos?.length) metodo=pedido.pagos_mixtos.map(pg=>metLbl[pg.metodo]||pg.metodo).join(' + ');
        else if(pedido.metodo_pago) metodo=metLbl[pedido.metodo_pago]||pedido.metodo_pago;
        const fechaStr=new Date(pedido.fecha).toLocaleString('es-VE',{timeZone:'America/Caracas',day:'2-digit',month:'2-digit',year:'numeric',hour:'2-digit',minute:'2-digit'});
        const ov=document.createElement('div');
        ov.style.cssText='position:fixed;inset:0;background:rgba(0,0,0,.75);z-index:10001;display:flex;align-items:center;justify-content:center;padding:1rem;backdrop-filter:blur(3px)';
        ov.innerHTML=`<div style="background:var(--card-bg);border-radius:16px;max-width:480px;width:100%;max-height:88vh;overflow:hidden;display:flex;flex-direction:column;box-shadow:0 20px 40px rgba(0,0,0,.4)"><div style="background:linear-gradient(135deg,#1a1a2e,#2d2d4e);padding:1rem 1.5rem;color:#fff;display:flex;justify-content:space-between;align-items:flex-start"><div><div style="font-size:1rem;font-weight:700">${tipoIcon} ${tipoLabel}</div><div style="font-size:.72rem;opacity:.75;margin-top:3px">${fechaStr}</div></div><div style="display:flex;align-items:center;gap:.75rem"><span style="font-size:.7rem;background:${sc}30;color:${sc};padding:.2rem .7rem;border-radius:20px;font-weight:600">${(pedido.estado||'').replace(/_/g,' ')}</span><button onclick="this.closest('[style*=position]').remove()" style="background:rgba(255,255,255,.15);border:none;color:#fff;border-radius:50%;width:28px;height:28px;cursor:pointer;font-size:.9rem;font-weight:700;display:flex;align-items:center;justify-content:center">✕</button></div></div><div style="overflow-y:auto;flex:1;padding:1rem 1.5rem"><div style="font-size:.72rem;font-weight:700;text-transform:uppercase;letter-spacing:.5px;color:var(--text-muted);margin-bottom:.6rem"><i class="fas fa-receipt" style="margin-right:.3rem"></i>Items</div>${iHtml}</div><div style="padding:.85rem 1.5rem;border-top:1px solid var(--border)"><div style="display:flex;justify-content:space-between;margin-bottom:.4rem;font-size:.82rem"><span style="color:var(--text-muted)">Método de pago</span><span style="font-weight:600">${metodo}</span></div><div style="display:flex;justify-content:space-between;align-items:center"><span style="font-size:.82rem;color:var(--text-muted)">Total</span><span style="font-size:1rem;font-weight:800;color:var(--accent)">${window.formatUSD(pedido.total||0)} / ${window.formatBs((pedido.total||0)*tasa)}</span></div></div></div>`;
        ov.addEventListener('click',e=>{if(e.target===ov)ov.remove();});
        document.body.appendChild(ov);
    };

    window._actualizarVentasHoyNeto = async function() {
        try {
            // Verificar que haya token JWT antes de hacer la consulta
            if (!window.jwtToken) {
                console.warn('⚠️ No hay token JWT, omitiendo cálculo de ventas hoy');
                const el = document.getElementById('ventasHoy');
                if (el) el.textContent = '$0.00 / Bs 0,00';
                return;
            }
            
            // Obtener fecha desde del selector de tcb-cards para filtrar pedidos
            const aumentoDesdeInput = document.getElementById('aumentoDesde');
            const fechaDesde = aumentoDesdeInput && aumentoDesdeInput.value ? new Date(aumentoDesdeInput.value) : null;
            
            const hoy = new Date(); hoy.setHours(0, 0, 0, 0);
            const manana = new Date(hoy); manana.setDate(manana.getDate() + 1);
            
            // Si hay fecha desde, usarla como límite inferior, sino usar hoy
            let fechaInicio = hoy;
            if (fechaDesde && !isNaN(fechaDesde.getTime())) {
                fechaInicio = new Date(fechaDesde.getFullYear(), fechaDesde.getMonth(), fechaDesde.getDate());
            }
            
            const { data: ventasHoy, error: errorVentas } = await window.supabaseClient.from('ventas').select('pedido_id').gte('fecha', fechaInicio.toISOString()).lt('fecha', manana.toISOString());
            
            // Si hay error 401, no continuar
            if (errorVentas) {
                if (errorVentas.status === 401 || errorVentas.code === 'PGRST301') {
                    console.warn('⚠️ Token expirado o sin permisos para cargar ventas');
                    const el = document.getElementById('ventasHoy');
                    if (el) el.textContent = '$0.00 / Bs 0,00';
                    return;
                }
                throw errorVentas;
            }
            
            if (!ventasHoy || ventasHoy.length === 0) { document.getElementById('ventasHoy').textContent = '$0.00 / Bs 0.00'; return; }
            const pedidoIds = ventasHoy.map(v => v.pedido_id);
            const { data: pedidosData } = await window.supabaseClient.from('pedidos').select('*').in('id', pedidoIds);
            const _netoCobradoPedido = (pedido) => {
                if (!pedido) return 0;
                if (pedido.metodo_pago === 'invitacion') return 0;
                const tasa = window.configGlobal?.tasa_cambio || window.configGlobal?.tasa_efectiva || 400;
                let recibido = 0;
                if (pedido.pagos_mixtos && pedido.pagos_mixtos.length) {
                    pedido.pagos_mixtos.forEach(pg => {
                        if (pg.metodo === 'invitacion') return;
                        recibido += pg.metodo === 'efectivo_usd' ? (pg.monto || 0) * tasa : (pg.montoBs || pg.monto || 0);
                    });
                } else { recibido = pedido.subtotal_bs || 0; }
                return Math.max(0, recibido - (pedido.vuelto_entregado || 0));
            };
            let netoBs = 0;
            pedidosData.forEach(pedido => { netoBs += _netoCobradoPedido(pedido); });
            const tasa = window.configGlobal?.tasa_efectiva || window.configGlobal?.tasa_cambio || 400;
            const netoUSD = netoBs / tasa;
            const el = document.getElementById('ventasHoy');
            if (el) el.textContent = `${window.formatUSD(netoUSD)} / ${window.formatBs(netoBs)}`;
            window._ventasHoyNeto = { netoBs, netoUSD, ventasHoy, pedidosData };
        } catch (e) {
            // No mostrar error en consola si es un error 401 o de JWT
            if (!(e.status === 401 || e.code === 'PGRST301' || (e.message && e.message.includes('JWT')))) {
                console.error('Error calculando neto cobrado:', e);
            }
            const el = document.getElementById('ventasHoy');
            if (el) el.textContent = '$0.00 / Bs 0,00';
        }
    };

    window._actualizarDeliverysHoy = async function() {
        try {
            // Verificar que haya token JWT antes de hacer la consulta
            if (!window.jwtToken) {
                const el = document.getElementById('deliverysHoyDashboard');
                if (el) el.textContent = '$0.00 / Bs 0,00';
                return;
            }
            
            const hoy = new Date(); hoy.setHours(0, 0, 0, 0);
            const manana = new Date(hoy); manana.setDate(manana.getDate() + 1);
            const { data: pedidosDelivery, error: errorPedidos } = await window.supabaseClient.from('pedidos').select('*').eq('tipo', 'delivery').eq('estado', 'enviado').gte('fecha', hoy.toISOString()).lt('fecha', manana.toISOString());
            
            // Si hay error 401, no continuar
            if (errorPedidos) {
                if (errorPedidos.status === 401 || errorPedidos.code === 'PGRST301') {
                    const el = document.getElementById('deliverysHoyDashboard');
                    if (el) el.textContent = '$0.00 / Bs 0,00';
                    return;
                }
                throw errorPedidos;
            }
            
            let totalDeliverysBs = 0;
            (pedidosDelivery || []).forEach(p => { totalDeliverysBs += p.costo_delivery_bs || p.costoDelivery || 0; });
            const tasa = window.configGlobal?.tasa_efectiva || window.configGlobal?.tasa_cambio || 400;
            const totalDeliverysUsd = tasa > 0 ? totalDeliverysBs / tasa : 0;
            const el = document.getElementById('deliverysHoyDashboard');
            if (el) el.textContent = window.formatUSD(totalDeliverysUsd) + ' / ' + window.formatBs(totalDeliverysBs);
            window._deliverysHoyData = { totalDeliverysBs, totalDeliverysUsd, pedidosDelivery };
        } catch (e) {
            // No mostrar error en consola si es un error 401 o de JWT
            if (!(e.status === 401 || e.code === 'PGRST301' || (e.message && e.message.includes('JWT')))) {
                console.error('Error calculando deliverys hoy:', e);
            }
            const el = document.getElementById('deliverysHoyDashboard');
            if (el) el.textContent = '$0.00 / Bs 0,00';
        }
    };

    window._abrirDetalleDeliverysAdmin = async function() {
        try {
            const hoy = new Date(); hoy.setHours(0, 0, 0, 0);
            const manana = new Date(hoy); manana.setDate(manana.getDate() + 1);
            const { data: entregas } = await window.supabaseClient.from('entregas_delivery').select('*, deliverys(*)').gte('fecha_entrega', hoy.toISOString()).lt('fecha_entrega', manana.toISOString());
            const { data: motorizados } = await window.supabaseClient.from('deliverys').select('*').order('nombre');
            const acumulado = {};
            (entregas || []).forEach(e => { acumulado[e.delivery_id] = (acumulado[e.delivery_id] || 0) + (e.monto_bs || 0); });
            const totalAcumulado = Object.values(acumulado).reduce((s, v) => s + v, 0);
            let motorizadosHtml = '';
            if (!motorizados || motorizados.length === 0) motorizadosHtml = '<div class="empty-state"><i class="fas fa-motorcycle"></i><p>No hay motorizados registrados</p></div>';
            else {
                motorizadosHtml = '<div class="motorizados-list" style="display:flex;flex-direction:column;gap:8px">';
                motorizados.forEach(m => {
                    const monto = acumulado[m.id] || 0;
                    const hayE = monto > 0;
                    const detalleId = 'det_del_' + String(m.id).replace(/[^a-z0-9]/gi, '_');
                    motorizadosHtml += `<div style="margin-bottom:8px">
                        <div class="motorizado-item" style="background:rgba(0,0,0,.25);border-radius:8px;padding:12px;display:flex;justify-content:space-between;align-items:center;border-left:4px solid var(--delivery);cursor:${hayE ? 'pointer' : 'default'};opacity:${hayE ? '1' : '0.6'}" onclick="${hayE ? `window._toggleDeliveryDetalle('${detalleId}')` : ''}">
                            <span class="motorizado-nombre"><i class="fas fa-motorcycle" style="color:var(--delivery);margin-right:8px"></i>${m.nombre}</span>
                            <span class="motorizado-monto" style="color:${hayE ? 'var(--accent)' : 'var(--text-secondary)'};font-weight:700;display:flex;align-items:center;gap:6px">
                                ${window.formatBs(monto)}
                                ${hayE ? '<i class="fas fa-chevron-down" style="font-size:.7rem;transition:transform .2s" id="icon_' + detalleId + '"></i>' : ''}
                            </span>
                        </div>`;
                    if (hayE) {
                        const pedidosDelDia = (window.pedidos || []).filter(p => p.delivery_id === m.id && p.estado === 'enviado' && new Date(p.fecha).toDateString() === hoy.toDateString());
                        motorizadosHtml += `<div id="${detalleId}" style="display:none;padding:8px 12px;background:rgba(0,0,0,.2);border-radius:0 0 8px 8px;margin-top:-4px;border:1px solid var(--border-color);border-top:none">
                            ${pedidosDelDia.length > 0 ? pedidosDelDia.map(p => {
                                const hora = new Date(p.fecha).toLocaleTimeString('es-VE', { hour: 'numeric', minute: '2-digit', hour12: true }).toLowerCase();
                                return `<div style="display:flex;justify-content:space-between;align-items:center;padding:6px 0;border-bottom:1px solid rgba(255,255,255,.08);font-size:.78rem">
                                    <span><i class="fas fa-map-marker-alt" style="color:var(--delivery);margin-right:6px"></i>${p.parroquia || 'Sin parroquia'}<span style="color:var(--text-secondary);margin-left:8px">${hora}</span></span>
                                    <span style="color:var(--accent);font-weight:700">${window.formatBs(p.costo_delivery_bs || 0)}</span>
                                </div>`;
                            }).join('') : '<div style="padding:6px 0;color:var(--text-secondary);font-size:.78rem">No hay entregas registradas</div>'}
                            <div style="padding:6px 0;margin-top:4px;font-size:.75rem;font-weight:600;border-top:1px solid rgba(255,255,255,.1);color:var(--text-secondary)">Total: ${pedidosDelDia.length} entrega${pedidosDelDia.length !== 1 ? 's' : ''}</div>
                        </div>`;
                    }
                    motorizadosHtml += `</div>`;
                });
                motorizadosHtml += '</div>';
            }
            const modal = document.createElement('div');
            modal.style.cssText = 'position:fixed;inset:0;background:rgba(0,0,0,.75);z-index:10000;display:flex;align-items:center;justify-content:center;padding:1rem';
            modal.innerHTML = `<div style="background:var(--card-bg);border-radius:16px;width:100%;max-width:500px;max-height:90vh;overflow-y:auto;box-shadow:0 8px 32px rgba(0,0,0,.4)">
                <div style="background:linear-gradient(135deg, var(--delivery), #00838F);color:#fff;padding:1rem 1.2rem;display:flex;justify-content:space-between;align-items:center;border-radius:16px 16px 0 0">
                    <h3 style="font-size:1rem;font-weight:700;display:flex;align-items:center;gap:.5rem"><i class="fas fa-motorcycle"></i> Acumulado Deliverys (Hoy)</h3>
                    <button onclick="this.closest('[style*=fixed]').remove()" style="background:rgba(255,255,255,.2);border:none;border-radius:50%;width:32px;height:32px;cursor:pointer;color:#fff;font-size:1rem;display:flex;align-items:center;justify-content:center">✕</button>
                </div>
                <div style="padding:1.25rem">
                    <div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:16px;padding-bottom:12px;border-bottom:2px solid var(--border-color)">
                        <span style="font-weight:700;font-size:1rem">Total acumulado hoy</span>
                        <span style="font-weight:800;color:var(--delivery);font-size:1.2rem">${window.formatBs(totalAcumulado)}</span>
                    </div>
                    <h4 style="margin-bottom:12px;color:var(--text-secondary);font-size:.85rem;font-weight:600">Desglose por motorizado:</h4>
                    ${motorizadosHtml}
                </div>
                <div style="padding:1rem 1.2rem;border-top:1px solid var(--border);display:flex;justify-content:flex-end">
                    <button onclick="this.closest('[style*=fixed]').remove()" class="btn-primary" style="padding:.5rem 1.2rem;font-size:.85rem;background:linear-gradient(135deg, var(--delivery), #00838F)">Cerrar</button>
                </div>
            </div>`;
            modal.addEventListener('click', e => { if (e.target === modal) modal.remove(); });
            document.body.appendChild(modal);
        } catch (e) { console.error('Error abriendo detalle deliverys admin:', e); window.mostrarToast('❌ Error al cargar datos de deliverys', 'error'); }
    };

    window._toggleDeliveryDetalle = function(detalleId) {
        const detalleEl = document.getElementById(detalleId);
        const iconEl = document.getElementById('icon_' + detalleId);
        if (detalleEl) {
            if (detalleEl.style.display === 'none' || detalleEl.style.display === '') {
                detalleEl.style.display = 'block';
                if (iconEl) iconEl.style.transform = 'rotate(180deg)';
            } else {
                detalleEl.style.display = 'none';
                if (iconEl) iconEl.style.transform = 'rotate(0deg)';
            }
        }
    };

    window._abrirDetalleVentasAdmin = async function() {
        try {
            // Verificar que haya token JWT antes de hacer la consulta
            if (!window.jwtToken) {
                console.warn('⚠️ No hay token JWT, omitiendo detalle de ventas');
                window.mostrarToast('❌ Sesión expirada, recarga la página', 'error');
                return;
            }
            
            const hoy = new Date(); hoy.setHours(0, 0, 0, 0);
            const manana = new Date(hoy); manana.setDate(manana.getDate() + 1);
            const { data: ventasHoy, error: errorVentas } = await window.supabaseClient.from('ventas').select('*').gte('fecha', hoy.toISOString()).lt('fecha', manana.toISOString());
            
            // Si hay error 401, no continuar
            if (errorVentas) {
                if (errorVentas.status === 401 || errorVentas.code === 'PGRST301') {
                    console.warn('⚠️ Token expirado o sin permisos para cargar ventas');
                    window.mostrarToast('❌ Sesión expirada, recarga la página', 'error');
                    return;
                }
                throw errorVentas;
            }
            
            if (!ventasHoy || ventasHoy.length === 0) { window.mostrarToast('No hay ventas registradas hoy', 'info'); return; }
            const pedidoIds = ventasHoy.map(v => v.pedido_id);
            
            const { data: pedidosHoy, error: errorPedidos } = await window.supabaseClient.from('pedidos').select('*').in('id', pedidoIds);
            
            // Si hay error 401 en pedidos, no continuar
            if (errorPedidos) {
                if (errorPedidos.status === 401 || errorPedidos.code === 'PGRST301') {
                    console.warn('⚠️ Token expirado o sin permisos para cargar pedidos');
                    window.mostrarToast('❌ Sesión expirada, recarga la página', 'error');
                    return;
                }
                throw errorPedidos;
            }
            const tasa = window.configGlobal?.tasa_cambio || window.configGlobal?.tasa_efectiva || 400;
            const fmtBs = window.formatBs;
            const _netoCobradoPedido = (pedido) => {
                if (!pedido) return 0;
                if (pedido.metodo_pago === 'invitacion') return 0;
                let recibido = 0;
                if (pedido.pagos_mixtos && pedido.pagos_mixtos.length) {
                    pedido.pagos_mixtos.forEach(pg => {
                        if (pg.metodo === 'invitacion') return;
                        recibido += pg.metodo === 'efectivo_usd' ? (pg.monto || 0) * tasa : (pg.montoBs || pg.monto || 0);
                    });
                } else { recibido = pedido.subtotal_bs || 0; }
                return Math.max(0, recibido - (pedido.vuelto_entregado || 0));
            };
            let totalNeto = 0, vt_ebs = 0, vt_eusd = 0, vt_pm = 0, vt_pv = 0, vt_cond = 0, vt_favor = 0, vt_delivery = 0, vt_inv_count = 0, vt_inv_acum = 0;
            ventasHoy.forEach(v => {
                const p = pedidosHoy.find(pd => pd.id === v.pedido_id);
                if (!p) return;
                const neto = _netoCobradoPedido(p);
                totalNeto += neto;
                if (p.condonado > 0) vt_cond += p.condonado;
                if (p.a_favor_caja > 0) vt_favor += p.a_favor_caja;
                if (p.tipo === 'delivery' && (p.costo_delivery_bs || 0) > 0) vt_delivery += p.costo_delivery_bs;
                const pagos = p.pagos_mixtos;
                if (pagos && pagos.length) {
                    let vueltoR = p.vuelto_entregado || 0;
                    pagos.forEach(pg => {
                        const mbs = pg.metodo === 'efectivo_usd' ? (pg.monto || 0) * tasa : (pg.montoBs || pg.monto || 0);
                        if (pg.metodo === 'efectivo_bs') { const n = Math.max(0, mbs - vueltoR); vueltoR = Math.max(0, vueltoR - mbs); vt_ebs += n; }
                        else if (pg.metodo === 'efectivo_usd') { const n = Math.max(0, mbs - vueltoR); vueltoR = Math.max(0, vueltoR - mbs); vt_eusd += n; }
                        else if (pg.metodo === 'pago_movil') vt_pm += mbs;
                        else if (pg.metodo === 'punto_venta') vt_pv += mbs;
                        else if (pg.metodo === 'invitacion') { vt_inv_count++; const subtotalInv = (p.items || []).reduce((s, i) => s + window.usdToBs((i.precioUnitarioUSD || 0) * (i.cantidad || 1)), 0); vt_inv_acum += subtotalInv + (p.costo_delivery_bs || 0); }
                    });
                } else {
                    const metodo = p.metodo_pago || v.metodo_pago || '';
                    const bs = neto;
                    if (metodo === 'efectivo_bs') vt_ebs += bs;
                    else if (metodo === 'efectivo_usd') vt_eusd += bs;
                    else if (metodo === 'pago_movil') vt_pm += bs;
                    else if (metodo === 'punto_venta') vt_pv += bs;
                    else if (metodo === 'invitacion') { vt_inv_count++; const subtotalInv = (p.items || []).reduce((s, i) => s + window.usdToBs((i.precioUnitarioUSD || 0) * (i.cantidad || 1)), 0); vt_inv_acum += subtotalInv + (p.costo_delivery_bs || 0); }
                }
            });
            const vcol = (ico, label, val, color) => val > 0 ? `<div style="display:flex;align-items:center;gap:6px;padding:8px;background:rgba(0,0,0,.08);border-radius:8px;border-left:3px solid ${color}">
                <i class="${ico}" style="color:${color};width:14px;text-align:center"></i>
                <div style="flex:1"><div style="font-size:.72rem;color:var(--text-muted)">${label}</div><div style="font-weight:700;color:${color};font-size:.9rem">${fmtBs(val)}</div></div>
            </div>` : '';
            const detallesCobros = ventasHoy.map(v => {
                const p = pedidosHoy.find(pd => pd.id === v.pedido_id);
                if (!p) return '';
                const hora = new Date(p.fecha).toLocaleTimeString('es-VE', { hour: '2-digit', minute: '2-digit', timeZone: 'America/Caracas' });
                const items = (p.items || []).slice(0, 2).map(i => `${i.cantidad || 1}× ${i.nombre}`).join(', ');
                const masItems = (p.items || []).length > 2 ? ` +${(p.items || []).length - 2} más` : '';
                const neto = _netoCobradoPedido(p);
                const metodoLabel = { efectivo_bs: 'Ef.Bs', efectivo_usd: 'Ef.USD', pago_movil: 'P.Móvil', punto_venta: 'Pto.Venta', invitacion: 'Invitación' };
                let metodoStr = p.metodo_pago || 'N/A';
                if (p.pagos_mixtos && p.pagos_mixtos.length > 1) metodoStr = p.pagos_mixtos.map(pg => metodoLabel[pg.metodo] || pg.metodo).join(' + ');
                else metodoStr = metodoLabel[p.metodo_pago] || p.metodo_pago || 'N/A';
                return `<div style="padding:.6rem .75rem;border-radius:8px;background:var(--table-header);margin-bottom:.4rem;font-size:.82rem">
                    <div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:.2rem">
                        <span style="font-weight:700;color:var(--text-dark)">${hora} · ${p.tipo || 'mesa'}</span>
                        <span style="font-weight:800;color:var(--success)">${fmtBs(neto)}</span>
                    </div>
                    <div style="color:var(--text-muted);font-size:.75rem">${items}${masItems}</div>
                    <div style="font-size:.72rem;color:var(--text-muted);margin-top:.15rem">${metodoStr}</div>
                </div>`;
            }).join('');
            const contenido = `
                <div style="margin-bottom:1rem;padding:.85rem;background:var(--table-header);border-radius:10px">
                    <div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:.4rem">
                        <span style="font-weight:700;color:var(--text-dark)">Neto cobrado hoy</span>
                        <span style="font-weight:800;color:var(--success);font-size:1.15rem">${fmtBs(totalNeto)}</span>
                    </div>
                    <div style="display:flex;justify-content:space-between;color:var(--text-muted);font-size:.82rem">
                        <span>Pedidos cobrados</span><span style="font-weight:600">${ventasHoy.length}</span>
                    </div>
                </div>
                <div style="font-size:.78rem;font-weight:700;text-transform:uppercase;letter-spacing:.5px;color:var(--text-muted);margin-bottom:.6rem">Desglose por método de pago</div>
                <div style="display:grid;grid-template-columns:1fr 1fr;gap:.5rem;margin-bottom:1rem">
                    ${vcol('fas fa-money-bill-wave', 'Efectivo Bs', vt_ebs, 'var(--success)')}
                    ${vcol('fas fa-dollar-sign', 'Efectivo USD', vt_eusd, '#4CAF50')}
                    ${vcol('fas fa-mobile-alt', 'Pago Móvil', vt_pm, 'var(--info)')}
                    ${vcol('fas fa-credit-card', 'Punto de Venta', vt_pv, 'var(--warning)')}
                    ${vcol('fas fa-motorcycle', 'Deliverys', vt_delivery, 'var(--delivery)')}
                    ${vt_inv_count > 0 ? `<div style="grid-column:1/-1;padding:8px;background:rgba(0,0,0,.06);border-radius:8px;border-left:3px solid var(--propina);font-size:.82rem">
                        <span style="color:var(--propina);font-weight:700">🎁 Invitaciones: ${vt_inv_count}</span>
                        <span style="color:var(--text-muted);font-size:.75rem;margin-left:.5rem">Valor real: ${fmtBs(vt_inv_acum)}</span>
                    </div>` : ''}
                    ${vcol('fas fa-hand-holding-heart', 'Condonado', vt_cond, '#E91E63')}
                    ${vcol('fas fa-piggy-bank', 'A favor de caja', vt_favor, 'var(--accent)')}
                </div>
                ${detallesCobros ? `<div style="font-size:.78rem;font-weight:700;text-transform:uppercase;letter-spacing:.5px;color:var(--text-muted);margin-bottom:.6rem">Detalle por cobro</div>${detallesCobros}` : ''}`;
            const modal = document.createElement('div');
            modal.style.cssText = 'position:fixed;inset:0;background:rgba(0,0,0,.6);z-index:9999;display:flex;align-items:center;justify-content:center;padding:1rem';
            modal.innerHTML = `<div style="background:var(--card-bg);border-radius:16px;width:100%;max-width:500px;max-height:90vh;overflow-y:auto;box-shadow:0 8px 32px rgba(0,0,0,.35)">
                <div style="display:flex;justify-content:space-between;align-items:center;padding:1.2rem 1.5rem;border-bottom:2px solid var(--border);position:sticky;top:0;background:var(--card-bg);z-index:1">
                    <h3 style="font-size:1rem;font-weight:700;color:var(--text-dark)"><i class="fas fa-chart-line" style="color:var(--accent);margin-right:.5rem"></i>Ventas Hoy — Neto Cobrado</h3>
                    <button onclick="this.closest('[style*=fixed]').remove()" style="background:var(--table-header);border:none;border-radius:8px;width:30px;height:30px;cursor:pointer;font-size:.9rem;color:var(--text-muted)">✕</button>
                </div>
                <div style="padding:1.25rem">${contenido}</div>
                <div class="modal-footer" style="padding:1rem 1.5rem;border-top:1px solid var(--border);display:flex;justify-content:flex-end">
                    <button onclick="this.closest('[style*=fixed]').remove()" class="btn-primary" style="padding:.5rem 1.2rem;font-size:.85rem">Cerrar</button>
                </div>
            </div>`;
            modal.addEventListener('click', e => { if (e.target === modal) modal.remove(); });
            document.body.appendChild(modal);
        } catch (e) { console.error('Error abriendo detalle ventas admin:', e); window.mostrarToast('❌ Error al cargar el detalle de ventas', 'error'); }
    };
})();