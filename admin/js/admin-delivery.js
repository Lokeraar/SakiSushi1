// admin-delivery.js — Motorizados (Deliverys)
(function() {
    'use strict';
    var currentDeliveryFotoFile = null;
    var currentDeliveryFotoUrl  = '';

    // ════════════════════════════════════════
    // CARGAR / RENDERIZAR DELIVERYS
    // ════════════════════════════════════════
    window.cargarDeliverys = async function() {
        try {
            // Limpiar registros pagados de días anteriores (mantener solo los de hoy)
            await window.limpiarPagadosAnteriores();
            
            var r = await window.supabaseClient.from('deliverys').select('*').order('nombre');
            if (r.error) throw r.error;
            window.deliverys = r.data || [];
            await window.renderizarDeliverys();
            if (typeof window.cargarUltimosViajes === 'function') window.cargarUltimosViajes();
            if (typeof window._actualizarDeliverysHoyStats === 'function') window._actualizarDeliverysHoyStats();
        } catch(e) { console.error('Error cargando deliverys:', e); }
    };
    
    // Limpiar registros pagados de días anteriores (solo mantener los de hoy)
    window.limpiarPagadosAnteriores = async function() {
        try {
            var hoy = new Date(); hoy.setHours(0,0,0,0);
            // Eliminar registros pagados de días anteriores a hoy
            var r = await window.supabaseClient.from('entregas_delivery')
                .delete()
                .eq('pagado', true)
                .lt('fecha_entrega', hoy.toISOString());
            if (r.error) console.warn('Error limpiando pagados anteriores:', r.error);
        } catch(e) { console.warn('Error en limpiarPagadosAnteriores:', e); }
    };

    window.renderizarDeliverys = async function() {
        if (window._renderizandoDeliverys) return;
        window._renderizandoDeliverys = true;
        var container = document.getElementById('deliverysGrid');
        if (!container) { window._renderizandoDeliverys = false; return; }
        
        var deliverys = window.deliverys || [];
        if (!deliverys.length) {
            container.innerHTML = '<p style="color:var(--text-muted);font-size:.88rem;text-align:center;padding:2rem">No hay motorizados registrados.</p>';
            window._renderizandoDeliverys = false;
            return;
        }

        var sorted = deliverys.slice().sort(function(a, b) { return a.nombre.localeCompare(b.nombre); });
        
        var html = '';
        for (var i = 0; i < sorted.length; i++) {
            var d = sorted[i];
            var acumulado = await window.obtenerAcumuladoDelivery(d.id);
            var tasa = window.configGlobal?.tasa_efectiva || window.configGlobal?.tasa_cambio || 400;
            var acumUsd = tasa > 0 ? acumulado / tasa : 0;
            
            var inicial = d.nombre.charAt(0).toUpperCase();
            var avatar = d.foto
                ? '<div class="ucard-avatar"><img src="' + d.foto + '" style="width:100%;height:100%;object-fit:cover;border-radius:8px;cursor:pointer" onclick="window.expandirImagen(this.src)"></div>'
                : '<div class="ucard-avatar"><div style="width:100%;height:100%;font-size:1.4rem;border-radius:8px;display:flex;align-items:center;justify-content:center;background:linear-gradient(135deg,var(--delivery),#00838F);color:#fff">' + inicial + '</div></div>';
            
            var dbadge = d.activo
                ? '<span class="ucard-status-inline" style="color:var(--success);margin-left:auto"><i class="fas fa-check-circle"></i> ACTIVO</span>'
                : '<span class="ucard-status-inline" style="color:var(--text-muted);margin-left:auto"><i class="fas fa-circle"></i> INACTIVO</span>';
            
            var toggleClass = d.activo ? 'btn-toggle-on' : 'btn-toggle-off';
            var toggleTxt   = d.activo ? 'Inhabilitar' : 'Activar';
            var toggleVal   = String(!d.activo);

            html += '<div class="card-standard delivery-card" data-delivery-id="' + d.id + '" id="delivery-card-' + d.id + '" style="border-left-color:var(--delivery)">'
                + avatar
                + '<div class="ucard-body">'
                +   '<div class="ucard-top">'
                +     '<div class="ucard-names">'
                +       '<div class="ucard-line1"><span class="delivery-nombre">' + d.nombre + '</span>' + dbadge + '</div>'
                +       '<div class="ucard-line2" style="margin-top:.35rem;display:flex;align-items:center;gap:.5rem;flex-wrap:wrap">'
                +         '<span class="delivery-pendiente" style="font-size:.9rem;font-weight:600;color:var(--delivery)">Total Acumulado ' + window.formatUSD(acumUsd) + ' / ' + window.formatBs(acumulado) + '</span>'
                +       '</div>'
                +       '<div class="ucard-line3" style="margin-top:.5rem;display:flex;align-items:center;gap:.4rem">'
                +         '<button class="btn-primary btn-pagado-delivery" style="font-size:.7rem;padding:.3rem .5rem" onclick="window.mostrarPagoDelivery(\'' + d.id + '\')" title="Registrar pago">'
                +           '<i class="fas fa-hand-holding-usd"></i> Pagar'
                +         '</button>'
                +         '<button class="btn-toggle ' + toggleClass + '" style="font-size:.7rem;padding:.3rem .5rem" onclick="window.toggleDeliveryActivo(\'' + d.id + '\',' + toggleVal + ')">' + toggleTxt + '</button>'
                +         '<div class="ucard-actions-right">'
                +           '<button class="btn-icon edit" onclick="window.editarDelivery(\'' + d.id + '\')" title="Editar"><i class="fas fa-edit"></i></button>'
                +           '<button class="btn-icon delete" onclick="window.eliminarDelivery(\'' + d.id + '\')" title="Eliminar"><i class="fas fa-trash"></i></button>'
                +         '</div>'
                +       '</div>'
                +     '</div>'
                +   '</div>'
                + '</div>'
                + '</div>';
        }
        container.innerHTML = html;
        window._renderizandoDeliverys = false;
    };

    window.obtenerAcumuladoDelivery = async function(deliveryId) {
        try {
            var r = await window.supabaseClient.from('entregas_delivery').select('monto_bs').eq('delivery_id', deliveryId).eq('pagado', false);
            if (r.error) throw r.error;
            return (r.data || []).reduce(function(sum,e){ return sum+(e.monto_bs||0); }, 0);
        } catch(e) { return 0; }
    };

    // ════════════════════════════════════════
    // AGREGAR / EDITAR / TOGGLE / ELIMINAR
    // ════════════════════════════════════════
    window.agregarDelivery = async function() {
        var inp = document.getElementById('nuevoDelivery');
        var nombre = inp ? inp.value.trim() : '';
        if (!nombre) { window.mostrarToast('Ingresa un nombre', 'error'); return; }
        var btn = document.querySelector('.btn-delivery');
        if (btn) { btn.disabled=true; btn.innerHTML='<i class="fas fa-spinner fa-spin"></i>'; }
        try {
            var r = await window.supabaseClient.from('deliverys').insert([{ id: window.generarId('del_'), nombre: nombre, activo: true }]);
            if (r.error) throw r.error;
            if (inp) inp.value = '';
            await window.cargarDeliverys();
            window.mostrarToast('Motorizado agregado', 'success');
        } catch(e) { window.mostrarToast('Error: '+(e.message||e),'error'); }
        finally { if(btn){btn.disabled=false;btn.innerHTML='<i class="fas fa-plus"></i> Agregar';} }
    };

    window.editarDelivery = function(id) {
        var d = (window.deliverys||[]).find(function(x){ return x.id===id; });
        if (!d) return;
        window.deliveryEditandoId = id;
        var ni=document.getElementById('deliveryNombre'); if(ni) ni.value=d.nombre||'';
        var es=document.getElementById('deliveryEstado'); if(es) es.value=d.activo?'true':'false';
        if (d.foto) {
            var ui=document.getElementById('deliveryFotoUrl'); if(ui) ui.value=d.foto;
            var pi=document.getElementById('deliveryPreviewImg'); if(pi) pi.src=d.foto;
            var pd=document.getElementById('deliveryFotoPreview'); if(pd) pd.style.display='flex';
            currentDeliveryFotoUrl=d.foto;
        } else {
            var ui2=document.getElementById('deliveryFotoUrl'); if(ui2) ui2.value='';
            var pd2=document.getElementById('deliveryFotoPreview'); if(pd2) pd2.style.display='none';
            currentDeliveryFotoUrl='';
        }
        var modal=document.getElementById('deliveryModal'); if(modal) modal.classList.add('active');
    };

    window.toggleDeliveryActivo = async function(id, activo) {
        try {
            await window.supabaseClient.from('deliverys').update({ activo: activo }).eq('id', id);
            await window.cargarDeliverys();
        } catch(e) { console.error('Error toggle delivery:', e); }
    };

    window.eliminarDelivery = async function(id) {
        var d = (window.deliverys||[]).find(function(x){ return x.id===id; });
        if (!d) return;
        window.mostrarConfirmacionPremium(
            'Eliminar Motorizado',
            'Eliminar al motorizado "' + d.nombre + '"? También se borrarán sus registros de entrega.',
            async function() {
                try {
                    await window.supabaseClient.from('entregas_delivery').delete().eq('delivery_id', id);
                    await window.supabaseClient.from('deliverys').delete().eq('id', id);
                    await window.cargarDeliverys();
                    window.mostrarToast('Motorizado eliminado', 'success');
                } catch(e) { window.mostrarToast('Error: '+(e.message||e),'error'); }
            }
        );
    };

    // ════════════════════════════════════════
    // PAGO DELIVERY (completo o parcial)
    // ════════════════════════════════════════
    window.mostrarPagoDelivery = async function(id) {
        var d = (window.deliverys||[]).find(function(x){ return x.id===id; });
        if (!d) return;
        window.deliveryParaPago = id;
        var acumulado = await window.obtenerAcumuladoDelivery(id);
        var body = document.getElementById('confirmPagoDeliveryBody');
        if (body) body.innerHTML = '<p style="margin-bottom:1rem"><strong>' + d.nombre + '</strong> tiene acumulado: <span style="color:var(--accent);font-weight:700;font-size:1.1rem">' + window.formatBs(acumulado) + '</span></p>'
            + '<div style="display:flex;flex-direction:column;gap:.75rem">'
            + '<label style="display:flex;align-items:flex-start;gap:.75rem;padding:.85rem 1rem;border:2px solid var(--border);border-radius:10px;cursor:pointer">'
            + '<input type="radio" name="tipoPago" value="total" checked style="margin-top:3px;accent-color:var(--success)">'
            + '<div><div style="font-weight:700;font-size:.9rem;color:var(--text-dark)">Pago total</div><div style="font-size:.78rem;color:var(--text-muted)">Reinicia el acumulado a Bs 0,00</div></div>'
            + '<span style="margin-left:auto;font-weight:800;color:var(--success)">' + window.formatBs(acumulado) + '</span></label>'
            + '<label style="display:flex;align-items:flex-start;gap:.75rem;padding:.85rem 1rem;border:2px solid var(--border);border-radius:10px;cursor:pointer">'
            + '<input type="radio" name="tipoPago" value="parcial" style="margin-top:3px;accent-color:var(--warning)">'
            + '<div style="flex:1"><div style="font-weight:700;font-size:.9rem;color:var(--text-dark)">Pago parcial</div>'
            + '<div style="font-size:.78rem;color:var(--text-muted);margin-bottom:.4rem">Ingresa el monto a pagar</div>'
            + '<input type="number" id="montoPagoParcial" placeholder="Monto en Bs" step="0.01" min="0.01" max="' + acumulado + '" style="width:100%;padding:.5rem .75rem;border:1px solid var(--border);border-radius:8px;font-family:Montserrat,sans-serif;font-size:.88rem;outline:none;background:var(--input-bg);color:var(--text-dark)" onclick="event.stopPropagation()" oninput="document.querySelector(\'[name=tipoPago][value=parcial]\').checked=true">'
            + '</div></label></div>';
        var btn = document.getElementById('confirmPagoDeliveryBtn');
        if (btn) btn.onclick = window.confirmarPagoDelivery;
        var modal = document.getElementById('confirmPagoDeliveryModal');
        if (modal) modal.classList.add('active');
    };

    window.confirmarPagoDelivery = async function() {
        if (!window.deliveryParaPago) return;
        var btn = document.getElementById('confirmPagoDeliveryBtn');
        if (btn && btn.disabled) return;
        
        var tipo = (document.querySelector('[name="tipoPago"]:checked')||{}).value || 'total';
        var acumulado = await window.obtenerAcumuladoDelivery(window.deliveryParaPago);
        
        // Validaciones según el tipo de pago
        if (tipo === 'parcial') {
            var inp = document.getElementById('montoPagoParcial');
            var monto = parseFloat(inp ? inp.value : 0);
            
            if (!monto || monto <= 0) {
                window.mostrarToast('Ingresa un monto válido', 'error');
                if(btn){ btn.disabled=false; btn.innerHTML='Confirmar'; }
                return;
            }
            
            if (monto > acumulado) {
                var restante = acumulado;
                window.mostrarToast('El monto no puede ser mayor al acumulado. Máximo disponible: ' + window.formatBs(restante), 'error');
                if(btn){ btn.disabled=false; btn.innerHTML='Confirmar'; }
                return;
            }
            
            if (acumulado - monto < 0) {
                window.mostrarToast('El pago dejaría un saldo negativo. Monto máximo disponible: ' + window.formatBs(acumulado), 'error');
                if(btn){ btn.disabled=false; btn.innerHTML='Confirmar'; }
                return;
            }
            
            if (btn) { btn.disabled=true; btn.innerHTML='<i class="fas fa-spinner fa-spin"></i> Procesando...'; }
            try {
                var r1 = await window.supabaseClient.from('entregas_delivery').insert([{ 
                    delivery_id: window.deliveryParaPago, 
                    monto_bs: -monto, 
                    pedido_id: null, 
                    fecha_entrega: new Date().toISOString(),
                    pagado: false
                }]);
                if (r1.error) throw r1.error;
                window.mostrarToast('Pago parcial registrado', 'success');
            } catch(e) { 
                window.mostrarToast('Error: '+(e.message||e), 'error'); 
            } finally { 
                if(btn){ btn.disabled=false; btn.innerHTML='Confirmar'; } 
            }
        } else {
            // Pago total
            if (acumulado <= 0) {
                window.mostrarToast('No hay acumulado para pagar. El saldo actual es ' + window.formatBs(acumulado), 'error');
                if(btn){ btn.disabled=false; btn.innerHTML='Confirmar'; }
                return;
            }
            
            if (btn) { btn.disabled=true; btn.innerHTML='<i class="fas fa-spinner fa-spin"></i> Procesando...'; }
            try {
                // Crear un registro de egreso por el monto acumulado restante (pago total)
                var r2 = await window.supabaseClient.from('entregas_delivery').insert([{ 
                    delivery_id: window.deliveryParaPago, 
                    monto_bs: -acumulado, 
                    pedido_id: null, 
                    fecha_entrega: new Date().toISOString(),
                    pagado: false,
                    es_pago_total: true
                }]);
                if (r2.error) throw r2.error;
                
                // Marcar todos los registros pendientes como pagados
                var r3 = await window.supabaseClient.from('entregas_delivery')
                    .update({ pagado: true })
                    .eq('delivery_id', window.deliveryParaPago)
                    .eq('pagado', false)
                    .neq('es_pago_total', true);
                if (r3.error) throw r3.error;
                
                window.mostrarToast('Pago total registrado. Acumulado reiniciado.', 'success');
            } catch(e) { 
                window.mostrarToast('Error: '+(e.message||e), 'error'); 
            } finally { 
                if(btn){ btn.disabled=false; btn.innerHTML='Confirmar'; } 
            }
        }
        
        window.cerrarModal('confirmPagoDeliveryModal');
        await window.cargarDeliverys();
    };

    // ════════════════════════════════════════
    // STATS CARDS (5.1)
    // ════════════════════════════════════════
    window._actualizarDeliverysHoyStats = async function() {
        try {
            var tasa = window.configGlobal?.tasa_efectiva || window.configGlobal?.tasa_cambio || 400;
            var hoy  = new Date(); hoy.setHours(0,0,0,0);
            var man  = new Date(hoy); man.setDate(man.getDate()+1);
            var ra = await window.supabaseClient.from('entregas_delivery').select('monto_bs');
            var totAll    = (ra.data||[]).reduce(function(s,e){ return s+(e.monto_bs||0); },0);
            var totAllUsd = tasa>0 ? totAll/tasa : 0;
            var rh = await window.supabaseClient.from('entregas_delivery').select('monto_bs')
                .gte('fecha_entrega', hoy.toISOString()).lt('fecha_entrega', man.toISOString());
            var lista  = rh.data || [];
            var totBs  = lista.reduce(function(s,e){ return s+(e.monto_bs||0); },0);
            var totUsd = tasa>0 ? totBs/tasa : 0;
            var cnt    = lista.length;
            var avgBs  = cnt>0 ? totBs/cnt : 0;
            var avgUsd = tasa>0 ? avgBs/tasa : 0;
            function _s(id,v){ var el=document.getElementById(id); if(el) el.textContent=v; }
            _s('deliverysHoyDashboard', window.formatUSD(totUsd)+' / '+window.formatBs(totBs));
            _s('deliverysTotalCard',    window.formatUSD(totAllUsd)+' / '+window.formatBs(totAll));
            _s('deliverysCountCard',    String(cnt));
            _s('deliverysPromedioCard', window.formatUSD(avgUsd)+' / '+window.formatBs(avgBs));
        } catch(e) { console.error('Error stats deliverys:',e); }
    };

    // ════════════════════════════════════════
    // TABLA ÚLTIMOS 5 VIAJES (5.2)
    // ════════════════════════════════════════
    window.cargarUltimosViajes = async function() {
        var tbody = document.getElementById('ultimosViajesTbody');
        if (!tbody) return;
        try {
            var tasa = window.configGlobal?.tasa_efectiva || window.configGlobal?.tasa_cambio || 400;
            var r = await window.supabaseClient.from('entregas_delivery')
                .select('*, deliverys(nombre), pedidos(id, mesa, cliente_nombre, items, parroquia)')
                .order('fecha_entrega', { ascending: false }).limit(5);
            if (r.error) throw r.error;
            var lista = r.data || [];
            if (!lista.length) { tbody.innerHTML='<tr><td colspan="5" style="text-align:center;padding:1.5rem;color:var(--text-muted)">Sin viajes registrados</td></tr>'; return; }
            tbody.innerHTML = lista.map(function(e) {
                var motor = e.deliverys ? e.deliverys.nombre : '—';
                var parroquia = e.pedidos && e.pedidos.parroquia ? e.pedidos.parroquia : '—';
                var resumen = '—';
                if (e.pedidos && e.pedidos.mesa) resumen = 'Mesa '+e.pedidos.mesa;
                else if (e.pedidos && e.pedidos.cliente_nombre) resumen = e.pedidos.cliente_nombre;
                else if (e.pedidos && e.pedidos.items && e.pedidos.items.length) {
                    resumen = e.pedidos.items.slice(0,2).map(function(i){ return (i.cantidad||1)+'x '+i.nombre; }).join(', ');
                    if (e.pedidos.items.length>2) resumen += ' +'+(e.pedidos.items.length-2)+' más';
                } else if (e.pedido_id) { resumen=e.pedido_id.slice(0,8); }
                var mBs  = e.monto_bs||0;
                var mUsd = tasa>0 ? mBs/tasa : 0;
                var hora = new Date(e.fecha_entrega).toLocaleString('es-VE',{timeZone:'America/Caracas',hour:'2-digit',minute:'2-digit'});
                var pagoBadge = mBs < 0 ? '<span style="display:inline-block;background:#d32f2f;color:#fff;padding:2px 6px;border-radius:4px;font-size:.7rem;font-weight:700;margin-right:6px">PAGO</span>' : '';
                return '<tr>'
                    + '<td style="padding:.6rem 1rem;border-bottom:1px solid var(--border);font-size:.82rem;max-width:160px;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;line-height:1.2">'+pagoBadge+resumen+'</td>'
                    + '<td style="padding:.6rem 1rem;border-bottom:1px solid var(--border);font-size:.82rem;font-weight:600;line-height:1.2">'+motor+'</td>'
                    + '<td style="padding:.6rem 1rem;border-bottom:1px solid var(--border);font-size:.82rem;line-height:1.2">'+parroquia+'</td>'
                    + '<td style="padding:.6rem 1rem;border-bottom:1px solid var(--border);font-size:.82rem;font-weight:700;color:var(--delivery);line-height:1.2">'+window.formatUSD(mUsd)+'<br><span style="font-size:.72rem;color:var(--text-muted)"> '+window.formatBs(mBs)+'</span></td>'
                    + '<td style="padding:.6rem 1rem;border-bottom:1px solid var(--border);font-size:.78rem;color:var(--text-muted);line-height:1.2">'+hora+'</td>'
                    + '</tr>';
            }).join('');
        } catch(err) {
            var tb2=document.getElementById('ultimosViajesTbody');
            if(tb2) tb2.innerHTML='<tr><td colspan="5" style="text-align:center;color:var(--danger)">Error al cargar</td></tr>';
        }
    };

    // ════════════════════════════════════════
    // HISTORIAL COMPLETO HOY (5.3)
    // ════════════════════════════════════════
    window.verHistorialEnviosHoy = async function() {
        try {
            var tasa = window.configGlobal?.tasa_efectiva || window.configGlobal?.tasa_cambio || 400;
            var hoy  = new Date(); hoy.setHours(0,0,0,0);
            var man  = new Date(hoy); man.setDate(man.getDate()+1);
            var r = await window.supabaseClient.from('entregas_delivery')
                .select('*, deliverys(nombre), pedidos(id, mesa, cliente_nombre, items, parroquia)')
                .gte('fecha_entrega', hoy.toISOString()).lt('fecha_entrega', man.toISOString())
                .order('fecha_entrega', { ascending: false });
            var lista  = r.data || [];
            var totBs  = lista.reduce(function(s,e){ return s+(e.monto_bs||0); },0);
            var totUsd = tasa>0 ? totBs/tasa : 0;
            var rows = lista.map(function(e) {
                var motor = e.deliverys ? e.deliverys.nombre : '—';
                var parroquia = e.pedidos && e.pedidos.parroquia ? e.pedidos.parroquia : '—';
                var resumen = '—';
                if (e.pedidos && e.pedidos.mesa) resumen='Mesa '+e.pedidos.mesa;
                else if (e.pedidos && e.pedidos.cliente_nombre) resumen=e.pedidos.cliente_nombre;
                else if (e.pedidos && e.pedidos.items && e.pedidos.items.length) {
                    resumen=e.pedidos.items.slice(0,2).map(function(i){return (i.cantidad||1)+'x '+i.nombre;}).join(', ');
                }
                var mBs=e.monto_bs||0; var mUsd=tasa>0?mBs/tasa:0;
                var hora=new Date(e.fecha_entrega).toLocaleString('es-VE',{timeZone:'America/Caracas',day:'2-digit',month:'2-digit',hour:'2-digit',minute:'2-digit'});
                var pagoBadge = mBs < 0 ? '<span style="display:inline-block;background:#d32f2f;color:#fff;padding:2px 6px;border-radius:4px;font-size:.7rem;font-weight:700;margin-right:6px">PAGO</span>' : '';
                return '<tr>'
                    +'<td style="padding:.55rem .85rem;border-bottom:1px solid var(--border);font-size:.8rem;line-height:1.2">'+pagoBadge+resumen+'</td>'
                    +'<td style="padding:.55rem .85rem;border-bottom:1px solid var(--border);font-size:.82rem;font-weight:600;line-height:1.2">'+motor+'</td>'
                    +'<td style="padding:.55rem .85rem;border-bottom:1px solid var(--border);font-size:.82rem;line-height:1.2">'+parroquia+'</td>'
                    +'<td style="padding:.55rem .85rem;border-bottom:1px solid var(--border);font-size:.82rem;font-weight:700;color:var(--delivery);line-height:1.2">'+window.formatUSD(mUsd)+' / '+window.formatBs(mBs)+'</td>'
                    +'<td style="padding:.55rem .85rem;border-bottom:1px solid var(--border);font-size:.78rem;color:var(--text-muted);line-height:1.2">'+hora+'</td>'
                    +'</tr>';
            }).join('');
            var pl=lista.length;
            var totLine=pl+' envío'+(pl!==1?'s':'')+' · Total: '+window.formatUSD(totUsd)+' / '+window.formatBs(totBs);
            var emptyRow='<tr><td colspan="5" style="text-align:center;padding:1.5rem;color:var(--text-muted)">Sin envíos hoy</td></tr>';
            var ov=document.createElement('div');
            ov.style.cssText='position:fixed;inset:0;background:rgba(0,0,0,.75);z-index:10001;display:flex;align-items:center;justify-content:center;padding:1rem;backdrop-filter:blur(3px)';
            ov.innerHTML='<div style="background:var(--card-bg);border-radius:16px;max-width:700px;width:100%;max-height:85vh;overflow:hidden;display:flex;flex-direction:column;box-shadow:0 20px 40px rgba(0,0,0,.4)">'
                +'<div style="background:linear-gradient(135deg,var(--delivery),#00838F);padding:1rem 1.5rem;color:#fff;display:flex;justify-content:space-between;align-items:center">'
                +'<div><div style="font-weight:700;font-size:1rem"><i class="fas fa-motorcycle"></i> Historial Envíos — Hoy</div><div style="font-size:.75rem;opacity:.8;margin-top:2px">'+totLine+'</div></div>'
                +'<button onclick="this.closest(\'[style*=position]\').remove()" style="background:rgba(255,255,255,.2);border:none;color:#fff;border-radius:50%;width:30px;height:30px;cursor:pointer;font-size:1rem;font-weight:700;display:flex;align-items:center;justify-content:center">&#x2715;</button>'
                +'</div>'
                +'<div style="overflow-y:auto;flex:1"><table style="width:100%;border-collapse:collapse">'
                +'<thead><tr style="background:var(--secondary)">'
                +'<th style="padding:.6rem .85rem;text-align:left;font-size:.72rem;text-transform:uppercase;color:var(--text-muted);font-weight:700">Resumen</th>'
                +'<th style="padding:.6rem .85rem;text-align:left;font-size:.72rem;text-transform:uppercase;color:var(--text-muted);font-weight:700">Motorizado</th>'
                +'<th style="padding:.6rem .85rem;text-align:left;font-size:.72rem;text-transform:uppercase;color:var(--text-muted);font-weight:700">Delivery hacia</th>'
                +'<th style="padding:.6rem .85rem;text-align:left;font-size:.72rem;text-transform:uppercase;color:var(--text-muted);font-weight:700">Monto</th>'
                +'<th style="padding:.6rem .85rem;text-align:left;font-size:.72rem;text-transform:uppercase;color:var(--text-muted);font-weight:700">Hora</th>'
                +'</tr></thead>'
                +'<tbody>'+(rows||emptyRow)+'</tbody></table></div>'
                +'<div style="padding:.85rem 1.5rem;border-top:1px solid var(--border);display:flex;justify-content:flex-end">'
                +'<button onclick="this.closest(\'[style*=position]\').remove()" style="background:var(--primary);color:#fff;border:none;padding:.55rem 1.25rem;border-radius:8px;cursor:pointer;font-family:Montserrat,sans-serif;font-weight:600;font-size:.85rem">Cerrar</button>'
                +'</div></div>';
            ov.addEventListener('click', function(e){ if(e.target===ov) ov.remove(); });
            document.body.appendChild(ov);
        } catch(err) { console.error('Error historial envíos:',err); window.mostrarToast('Error al cargar historial','error'); }
    };

    // ════════════════════════════════════════
    // FOTO DELIVERY
    // ════════════════════════════════════════
    function handleDeliveryFotoFile() {
        var fi=document.getElementById('deliveryFoto');
        var ui=document.getElementById('deliveryFotoUrl');
        var pd=document.getElementById('deliveryFotoPreview');
        var pi=document.getElementById('deliveryPreviewImg');
        var rb=document.getElementById('deliveryFotoRemoveBtn');
        if(!fi||!pd) return;
        if(fi.files&&fi.files[0]){
            currentDeliveryFotoFile=fi.files[0]; currentDeliveryFotoUrl='';
            if(ui){ui.value='';ui.disabled=true;}
            var reader=new FileReader();
            reader.onload=function(e){if(pi)pi.src=e.target.result;pd.style.display='flex';if(rb)rb.style.display='flex';};
            reader.readAsDataURL(fi.files[0]);
        } else { if(ui)ui.disabled=false; }
    }
    function handleDeliveryFotoUrl() {
        var ui=document.getElementById('deliveryFotoUrl');
        var fi=document.getElementById('deliveryFoto');
        var pd=document.getElementById('deliveryFotoPreview');
        var pi=document.getElementById('deliveryPreviewImg');
        var rb=document.getElementById('deliveryFotoRemoveBtn');
        if(!ui||!pd) return;
        if(fi&&fi.files&&fi.files[0]) return;
        var url=ui.value.trim();
        if(url){currentDeliveryFotoUrl=url;currentDeliveryFotoFile=null;if(pi)pi.src=url;pd.style.display='flex';if(rb)rb.style.display='flex';}
        else{pd.style.display='none';if(rb)rb.style.display='none';if(pi)pi.src='';currentDeliveryFotoUrl='';}
    }
    function removeDeliveryFoto() {
        var fi=document.getElementById('deliveryFoto');
        var ui=document.getElementById('deliveryFotoUrl');
        var pd=document.getElementById('deliveryFotoPreview');
        var pi=document.getElementById('deliveryPreviewImg');
        var rb=document.getElementById('deliveryFotoRemoveBtn');
        if(fi)fi.value=''; if(ui){ui.value='';ui.disabled=false;}
        if(pd)pd.style.display='none'; if(rb)rb.style.display='none';
        if(pi)pi.src=''; currentDeliveryFotoFile=null; currentDeliveryFotoUrl='';
    }

    // ════════════════════════════════════════
    // GUARDAR DELIVERY
    // ════════════════════════════════════════
    var saveDeliveryBtn = document.getElementById('saveDelivery');
    if (saveDeliveryBtn) {
        saveDeliveryBtn.addEventListener('click', async function() {
            if (!window.deliveryEditandoId) return;
            if (this.disabled) return;
            var nombre = ((document.getElementById('deliveryNombre')||{}).value||'').trim();
            var activoEl = document.getElementById('deliveryEstado');
            var activo = activoEl ? activoEl.value==='true' : true;
            if (!nombre) { window.mostrarToast('Ingresa un nombre','error'); return; }
            var fotoUrl='';
            var archivoFoto=(document.getElementById('deliveryFoto')||{files:[]}).files[0];
            var fotoUrlInput=((document.getElementById('deliveryFotoUrl')||{}).value)||'';
            if(archivoFoto){
                var res=await window.subirImagenPlatillo(archivoFoto,'deliverys');
                if(res.success) fotoUrl=res.url; else{window.mostrarToast('Error al subir foto: '+res.error,'error');return;}
            } else if(fotoUrlInput){fotoUrl=fotoUrlInput;}
            try {
                this.disabled=true; this.innerHTML='<i class="fas fa-spinner fa-spin"></i>';
                var r=await window.supabaseClient.from('deliverys').update({nombre:nombre,activo:activo,foto:fotoUrl||null}).eq('id',window.deliveryEditandoId);
                if(r.error) throw r.error;
                window.cerrarModal('deliveryModal');
                await window.cargarDeliverys();
                window.mostrarToast('Motorizado actualizado','success');
            } catch(e){window.mostrarToast('Error al actualizar','error');}
            finally{this.disabled=false;this.innerHTML='Guardar';}
        });
    }

    var closeDelivery=document.getElementById('closeDeliveryModal');
    if(closeDelivery) closeDelivery.addEventListener('click',function(){window.cerrarModal('deliveryModal');});
    var cancelDelivery=document.getElementById('cancelDeliveryEdit');
    if(cancelDelivery) cancelDelivery.addEventListener('click',function(){window.cerrarModal('deliveryModal');});
    var dFotoFile=document.getElementById('deliveryFoto');
    if(dFotoFile) dFotoFile.addEventListener('change',handleDeliveryFotoFile);
    var dFotoUrl=document.getElementById('deliveryFotoUrl');
    if(dFotoUrl) dFotoUrl.addEventListener('input',handleDeliveryFotoUrl);
    var dFotoRm=document.getElementById('deliveryFotoRemoveBtn');
    if(dFotoRm) dFotoRm.addEventListener('click',removeDeliveryFoto);

})();
