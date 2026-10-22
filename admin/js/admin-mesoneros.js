// admin-mesoneros.js — Gestión de Mesoneros y Propinas con Realtime
(function() {
    'use strict';

    // Variables globales de estado
    let currentMesoneroFotoFile = null;
    let currentMesoneroFotoUrl  = '';
    let mesoneroParaPagoId      = null;

    // ════════════════════════════════════════
    // ACTUALIZAR ACUMULADOS PENDIENTES
    // ════════════════════════════════════════
    window.actualizarAcumuladosPendientes = async function() {
        try {
            // Consulta todas las propinas pendientes (ingresos no entregados)
            const { data: ingresos, error } = await window.supabaseClient
                .from('propinas')
                .select('id, mesonero_id, monto_bs, moneda_original, monto_original')
                .eq('entregado', false);

            if (error) throw error;

            // Consulta todos los pagos parciales (egresos) para restarlos del acumulado
            const { data: pagosParciales, error: errorPagos } = await window.supabaseClient
                .from('propinas')
                .select('propina_original_id, monto_bs, moneda_original, monto_original')
                .eq('referencia', 'EGRESO')
                .eq('entregado', true)
                .not('propina_original_id', 'is', null);

            if (errorPagos) {
                console.error('Error consultando pagos parciales:', errorPagos);
            }

            // Crear un mapa de pagos por propina_original_id
            const pagosPorPropina = {};
            (pagosParciales || []).forEach(function(pago) {
                const originalId = pago.propina_original_id;
                if (!pagosPorPropina[originalId]) {
                    pagosPorPropina[originalId] = { bs: 0, usd: 0 };
                }
                if (pago.moneda_original === 'USD' && pago.monto_original) {
                    pagosPorPropina[originalId].usd += pago.monto_original;
                } else {
                    pagosPorPropina[originalId].bs += (pago.monto_bs || 0);
                }
            });

            // Sumar monto_bs por mesonero_id, separando USD y Bs, restando pagos parciales
            const acumuladoBs = {};
            const acumuladoUSDCrudo = {}; // monto original en USD
            const tasaBase = Number(window.configGlobal?.tasa_cambio || 400);
            
            (ingresos || []).forEach(function(p) {
                const mid = p.mesonero_id;
                const pagosDeEstaPropina = pagosPorPropina[p.id] || { bs: 0, usd: 0 };
                
                if (p.moneda_original === 'USD' && p.monto_original) {
                    const usdRestante = p.monto_original - pagosDeEstaPropina.usd;
                    if (usdRestante > 0) {
                        acumuladoUSDCrudo[mid] = (acumuladoUSDCrudo[mid] || 0) + usdRestante;
                    }
                } else {
                    const bsRestante = p.monto_bs - pagosDeEstaPropina.bs;
                    if (bsRestante > 0) {
                        acumuladoBs[mid] = (acumuladoBs[mid] || 0) + bsRestante;
                    }
                }
            });

            // Actualizar en DOM: selector [data-mesonero-id] → elemento .mesonero-pendiente
            const tarjetas = document.querySelectorAll('[data-mesonero-id]');
            tarjetas.forEach(function(card) {
                const mesoneroId = card.getAttribute('data-mesonero-id');
                const pendienteEl = card.querySelector('.mesonero-pendiente');
                
                const tasaEfectiva = Number(window.configGlobal?.tasa_efectiva || window.configGlobal?.tasa_cambio || 400);
                const tasaBaseActual = Number(window.configGlobal?.tasa_cambio || 400);
                const usdCrudo = acumuladoUSDCrudo[mesoneroId] || 0;
                const bsTotal = acumuladoBs[mesoneroId] || 0;
                const usdEnBs = usdCrudo * tasaBaseActual;
                const pendienteTotal = bsTotal + usdEnBs;
                const usdTotal = tasaEfectiva > 0 ? pendienteTotal / tasaEfectiva : 0;

                if (pendienteEl) {
                    let htmlPendiente = '<span style="font-size:.75rem;color:var(--text-muted);margin-right:.35rem">Pendiente:</span>' +
                        '<span style="font-weight:700;color:var(--propina)">' + window.formatUSD(usdTotal) + ' / ' + window.formatBs(pendienteTotal) + '</span>';
                    
                    if (usdCrudo > 0) {
                        htmlPendiente += '<div style="font-size:.7rem;color:var(--usd-color);margin-top:2px">' +
                            '<i class="fas fa-dollar-sign"></i> ' + usdCrudo.toFixed(2) + ' / ' + window.formatBs(usdEnBs) + '</div>';
                    }
                    if (bsTotal > 0) {
                        htmlPendiente += '<div style="font-size:.7rem;color:var(--bs-color);margin-top:2px">' +
                            'Bs: ' + window.formatBs(bsTotal) + '</div>';
                    }
                    pendienteEl.innerHTML = htmlPendiente;

                    if (pendienteTotal > 0) {
                        pendienteEl.style.color = 'var(--propina)';
                        pendienteEl.style.fontWeight = '700';
                    } else {
                        pendienteEl.style.color = 'var(--success)';
                        pendienteEl.style.fontWeight = '600';
                    }
                }

                // Actualizar botón Pagado
                const btnPagado = card.querySelector('.btn-pagado-mesonero');
                if (btnPagado) {
                    btnPagado.disabled = pendienteTotal <= 0;
                    btnPagado.style.opacity = pendienteTotal <= 0 ? '0.5' : '1';
                    btnPagado.style.cursor = pendienteTotal <= 0 ? 'not-allowed' : 'pointer';
                }
            });

            // Llamar a cargarPropinas para actualizar totales generales
            await window.cargarPropinas();
        } catch (e) {
            console.error('Error actualizando acumulados:', e);
        }
    };

    // ════════════════════════════════════════
    // INICIALIZACIÓN DE REALTIME
    // ════════════════════════════════════════
    function iniciarRealtimePropinas() {
        // Limpiar canal previo si existe
        if (window.propinasChannel) {
            window.supabaseClient.removeChannel(window.propinasChannel);
        }

        // Crear nuevo canal para cambios en propinas
        window.propinasChannel = window.supabaseClient.channel('propinas-mesoneros-realtime')
            .on('postgres_changes',
                { event: '*', schema: 'public', table: 'propinas' },
                async function(payload) {
                    console.log('Cambio en propinas:', payload);
                    // Actualizar acumulados inmediatamente sin delay
                    window.actualizarAcumuladosPendientes();
                }
            )
            .subscribe();
    }

    // ════════════════════════════════════════
    // CARGAR / RENDERIZAR MESONEROS
    // ════════════════════════════════════════
    window.cargarMesoneros = async function() {
        try {
            const { data, error } = await window.supabaseClient
                .from('mesoneros').select('*').order('nombre');
            if (error) throw error;
            window.mesoneros = data || [];
            await renderizarMesonerosConAcumulados();
            await cargarPropinas();
            iniciarRealtimePropinas();
        } catch(e) { 
            console.error('Error cargando mesoneros:', e); 
            window.mostrarToast('Error al cargar mesoneros', 'error');
        }
    };

    async function renderizarMesonerosConAcumulados() {
        const container = document.getElementById('mesonerosList');
        if (!container) return;
        
        const mesoneros = window.mesoneros || [];
        if (!mesoneros.length) {
            container.innerHTML = '<p style="color:var(--text-muted);font-size:.88rem;text-align:center;padding:2rem">No hay mesoneros registrados.</p>';
            return;
        }

        const sorted = [...mesoneros].sort((a, b) => a.nombre.localeCompare(b.nombre));
        
        let html = '';
        for (const m of sorted) {
            const inicial = m.nombre.charAt(0).toUpperCase();
            const avatar = m.foto
                ? '<div class="ucard-avatar"><img src="' + m.foto + '" style="width:100%;height:100%;object-fit:cover;border-radius:8px;cursor:pointer" onclick="window.expandirImagen(this.src)"></div>'
                : '<div class="ucard-avatar"><div style="width:100%;height:100%;font-size:1.4rem;border-radius:8px;display:flex;align-items:center;justify-content:center;background:linear-gradient(135deg,var(--propina),#7B1FA2);color:#fff">' + inicial + '</div></div>';
            
            const badge = m.activo
                ? '<span class="ucard-status-inline" style="color:var(--success);margin-left:auto"><i class="fas fa-check-circle"></i> ACTIVO</span>'
                : '<span class="ucard-status-inline" style="color:var(--text-muted);margin-left:auto"><i class="fas fa-circle"></i> INACTIVO</span>';
            
            const toggleClass = m.activo ? 'btn-toggle-on' : 'btn-toggle-off';
            const toggleTxt   = m.activo ? 'Inhabilitar' : 'Activar';
            const toggleVal   = String(!m.activo);

            html += '<div class="card-standard mesonero-card" data-mesonero-id="' + m.id + '" id="mesonero-card-' + m.id + '" style="border-left-color:var(--propina)">'
                + avatar
                + '<div class="ucard-body">'
                +   '<div class="ucard-top">'
                +     '<div class="ucard-names">'
                +       '<div class="ucard-line1"><span class="mesonero-nombre">' + m.nombre + '</span>' + badge + '</div>'
                +       '<div class="ucard-line2" style="margin-top:.35rem;display:flex;align-items:center;gap:.5rem;flex-wrap:wrap">'
                +         '<span class="mesonero-pendiente" style="font-size:.9rem;font-weight:600">Calculando...</span>'
                +       '</div>'
                +       '<div class="ucard-line3" style="margin-top:.5rem;display:flex;align-items:center;gap:.4rem">'
                +         '<button class="btn-primary btn-pagado-mesonero" style="font-size:.7rem;padding:.3rem .5rem" onclick="window.abrirModalPago(\'' + m.id + '\')" title="Registrar pago">'
                +           '<i class="fas fa-hand-holding-usd"></i> Pagar'
                +         '</button>'
                +         '<button class="btn-toggle ' + toggleClass + '" style="font-size:.7rem;padding:.3rem .5rem" onclick="window.toggleMesoneroActivo(\'' + m.id + '\',' + toggleVal + ')">' + toggleTxt + '</button>'
                +         '<div class="ucard-actions-right">'
                +           '<button class="btn-icon edit" onclick="window.editarMesonero(\'' + m.id + '\')" title="Editar"><i class="fas fa-edit"></i></button>'
                +           '<button class="btn-icon delete" onclick="window.eliminarMesonero(\'' + m.id + '\')" title="Eliminar"><i class="fas fa-trash"></i></button>'
                +         '</div>'
                +       '</div>'
                +     '</div>'
                +   '</div>'
                + '</div>'
                + '</div>';
        }
        container.innerHTML = html;

        // Actualizar acumulados pendientes usando await para esperar la consulta
        await window.actualizarAcumuladosPendientes();
    }

    // ════════════════════════════════════════
    // GESTIÓN DE MESONEROS (CRUD)
    // ════════════════════════════════════════
    window.editarMesonero = function(id) {
        const m = (window.mesoneros || []).find(x => x.id === id);
        if (!m) return;
        window.mesoneroEditandoId = id;
        const mt = document.getElementById('mesoneroModalTitle');
        if (mt) mt.textContent = 'Editar Mesonero';
        const ni = document.getElementById('mesoneroNombre'); if (ni) ni.value = m.nombre || '';
        const as = document.getElementById('mesoneroActivo'); if (as) as.value = m.activo ? 'true' : 'false';
        if (m.foto) {
            const ui = document.getElementById('mesoneroFotoUrl'); if (ui) ui.value = m.foto;
            const pi = document.getElementById('mesoneroPreviewImg'); if (pi) pi.src = m.foto;
            const pd = document.getElementById('mesoneroFotoPreview'); if (pd) pd.style.display = 'flex';
            currentMesoneroFotoUrl = m.foto;
        } else {
            const ui = document.getElementById('mesoneroFotoUrl'); if (ui) ui.value = '';
            const pd = document.getElementById('mesoneroFotoPreview'); if (pd) pd.style.display = 'none';
            currentMesoneroFotoUrl = '';
        }
        const modal = document.getElementById('mesoneroModal');
        if (modal) modal.classList.add('active');
    };

    window.toggleMesoneroActivo = async function(id, activo) {
        try {
            await window.supabaseClient.from('mesoneros').update({ activo }).eq('id', id);
            await window.cargarMesoneros();
            window.mostrarToast('Estado actualizado', 'success');
        } catch(e) { 
            console.error('Error toggle mesonero:', e); 
            window.mostrarToast('Error al actualizar estado', 'error');
        }
    };

    window.eliminarMesonero = async function(id) {
        const m = (window.mesoneros || []).find(x => x.id === id);
        if (!m) return;
        window.mostrarConfirmacionPremium(
            'Eliminar Mesonero',
            'Eliminar al mesonero "' + m.nombre + '"? Esta acción no se puede deshacer.',
            async function() {
                try {
                    await window.supabaseClient.from('mesoneros').delete().eq('id', id);
                    await window.cargarMesoneros();
                    window.mostrarToast('Mesonero eliminado', 'success');
                } catch(e) { 
                    window.mostrarToast('Error: ' + (e.message || e), 'error'); 
                }
            }
        );
    };

    window.agregarMesonero = async function() {
        const inp = document.getElementById('nuevoMesonero');
        const nombre = inp ? inp.value.trim() : '';
        if (!nombre) { window.mostrarToast('Ingresa un nombre', 'error'); return; }
        const btn = document.querySelector('[onclick="window.agregarMesonero()"]');
        if (btn) { btn.disabled = true; btn.innerHTML = '<i class="fas fa-spinner fa-spin"></i>'; }
        try {
            const { error } = await window.supabaseClient.from('mesoneros')
                .insert([{ id: window.generarId('mes_'), nombre, activo: true }]);
            if (error) throw error;
            if (inp) inp.value = '';
            await window.cargarMesoneros();
            window.mostrarToast('Mesonero agregado', 'success');
        } catch(e) {
            window.mostrarToast('Error: ' + (e.message || e), 'error');
        } finally {
            if (btn) { btn.disabled = false; btn.innerHTML = '<i class="fas fa-plus"></i> Agregar'; }
        }
    };

    // ════════════════════════════════════════
    // CALCULAR ACUMULADO PENDIENTE POR MESONERO
    // ════════════════════════════════════════
    async function calcularAcumuladoPendiente(mesoneroId) {
        const { data: ingresos, error } = await window.supabaseClient
            .from('propinas')
            .select('id, monto_bs, monto_original, moneda_original')
            .eq('mesonero_id', mesoneroId)
            .eq('entregado', false);
        
        if (error) {
            console.error('Error calculando acumulado:', error);
            return 0;
        }
        
        // Consultar pagos parciales para este mesonero
        const { data: pagosParciales, error: errorPagos } = await window.supabaseClient
            .from('propinas')
            .select('propina_original_id, monto_bs, monto_original, moneda_original')
            .eq('referencia', 'EGRESO')
            .eq('entregado', true)
            .not('propina_original_id', 'is', null);
        
        // Crear mapa de pagos por propina_original_id
        const pagosPorPropina = {};
        (pagosParciales || []).forEach(function(pago) {
            const originalId = pago.propina_original_id;
            if (!pagosPorPropina[originalId]) {
                pagosPorPropina[originalId] = { bs: 0, usd: 0 };
            }
            if (pago.moneda_original === 'USD' && pago.monto_original) {
                pagosPorPropina[originalId].usd += pago.monto_original;
            } else {
                pagosPorPropina[originalId].bs += (pago.monto_bs || 0);
            }
        });
        
        let totalBs = 0;
        let totalUSDCrudo = 0;
        const tasaBase = Number(window.configGlobal?.tasa_cambio || 400);
        
        (ingresos || []).forEach(function(p) {
            const pagosDeEstaPropina = pagosPorPropina[p.id] || { bs: 0, usd: 0 };
            
            if (p.moneda_original === 'USD' && p.monto_original) {
                const usdRestante = p.monto_original - pagosDeEstaPropina.usd;
                if (usdRestante > 0) {
                    totalUSDCrudo += usdRestante;
                }
            } else {
                const bsRestante = p.monto_bs - pagosDeEstaPropina.bs;
                if (bsRestante > 0) {
                    totalBs += bsRestante;
                }
            }
        });
        
        // Retornar el total en Bs (USD convertido a tasa base)
        return totalBs + (totalUSDCrudo * tasaBase);
    }

    // ════════════════════════════════════════
    // MODAL DE PAGO (TOTAL O PARCIAL)
    // ════════════════════════════════════════
    window.abrirModalPago = async function(mesoneroId) {
        mesoneroParaPagoId = mesoneroId;
        const m = (window.mesoneros || []).find(x => x.id === mesoneroId);
        if (!m) return;

        const acumulado = await calcularAcumuladoPendiente(mesoneroId);
        const tasa = Number(window.configGlobal?.tasa_efectiva || window.configGlobal?.tasa_cambio || 400) || 400;
        const usd = tasa > 0 ? acumulado / tasa : 0;

        const modalContent = document.getElementById('pagoModalContent');
        if (!modalContent) return;

        modalContent.innerHTML = ''
            + '<div style="padding:1.5rem">'
            +   '<div style="text-align:center;margin-bottom:1.5rem">'
            +     '<div style="width:70px;height:70px;border-radius:50%;background:linear-gradient(135deg,var(--propina),#7B1FA2);display:flex;align-items:center;justify-content:center;margin:0 auto 1rem">'
            +       '<i class="fas fa-hand-holding-heart" style="font-size:2rem;color:#fff"></i>'
            +     '</div>'
            +     '<h3 style="font-size:1.1rem;font-weight:700;margin-bottom:.5rem">Registrar Pago a ' + m.nombre + '</h3>'
            +     '<p style="color:var(--text-muted);font-size:.85rem">El monto acumulado actual equivale a:</p>'
            +     '<div id="pagoMontoPendiente" style="font-size:1.5rem;font-weight:700;color:var(--propina);margin-top:.5rem">'
            +       window.formatUSD(usd) + ' / ' + window.formatBs(acumulado)
            +     '</div>'
            +   '</div>'
            +   '<div class="form-group" style="margin-bottom:1rem;text-align:left">'
            +     '<label style="display:block;font-size:.85rem;font-weight:600;margin-bottom:.5rem">Método de pago al mesonero</label>'
            +     '<select id="pagoMetodo" class="tcb-input" style="width:100%;padding:.6rem;border-radius:8px;border:1px solid var(--border);background:var(--card-bg);color:var(--text)" onchange="window.actualizarLabelMontoPago()">'
            +       '<option value="efectivo_bs">Efectivo Bs</option>'
            +       '<option value="efectivo_usd">Efectivo USD</option>'
            +       '<option value="pago_movil">Pago Móvil</option>'
            +     '</select>'
            +   '</div>'
            +   '<div style="display:grid;grid-template-columns:1fr 1fr;gap:1rem;margin-bottom:1.5rem">'
            +     '<button id="btnPagoTotal" class="btn-primary" style="width:100%;padding:.75rem 1rem;font-weight:600" onclick="window.confirmarPagoTotal()">'
            +       '<i class="fas fa-check-double"></i> Pago Total'
            +     '</button>'
            +     '<button id="btnPagoParcialToggle" class="btn-secondary" style="width:100%;padding:.75rem 1rem;font-weight:600" onclick="window.togglePagoParcial()">'
            +       '<i class="fas fa-coins"></i> Pago Parcial'
            +     '</button>'
            +   '</div>'
            +   '<div id="pagoParcialSection" style="display:none;background:var(--secondary);padding:1rem;border-radius:8px;border:1px solid var(--border);margin-bottom:1.5rem">'
            +     '<label id="pagoParcialLabel" style="display:block;font-size:.85rem;font-weight:600;margin-bottom:.5rem;color:var(--text-muted)">Monto a pagar (BS)</label>'
            +     '<input type="number" id="pagoParcialMonto" step="0.01" min="0.01" max="' + acumulado + '" style="width:100%;padding:.75rem;border:1px solid var(--border);border-radius:8px;font-size:1rem;font-family:Montserrat,sans-serif" placeholder="Ej: 50.00" oninput="window.actualizarVistaPreviaPago()">'
            +     '<p style="font-size:.75rem;color:var(--text-muted);margin-top:.5rem"><i class="fas fa-info-circle"></i> El monto restante permanecerá como pendiente</p>'
            +     '<div id="pagoPreviewSection" style="display:none"></div>'
            +   '</div>'
            +   '<div style="display:flex;gap:.75rem;justify-content:flex-end">'
            +     '<button class="btn-secondary" style="flex:1;padding:.75rem 1rem;font-weight:600" onclick="window.cerrarModalPago()">Cancelar</button>'
            +     '<button id="btnConfirmarPagoParcial" class="btn-success" style="flex:1;padding:.75rem 1rem;font-weight:600;display:none" onclick="window.confirmarPagoParcial()">'
            +       '<i class="fas fa-check"></i> Confirmar'
            +     '</button>'
            +   '</div>'
            + '</div>';

        const modal = document.getElementById('pagoModal');
        if (modal) modal.classList.add('active');
        
        // Inicializar label correcto inmediatamente sin setTimeout
        window.actualizarLabelMontoPago();
    };

    window.cerrarModalPago = function() {
        const modal = document.getElementById('pagoModal');
        if (modal) modal.classList.remove('active');
        // Limpiar la vista previa al cerrar
        const previewEl = document.getElementById('pagoPreviewSection');
        if (previewEl) {
            previewEl.innerHTML = '';
            previewEl.style.display = 'none';
        }
        mesoneroParaPagoId = null;
    };

    // Actualizar label del monto según método seleccionado
    window.actualizarLabelMontoPago = async function() {
        const metodo = document.getElementById('pagoMetodo')?.value;
        const label = document.getElementById('pagoParcialLabel');
        const input = document.getElementById('pagoParcialMonto');
        
        if (!label || !input) return;
        
        // Calcular el acumulado restante real para establecer el max correcto
        let acumuladoRestante = 0;
        if (mesoneroParaPagoId) {
            try {
                const tasaBase = Number(window.configGlobal?.tasa_cambio || 400);
                
                // Consultar ingresos pendientes
                let queryIngresos = window.supabaseClient
                    .from('propinas')
                    .select('id, monto_bs, monto_original, moneda_original')
                    .eq('mesonero_id', mesoneroParaPagoId)
                    .eq('entregado', false);
                
                if (metodo === 'efectivo_usd') {
                    queryIngresos = queryIngresos.eq('moneda_original', 'USD');
                } else {
                    queryIngresos = queryIngresos.neq('moneda_original', 'USD');
                }
                
                const { data: ingresos } = await queryIngresos;
                
                // Consultar pagos parciales existentes
                const { data: pagosParciales } = await window.supabaseClient
                    .from('propinas')
                    .select('propina_original_id, monto_bs, monto_original, moneda_original')
                    .eq('referencia', 'EGRESO')
                    .eq('entregado', true)
                    .not('propina_original_id', 'is', null);
                
                // Crear mapa de pagos por propina_original_id
                const pagosPorPropina = {};
                (pagosParciales || []).forEach(function(pago) {
                    const originalId = pago.propina_original_id;
                    if (!pagosPorPropina[originalId]) {
                        pagosPorPropina[originalId] = { bs: 0, usd: 0 };
                    }
                    if (pago.moneda_original === 'USD' && pago.monto_original) {
                        pagosPorPropina[originalId].usd += pago.monto_original;
                    } else {
                        pagosPorPropina[originalId].bs += (pago.monto_bs || 0);
                    }
                });
                
                // Calcular acumulado real restando pagos parciales
                if (metodo === 'efectivo_usd') {
                    acumuladoRestante = (ingresos || []).reduce((sum, p) => {
                        const pagadoDeEsta = pagosPorPropina[p.id]?.usd || 0;
                        const restante = (p.monto_original || 0) - pagadoDeEsta;
                        return sum + (restante > 0 ? restante : 0);
                    }, 0);
                } else {
                    acumuladoRestante = (ingresos || []).reduce((sum, p) => {
                        const pagadoDeEsta = pagosPorPropina[p.id]?.bs || 0;
                        const restante = (p.monto_bs || 0) - pagadoDeEsta;
                        return sum + (restante > 0 ? restante : 0);
                    }, 0);
                }
            } catch(e) {
                console.error('Error calculando acumulado para max:', e);
            }
        }
        
        // Establecer el atributo max del input para prevenir ingreso excesivo
        input.max = acumuladoRestante > 0 ? acumuladoRestante : '0.01';
        
        if (metodo === 'efectivo_usd') {
            label.textContent = 'Monto a pagar ($)';
            // Actualizar placeholder y step para dólares
            input.placeholder = 'Ej: 10.00';
            input.step = '0.01';
        } else {
            label.textContent = 'Monto a pagar (BS)';
            input.placeholder = 'Ej: 50.00';
            input.step = '0.01';
        }
        
        // Actualizar vista previa en tiempo real
        window.actualizarVistaPreviaPago();
    };

    // Actualizar vista previa del pago en tiempo real
    window.actualizarVistaPreviaPago = async function() {
        const metodo = document.getElementById('pagoMetodo')?.value;
        const input = document.getElementById('pagoParcialMonto');
        const previewEl = document.getElementById('pagoPreviewSection');
        
        if (!input || !previewEl) return;
        
        const montoIngresado = parseFloat(input.value) || 0;
        if (montoIngresado <= 0) {
            previewEl.style.display = 'none';
            previewEl.innerHTML = '';
            return;
        }
        
        const tasaBase = Number(window.configGlobal?.tasa_cambio || 400);
        const tasaEfectiva = Number(window.configGlobal?.tasa_efectiva || window.configGlobal?.tasa_cambio || 400);
        
        let montoEnBs = montoIngresado;
        let esUSD = false;
        
        if (metodo === 'efectivo_usd') {
            esUSD = true;
            montoEnBs = montoIngresado * tasaBase;
        }
        
        // Obtener acumulado desglosado
        if (!mesoneroParaPagoId) {
            previewEl.style.display = 'none';
            previewEl.innerHTML = '';
            return;
        }
        
        try {
            // Consultar ingresos pendientes
            const { data: ingresos, error } = await window.supabaseClient
                .from('propinas')
                .select('id, monto_bs, monto_original, moneda_original')
                .eq('mesonero_id', mesoneroParaPagoId)
                .eq('entregado', false);
            
            if (error) throw error;
            
            // Consultar pagos parciales existentes
            const { data: pagosParciales, error: errorPagos } = await window.supabaseClient
                .from('propinas')
                .select('propina_original_id, monto_bs, monto_original, moneda_original')
                .eq('referencia', 'EGRESO')
                .eq('entregado', true)
                .not('propina_original_id', 'is', null);
            
            // Crear mapa de pagos por propina_original_id
            const pagosPorPropina = {};
            (pagosParciales || []).forEach(function(pago) {
                const originalId = pago.propina_original_id;
                if (!pagosPorPropina[originalId]) {
                    pagosPorPropina[originalId] = { bs: 0, usd: 0 };
                }
                if (pago.moneda_original === 'USD' && pago.monto_original) {
                    pagosPorPropina[originalId].usd += pago.monto_original;
                } else {
                    pagosPorPropina[originalId].bs += (pago.monto_bs || 0);
                }
            });
            
            let acumuladoUSDCrudo = 0;
            let acumuladoBsCrudo = 0;
            
            (ingresos || []).forEach(function(p) {
                const pagosDeEstaPropina = pagosPorPropina[p.id] || { bs: 0, usd: 0 };
                
                if (p.moneda_original === 'USD' && p.monto_original) {
                    const usdRestante = p.monto_original - pagosDeEstaPropina.usd;
                    if (usdRestante > 0) {
                        acumuladoUSDCrudo += usdRestante;
                    }
                } else {
                    const bsRestante = p.monto_bs - pagosDeEstaPropina.bs;
                    if (bsRestante > 0) {
                        acumuladoBsCrudo += bsRestante;
                    }
                }
            });
            
            const acumuladoUSDEnBs = acumuladoUSDCrudo * tasaBase;
            const acumuladoTotal = acumuladoBsCrudo + acumuladoUSDEnBs;
            
            // Calcular cómo se distribuye el pago (misma lógica que confirmarPagoParcial)
            let restoPorPagar = montoEnBs;
            let pagadoDeUSD = 0;
            let pagadoDeBs = 0;
            
            // Primero descontar de USD
            if (restoPorPagar > 0 && acumuladoUSDEnBs > 0) {
                if (restoPorPagar >= acumuladoUSDEnBs) {
                    pagadoDeUSD = acumuladoUSDEnBs;
                    restoPorPagar -= acumuladoUSDEnBs;
                } else {
                    pagadoDeUSD = restoPorPagar;
                    restoPorPagar = 0;
                }
            }
            
            // Luego descontar de Bs
            if (restoPorPagar > 0 && acumuladoBsCrudo > 0) {
                if (restoPorPagar >= acumuladoBsCrudo) {
                    pagadoDeBs = acumuladoBsCrudo;
                } else {
                    pagadoDeBs = restoPorPagar;
                }
            }
            
            // Construir mensaje de vista previa (sin repetir el encabezado principal)
            let htmlPreview = '<div style="margin-top:1rem;padding:1rem;background:var(--secondary);border-radius:8px;border:1px solid var(--border)">';
            
            htmlPreview += '<div style="font-size:.85rem;font-weight:600;margin-bottom:.5rem;color:var(--text)">';
            if (esUSD) {
                htmlPreview += 'Pagando $' + montoIngresado.toFixed(2) + ' (equiv. a ' + window.formatBs(montoEnBs) + ')';
            } else {
                htmlPreview += 'Pagando Bs ' + window.formatBs(montoEnBs);
            }
            htmlPreview += '</div>';
            
            if (pagadoDeUSD > 0) {
                const usdPagado = pagadoDeUSD / tasaBase;
                htmlPreview += '<div style="font-size:.75rem;color:var(--usd-color);margin-top:.25rem">';
                htmlPreview += '<i class="fas fa-dollar-sign"></i> Descuento: ' + window.formatBs(pagadoDeUSD);
                if (esUSD) htmlPreview += ' ($' + usdPagado.toFixed(2) + ')';
                htmlPreview += '</div>';
            }
            
            if (pagadoDeBs > 0) {
                htmlPreview += '<div style="font-size:.75rem;color:var(--bs-color);margin-top:.25rem">';
                htmlPreview += 'Bs: Descuento: ' + window.formatBs(pagadoDeBs);
                htmlPreview += '</div>';
            }
            
            // Mostrar nuevo pendiente (nunca negativo)
            const nuevoPendiente = Math.max(0, acumuladoTotal - montoEnBs);
            if (nuevoPendiente >= 0) {
                htmlPreview += '<div style="font-size:.75rem;color:var(--text-muted);margin-top:.5rem;padding-top:.5rem;border-top:1px solid var(--border)">';
                htmlPreview += 'Nuevo pendiente: ' + window.formatBs(nuevoPendiente);
                if (tasaEfectiva > 0) {
                    htmlPreview += ' (' + window.formatUSD(nuevoPendiente / tasaEfectiva) + ')';
                }
                htmlPreview += '</div>';
            }
            
            // Validación visual si el monto excede el disponible
            if (montoEnBs > acumuladoTotal) {
                htmlPreview += '<div style="font-size:.75rem;color:#f44336;margin-top:.5rem;padding-top:.5rem;border-top:1px solid #f44336;font-weight:600">';
                htmlPreview += '<i class="fas fa-exclamation-triangle"></i> El monto excede el disponible (' + window.formatBs(acumuladoTotal) + ')';
                htmlPreview += '</div>';
            }
            
            htmlPreview += '</div>';
            
            previewEl.innerHTML = htmlPreview;
            previewEl.style.display = 'block';
            
        } catch(e) {
            console.error('Error actualizando vista previa:', e);
            previewEl.style.display = 'none';
            previewEl.innerHTML = '';
        }
    };

    window.togglePagoParcial = function() {
        const section = document.getElementById('pagoParcialSection');
        const btnConfirmar = document.getElementById('btnConfirmarPagoParcial');
        const btnTotal = document.getElementById('btnPagoTotal');
        if (section && btnConfirmar && btnTotal) {
            const isHidden = section.style.display === 'none';
            section.style.display = isHidden ? 'block' : 'none';
            btnConfirmar.style.display = isHidden ? 'block' : 'none';
            btnTotal.style.opacity = isHidden ? '0.5' : '1';
            btnTotal.style.pointerEvents = isHidden ? 'none' : 'auto';
            if (isHidden) {
                const input = document.getElementById('pagoParcialMonto');
                if (input) {
                    input.focus();
                    // Limpiar vista previa al abrir
                    const previewEl = document.getElementById('pagoPreviewSection');
                    if (previewEl) {
                        previewEl.style.display = 'none';
                        previewEl.innerHTML = '';
                    }
                }
            } else {
                // Al cerrar, limpiar vista previa
                const previewEl = document.getElementById('pagoPreviewSection');
                if (previewEl) {
                    previewEl.style.display = 'none';
                    previewEl.innerHTML = '';
                }
            }
        }
    };

    window.confirmarPagoTotal = async function() {
        if (!mesoneroParaPagoId) return;
        
        const metodoPago = document.getElementById('pagoMetodo')?.value;
        if (!metodoPago) {
            window.mostrarToast('Selecciona un método de pago', 'error');
            return;
        }
        
        const btn = document.getElementById('btnPagoTotal');
        if (btn) {
            btn.disabled = true;
            btn.innerHTML = '<i class="fas fa-spinner fa-spin"></i> Procesando...';
        }
        try {
            // Obtener todas las propinas pendientes del mesonero con información completa
            // Si paga en USD, solo marcar las propinas en USD; si paga en Bs, solo las propinas en Bs
            let query = window.supabaseClient
                .from('propinas')
                .select('id, monto_bs, monto_original, moneda_original')
                .eq('mesonero_id', mesoneroParaPagoId)
                .eq('entregado', false);
            
            // Filtrar por moneda según el método de pago
            if (metodoPago === 'efectivo_usd') {
                query = query.eq('moneda_original', 'USD');
            } else {
                // Para pagos en Bs, filtrar solo las que NO son USD
                query = query.neq('moneda_original', 'USD');
            }
            
            const { data: pendientes, error: errGet } = await query;
            if (errGet) throw errGet;
            
            // Consultar pagos parciales existentes para este mesonero
            const { data: pagosParciales, error: errorPagos } = await window.supabaseClient
                .from('propinas')
                .select('propina_original_id, monto_bs, monto_original, moneda_original')
                .eq('referencia', 'EGRESO')
                .eq('entregado', true)
                .not('propina_original_id', 'is', null);
            
            if (errorPagos) {
                console.error('Error consultando pagos parciales:', errorPagos);
            }
            
            // Crear mapa de pagos por propina_original_id
            const pagosPorPropina = {};
            (pagosParciales || []).forEach(function(pago) {
                const originalId = pago.propina_original_id;
                if (!pagosPorPropina[originalId]) {
                    pagosPorPropina[originalId] = { bs: 0, usd: 0 };
                }
                if (pago.moneda_original === 'USD' && pago.monto_original) {
                    pagosPorPropina[originalId].usd += pago.monto_original;
                } else {
                    pagosPorPropina[originalId].bs += (pago.monto_bs || 0);
                }
            });
            
            // Calcular el restante real (total acumulado menos pagos parciales ya realizados)
            const tasaBase = Number(window.configGlobal?.tasa_cambio || 400);
            let totalUSDCrudo = 0;
            let totalBsCrudo = 0;
            
            (pendientes || []).forEach(function(p) {
                const pagosDeEstaPropina = pagosPorPropina[p.id] || { bs: 0, usd: 0 };
                
                if (p.moneda_original === 'USD' && p.monto_original) {
                    const usdRestante = p.monto_original - pagosDeEstaPropina.usd;
                    if (usdRestante > 0) {
                        totalUSDCrudo += usdRestante;
                    }
                } else {
                    const bsRestante = p.monto_bs - pagosDeEstaPropina.bs;
                    if (bsRestante > 0) {
                        totalBsCrudo += bsRestante;
                    }
                }
            });
            
            // El total a pagar es el restante real
            let totalPagar;
            if (metodoPago === 'efectivo_usd') {
                totalPagar = totalUSDCrudo; // Monto en USD
            } else {
                totalPagar = totalBsCrudo + (totalUSDCrudo * tasaBase); // Monto en Bs equivalente
            }
            
            if (totalPagar <= 0) {
                window.mostrarToast('No hay propinas pendientes en esta moneda', 'error');
                return;
            }
            
            // Validar que el monto a pagar no sea superior al disponible (redundante pero seguro)
            if (metodoPago === 'efectivo_usd') {
                if (totalPagar > totalUSDCrudo + 0.01) {
                    window.mostrarToast('El monto restante en USD es de $' + totalUSDCrudo.toFixed(2), 'error');
                    return;
                }
            } else {
                const maximoBs = totalBsCrudo + (totalUSDCrudo * tasaBase);
                if (totalPagar > maximoBs + 0.01) {
                    window.mostrarToast('El monto restante es de ' + window.formatBs(maximoBs), 'error');
                    return;
                }
            }
            
            // Pagar propinas en orden FIFO hasta cubrir el monto restante
            // Similar a como lo hace confirmarPagoParcial
            let restoPorPagar = totalPagar;
            
            // Validación crítica: nunca permitir que restoPorPagar sea mayor que el total disponible
            if (metodoPago === 'efectivo_usd') {
                if (restoPorPagar > totalUSDCrudo + 0.01) {
                    window.mostrarToast('Error: El monto a pagar ($' + restoPorPagar.toFixed(2) + ') excede el disponible ($' + totalUSDCrudo.toFixed(2) + ')', 'error');
                    return;
                }
            } else {
                const maximoBs = totalBsCrudo + (totalUSDCrudo * tasaBase);
                if (restoPorPagar > maximoBs + 0.01) {
                    window.mostrarToast('Error: El monto a pagar (' + window.formatBs(restoPorPagar) + ') excede el disponible (' + window.formatBs(maximoBs) + ')', 'error');
                    return;
                }
            }
            
            // Obtener propinas pendientes en orden FIFO
            let queryFIFO = window.supabaseClient
                .from('propinas')
                .select('id, monto_bs, monto_original, moneda_original')
                .eq('mesonero_id', mesoneroParaPagoId)
                .eq('entregado', false)
                .order('fecha', { ascending: true });
            
            if (metodoPago === 'efectivo_usd') {
                queryFIFO = queryFIFO.eq('moneda_original', 'USD');
            } else {
                queryFIFO = queryFIFO.neq('moneda_original', 'USD');
            }
            
            const { data: pendientesFIFO, error: errFIFO } = await queryFIFO;
            if (errFIFO) throw errFIFO;
            
            const cajeroNombre = (window.usuarioActual && window.usuarioActual.nombre) || 'Administrador';
            const ahora = new Date().toISOString();
            
            for (const prop of (pendientesFIFO || [])) {
                if (restoPorPagar <= 0.01) break;
                
                // Obtener el monto en la moneda correcta según el método de pago
                const montoPropinaEnMoneda = metodoPago === 'efectivo_usd' 
                    ? (prop.monto_original || 0) 
                    : (prop.monto_bs || 0);
                
                // Obtener cuánto ya se ha pagado de esta propina mediante pagos parciales
                const pagosDeEstaPropina = pagosPorPropina[prop.id] || { bs: 0, usd: 0 };
                const yaPagado = metodoPago === 'efectivo_usd' ? pagosDeEstaPropina.usd : pagosDeEstaPropina.bs;
                const montoRestanteDePropina = montoPropinaEnMoneda - yaPagado;
                
                if (montoRestanteDePropina <= 0.01) continue; // Esta propina ya fue cubierta por pagos parciales
                
                // Calcular cuánto se va a pagar de esta propina en esta iteración
                let montoAPagarDeEstaPropina = 0;
                
                // Usar epsilon check para comparar montos
                if (restoPorPagar >= montoRestanteDePropina - 0.01) {
                    // Caso 1: Pagar la propina completa (lo que queda de ella)
                    montoAPagarDeEstaPropina = montoRestanteDePropina;
                    
                    // Marcar la propina original como entregada
                    let updateDataOriginal = { entregado: true };
                    await window.supabaseClient.from('propinas').update(updateDataOriginal).eq('id', prop.id);
                    
                    // Crear nueva propina que representa el pago del RESTANTE de esta propina
                    let nuevoMontoOriginal = montoAPagarDeEstaPropina;
                    let nuevaMonedaOriginal = metodoPago === 'efectivo_usd' ? 'USD' : 'Bs';
                    let nuevoMontoBs = metodoPago === 'efectivo_usd' 
                        ? nuevoMontoOriginal * tasaBase 
                        : nuevoMontoOriginal;
                    let nuevaTasaAplicada = metodoPago === 'efectivo_usd' ? tasaBase : null;
                    
                    const nuevaPropina = {
                        mesonero_id: mesoneroParaPagoId,
                        mesa: prop.mesa || 'Pago parcial/total',
                        metodo: metodoPago,
                        propina_original_id: prop.id,
                        monto_original: parseFloat(nuevoMontoOriginal.toFixed(2)),
                        moneda_original: nuevaMonedaOriginal,
                        tasa_aplicada: nuevaTasaAplicada,
                        monto_bs: parseFloat(nuevoMontoBs.toFixed(2)),
                        referencia: 'EGRESO',
                        cajero: cajeroNombre,
                        fecha: ahora,
                        entregado: true
                    };
                    
                    const { error: errInsert } = await window.supabaseClient.from('propinas').insert([nuevaPropina]);
                    if (errInsert) throw errInsert;
                    
                    // Restar exactamente lo que se pagó
                    restoPorPagar -= montoAPagarDeEstaPropina;
                } else {
                    // Caso 2: Pagar parcialmente esta propina (no alcanza para cubrirla completa)
                    // NO marcar la original como entregada, solo crear registro del pago parcial
                    montoAPagarDeEstaPropina = restoPorPagar;
                    
                    let nuevoMontoOriginal = montoAPagarDeEstaPropina;
                    let nuevaMonedaOriginal = metodoPago === 'efectivo_usd' ? 'USD' : 'Bs';
                    let nuevoMontoBs = metodoPago === 'efectivo_usd' 
                        ? nuevoMontoOriginal * tasaBase 
                        : nuevoMontoOriginal;
                    let nuevaTasaAplicada = metodoPago === 'efectivo_usd' ? tasaBase : null;
                    
                    const nuevaPropina = {
                        mesonero_id: mesoneroParaPagoId,
                        mesa: prop.mesa || 'Pago parcial/total',
                        metodo: metodoPago,
                        propina_original_id: prop.id,
                        monto_original: parseFloat(nuevoMontoOriginal.toFixed(2)),
                        moneda_original: nuevaMonedaOriginal,
                        tasa_aplicada: nuevaTasaAplicada,
                        monto_bs: parseFloat(nuevoMontoBs.toFixed(2)),
                        referencia: 'EGRESO',
                        cajero: cajeroNombre,
                        fecha: ahora,
                        entregado: true
                    };
                    
                    const { error: errInsert } = await window.supabaseClient.from('propinas').insert([nuevaPropina]);
                    if (errInsert) throw errInsert;
                    
                    // Restar exactamente lo que se pagó y salir del loop
                    restoPorPagar -= montoAPagarDeEstaPropina;
                }
                
                // Verificación de seguridad en cada iteración: asegurar que restoPorPagar no sea negativo
                if (restoPorPagar < -0.01) {
                    console.error('ERROR CRÍTICO EN ITERACIÓN: restoPorPagar negativo (' + restoPorPagar.toFixed(2) + ') después de pagar ' + montoAPagarDeEstaPropina.toFixed(2));
                    break;
                }
            }
            
            // Verificación final de seguridad: asegurar que no se haya pagado de más
            if (restoPorPagar < -0.01) {
                console.error('ERROR CRÍTICO: Se pagó de más por ' + Math.abs(restoPorPagar).toFixed(2));
                // En producción, aquí se debería hacer un rollback o alerta
            }
            
            // Verificación adicional: si después del loop todavía queda restoPorPagar positivo significativo
            // significa que no había suficientes propinas para cubrir el monto (no debería ocurrir si los cálculos son correctos)
            if (restoPorPagar > 0.01) {
                console.warn('ADVERTENCIA: Quedó un saldo sin cubrir de ' + restoPorPagar.toFixed(2));
            }
            
            window.cerrarModalPago();
            // Limpiar vista previa antes de actualizar
            const previewElTotal = document.getElementById('pagoPreviewSection');
            if (previewElTotal) {
                previewElTotal.innerHTML = '';
                previewElTotal.style.display = 'none';
            }
            await window.actualizarAcumuladosPendientes();
            await window.cargarMesoneros();
            await window.cargarPropinas();
            window.renderizarPropinas();
            
            // Calcular el monto total pagado para mostrar en el toast
            const montoTotalPagado = metodoPago === 'efectivo_usd' ? totalUSDCrudo : totalBsCrudo + (totalUSDCrudo * tasaBase);
            const montoMostrar = metodoPago === 'efectivo_usd' 
                ? '$' + totalUSDCrudo.toFixed(2) + ' (a tasa base ' + tasaBase + ')'
                : window.formatBs(montoTotalPagado);
            window.mostrarToast('Pago total registrado: ' + montoMostrar, 'success');
        } catch(e) {
            console.error('Error pago total:', e);
            window.mostrarToast('Error: ' + (e.message || e), 'error');
        } finally {
            if (btn) {
                btn.disabled = false;
                btn.innerHTML = '<i class="fas fa-check-double"></i> Pago Total';
            }
        }
    };

    window.confirmarPagoParcial = async function() {
        if (!mesoneroParaPagoId) return;
        
        // Obtener el método de pago seleccionado
        const metodoPago = document.getElementById('pagoMetodo')?.value;
        if (!metodoPago) {
            window.mostrarToast('Selecciona un método de pago', 'error');
            return;
        }
        
        const input = document.getElementById('pagoParcialMonto');
        let monto = input ? parseFloat(input.value) : 0;
        
        if (!monto || monto <= 0) {
            window.mostrarToast('Ingresa un monto válido', 'error');
            return;
        }

        const tasaBase = Number(window.configGlobal?.tasa_cambio || 400);
        let montoEnMonedaSeleccionada = monto; // Monto en la moneda seleccionada (USD o Bs)
        let montoEsUSD = false;
        
        if (metodoPago === 'efectivo_usd') {
            montoEsUSD = true;
            // El usuario ingresa USD, lo trabajamos directamente en USD
        }

        // Determinar qué bucket de moneda estamos pagando
        const pagarEnUSD = (metodoPago === 'efectivo_usd');
        
        // Calcular el acumulado pendiente solo del bucket correspondiente
        let acumuladoDelBucket = 0;
        try {
            // Consultar ingresos pendientes del bucket
            let queryIngresos = window.supabaseClient
                .from('propinas')
                .select('id, monto_bs, monto_original, moneda_original')
                .eq('mesonero_id', mesoneroParaPagoId)
                .eq('entregado', false);
            
            if (pagarEnUSD) {
                queryIngresos = queryIngresos.eq('moneda_original', 'USD');
            } else {
                queryIngresos = queryIngresos.neq('moneda_original', 'USD');
            }
            
            const { data: ingresosData } = await queryIngresos;
            
            // Consultar pagos parciales existentes
            const { data: pagosParciales, error: errorPagos } = await window.supabaseClient
                .from('propinas')
                .select('propina_original_id, monto_bs, monto_original, moneda_original')
                .eq('referencia', 'EGRESO')
                .eq('entregado', true)
                .not('propina_original_id', 'is', null);
            
            // Crear mapa de pagos por propina_original_id
            const pagosPorPropina = {};
            (pagosParciales || []).forEach(function(pago) {
                const originalId = pago.propina_original_id;
                if (!pagosPorPropina[originalId]) {
                    pagosPorPropina[originalId] = { bs: 0, usd: 0 };
                }
                if (pago.moneda_original === 'USD' && pago.monto_original) {
                    pagosPorPropina[originalId].usd += pago.monto_original;
                } else {
                    pagosPorPropina[originalId].bs += (pago.monto_bs || 0);
                }
            });
            
            // Calcular acumulado real restando pagos parciales
            if (pagarEnUSD) {
                // Sumar monto_original restante de las propinas USD
                acumuladoDelBucket = (ingresosData || []).reduce((sum, p) => {
                    const pagadoDeEsta = pagosPorPropina[p.id]?.usd || 0;
                    const restante = (p.monto_original || 0) - pagadoDeEsta;
                    return sum + (restante > 0 ? restante : 0);
                }, 0);
            } else {
                // Sumar monto_bs restante de las propinas en Bs
                acumuladoDelBucket = (ingresosData || []).reduce((sum, p) => {
                    const pagadoDeEsta = pagosPorPropina[p.id]?.bs || 0;
                    const restante = (p.monto_bs || 0) - pagadoDeEsta;
                    return sum + (restante > 0 ? restante : 0);
                }, 0);
            }
        } catch(e) {
            console.error('Error calculando acumulado del bucket:', e);
        }
        
        // Validar que el monto no exceda el acumulado del bucket correspondiente
        if (montoEnMonedaSeleccionada > acumuladoDelBucket + 0.01) {
            const limiteMostrar = pagarEnUSD ? '$' + acumuladoDelBucket.toFixed(2) : window.formatBs(acumuladoDelBucket);
            window.mostrarToast('El monto restante en esta moneda es de (' + limiteMostrar + ')', 'error');
            return;
        }

        const btn = document.getElementById('btnConfirmarPagoParcial');
        if (btn) {
            btn.disabled = true;
            btn.innerHTML = '<i class="fas fa-spinner fa-spin"></i> Procesando...';
        }

        try {
            // 1. Obtener propinas pendientes SOLO del bucket correspondiente, en orden FIFO
            let queryPendientes = window.supabaseClient
                .from('propinas')
                .select('id, monto_bs, mesa, metodo, monto_original, moneda_original, tasa_aplicada, referencia, cajero, fecha')
                .eq('mesonero_id', mesoneroParaPagoId)
                .eq('entregado', false)
                .order('fecha', { ascending: true });
            
            if (pagarEnUSD) {
                queryPendientes = queryPendientes.eq('moneda_original', 'USD');
            } else {
                queryPendientes = queryPendientes.neq('moneda_original', 'USD');
            }
            
            const { data: pendientes, error: errConsulta } = await queryPendientes;
            if (errConsulta) throw errConsulta;

            let restoPorPagar = montoEnMonedaSeleccionada; // Trabajar en la moneda seleccionada
            let pagoCompletado = false;

            for (const prop of pendientes || []) {
                if (restoPorPagar <= 0.01) break;
                
                // Obtener el monto en la moneda correcta según el bucket
                const montoPropinaEnMoneda = pagarEnUSD ? (prop.monto_original || 0) : (prop.monto_bs || 0);
                
                // Usar epsilon check para comparar montos
                if (restoPorPagar >= montoPropinaEnMoneda - 0.01) {
                    // Caso 1: Pagar la propina completa
                    // Marcar la propina original como entregada (NO modificar montos para preservar historial)
                    let updateDataOriginal = { entregado: true };
                    await window.supabaseClient.from('propinas').update(updateDataOriginal).eq('id', prop.id);
                    
                    // Crear nueva propina que representa el pago (EGRESO)
                    const cajeroNombre = (window.usuarioActual && window.usuarioActual.nombre) || 'Administrador';
                    const ahora = new Date().toISOString();
                    
                    // Calcular los valores para el registro de pago
                    let nuevoMontoOriginal = 0;
                    let nuevaMonedaOriginal = 'Bs';
                    let nuevoMontoBs = 0;
                    
                    if (pagarEnUSD) {
                        // Pagando en USD: el monto_original es el monto pagado en USD
                        nuevoMontoOriginal = montoPropinaEnMoneda;
                        nuevaMonedaOriginal = 'USD';
                        nuevoMontoBs = nuevoMontoOriginal * tasaBase;
                        restoPorPagar -= montoPropinaEnMoneda;
                    } else {
                        // Pagando en Bs
                        nuevoMontoBs = montoPropinaEnMoneda;
                        nuevoMontoOriginal = nuevoMontoBs;
                        nuevaMonedaOriginal = 'Bs';
                        restoPorPagar -= montoPropinaEnMoneda;
                    }
                    
                    const nuevaPropinaCompleta = {
                        mesonero_id: mesoneroParaPagoId,
                        mesa: prop.mesa || 'General',
                        metodo: metodoPago,
                        monto_original: parseFloat(nuevoMontoOriginal.toFixed(2)),
                        moneda_original: nuevaMonedaOriginal,
                        tasa_aplicada: pagarEnUSD ? tasaBase : null,
                        monto_bs: parseFloat(nuevoMontoBs.toFixed(2)),
                        referencia: 'EGRESO',
                        cajero: cajeroNombre,
                        fecha: ahora,
                        entregado: true
                    };
                    
                    const { error: errInsert } = await window.supabaseClient
                        .from('propinas')
                        .insert([nuevaPropinaCompleta]);
                    if (errInsert) throw errInsert;
                    
                } else {
                    // Caso 2: Pago parcial sobre esta propina
                    const montoPagadoEnMoneda = restoPorPagar;
                    
                    // 2a. NO modificar la propina original - debe permanecer con su monto original
                    //     para preservar el historial correcto en "últimas 5 propinas"
                    
                    // 2b. Crear un NUEVO REGISTRO con el monto pagado (EGRESO)
                    const cajeroNombre = (window.usuarioActual && window.usuarioActual.nombre) || 'Administrador';
                    const ahora = new Date().toISOString();
                    
                    let nuevoMontoOriginalPago = 0;
                    let nuevaMonedaOriginalPago = 'Bs';
                    let nuevoMontoBsPago = 0;
                    
                    if (pagarEnUSD) {
                        nuevoMontoOriginalPago = montoPagadoEnMoneda;
                        nuevaMonedaOriginalPago = 'USD';
                        nuevoMontoBsPago = montoPagadoEnMoneda * tasaBase;
                    } else {
                        nuevoMontoBsPago = montoPagadoEnMoneda;
                        nuevoMontoOriginalPago = montoPagadoEnMoneda;
                        nuevaMonedaOriginalPago = 'Bs';
                    }
                    
                    const nuevaPropinaPago = {
                        mesonero_id: mesoneroParaPagoId,
                        mesa: prop.mesa || 'General',
                        metodo: metodoPago,
                        monto_original: parseFloat(nuevoMontoOriginalPago.toFixed(2)),
                        moneda_original: nuevaMonedaOriginalPago,
                        tasa_aplicada: pagarEnUSD ? tasaBase : null,
                        monto_bs: parseFloat(nuevoMontoBsPago.toFixed(2)),
                        referencia: 'EGRESO',
                        cajero: cajeroNombre,
                        fecha: ahora,
                        entregado: true,
                        propina_original_id: prop.id
                    };
                    
                    const { error: errInsertPago } = await window.supabaseClient
                        .from('propinas')
                        .insert([nuevaPropinaPago]);
                    if (errInsertPago) throw errInsertPago;
                    
                    restoPorPagar = 0;
                    pagoCompletado = true;
                    break;
                }
            }

            // Verificación crítica: asegurar que no se haya pagado de más (saldo negativo)
            if (restoPorPagar < -0.01) {
                throw new Error('ERROR CRÍTICO: Se intentó pagar de más por ' + Math.abs(restoPorPagar).toFixed(2) + '. El saldo no puede quedar negativo.');
            }

            // Si después del bucle aún queda resto por pagar (por error lógico), abortar
            // Usar epsilon check para evitar errores de punto flotante
            if (restoPorPagar > 0.01) {
                throw new Error('No se pudo cubrir el monto total. Verifique los datos.');
            }

            window.cerrarModalPago();
            // Limpiar vista previa antes de actualizar
            const previewElParcial = document.getElementById('pagoPreviewSection');
            if (previewElParcial) {
                previewElParcial.innerHTML = '';
                previewElParcial.style.display = 'none';
            }
            await window.actualizarAcumuladosPendientes();
            await window.cargarMesoneros();
            await window.cargarPropinas();
            window.renderizarPropinas();
            
            const montoMostrar = montoEsUSD ? '$' + monto.toFixed(2) : window.formatBs(montoEnMonedaSeleccionada);
            window.mostrarToast('Pago parcial registrado: ' + montoMostrar, 'success');
            
        } catch(e) {
            console.error('Error pago parcial:', e);
            let msg = e.message || e;
            if (e.details) msg += ' - ' + e.details;
            if (e.hint) msg += ' (Sugerencia: ' + e.hint + ')';
            window.mostrarToast('Error: ' + msg, 'error');
        } finally {
            if (btn) {
                btn.disabled = false;
                btn.innerHTML = '<i class="fas fa-check"></i> Confirmar';
            }
        }
    };

    // ════════════════════════════════════════
    // PROPINAS — cargar + renderizar + historial
    // ════════════════════════════════════════
    window.cargarPropinas = async function() {
        try {
            const h = new Date(); h.setHours(0,0,0,0);
            const m = new Date(h); m.setDate(m.getDate()+1);
            const { data, error } = await window.supabaseClient
                .from('propinas').select('*, mesoneros(nombre)')
                .gte('fecha', h.toISOString()).lt('fecha', m.toISOString())
                .order('fecha', { ascending: false });
            if (error) throw error;
            window.propinas = data || [];
            window.renderizarPropinas();
        } catch(e) { 
            console.error('Error cargando propinas:', e); 
        }
    };

    window.renderizarPropinas = function() {
        const propinas = window.propinas || [];
        // Calcular total restando los egresos (pagos parciales)
        const total    = propinas.reduce(function(s,p){ 
            const esEgreso = p.referencia === 'EGRESO';
            return esEgreso ? s - (p.monto_bs||0) : s + (p.monto_bs||0); 
        }, 0);
        const cantidad = propinas.length;
        const promedio = cantidad > 0 ? total/cantidad : 0;
        const tasa     = Number(window.configGlobal?.tasa_efectiva || window.configGlobal?.tasa_cambio || 400) || 400;
        const totalUsd = tasa > 0 ? total / tasa : 0;
        const promUsd  = tasa > 0 ? promedio / tasa : 0;
        var el;
        el = document.getElementById('propinasTotal');    if(el) el.textContent = window.formatUSD(totalUsd) + ' / ' + window.formatBs(total);
        el = document.getElementById('propinasCantidad'); if(el) el.textContent = String(cantidad);
        el = document.getElementById('propinasPromedio'); if(el) el.textContent = window.formatUSD(promUsd) + ' / ' + window.formatBs(promedio);
        el = document.getElementById('propinasHoyDashboard'); if(el) el.textContent = window.formatUSD(totalUsd) + ' / ' + window.formatBs(total);
        const tbody = document.getElementById('propinasTableBody');
        if (tbody) {
            const ultimas5 = propinas.slice(0, 5);
            if (ultimas5.length) {
                tbody.innerHTML = ultimas5.map(function(p) {
                    var hora = new Date(p.fecha).toLocaleString('es-VE',{timeZone:'America/Caracas',hour:'2-digit',minute:'2-digit'});
                    // Determinar si es pago usando referencia === 'EGRESO'
                    var isPago = p.referencia === 'EGRESO';
                    var signo = isPago ? '-' : '+';
                    var colorMonto = isPago ? 'var(--text-dark)' : 'var(--success)';
                    
                    // Formato especial para efectivo_usd: mostrar monto_original y monto_bs
                    var displayMonto = '';
                    if (p.metodo === 'efectivo_usd' && p.monto_original) {
                        if (isPago) {
                            // Pago en USD: [-$ {monto_original} (-Bs. {monto_bs})]
                            displayMonto = '$' + p.monto_original.toFixed(2) + ' (-Bs. ' + p.monto_bs.toFixed(2) + ')';
                        } else {
                            // Ingreso en USD: [+$ {monto_original} (Bs. {monto_bs})]
                            displayMonto = '$' + p.monto_original.toFixed(2) + ' (Bs. ' + p.monto_bs.toFixed(2) + ')';
                        }
                    } else {
                        // Para Bs: mostrar primero Bs, luego USD
                        var mUsd = tasa > 0 ? (p.monto_bs||0)/tasa : 0;
                        displayMonto = window.formatBs(p.monto_bs) + ' | ' + window.formatUSD(mUsd);
                    }
                    
                    // Etiqueta de tipo (Ingreso/Pago) para la columna Mesa
                    var badgeTipo = isPago 
                        ? '<span style="display:inline-block;padding:2px 6px;border-radius:4px;font-size:.65rem;background:rgba(244,67,54,.15);color:var(--text-dark);font-weight:700;margin-left:.35rem">PAGO</span>'
                        : '<span style="display:inline-block;padding:2px 6px;border-radius:4px;font-size:.65rem;background:rgba(76,175,80,.15);color:var(--success);font-weight:700;margin-left:.35rem">INGRESO</span>';
                    
                    // En caso de pago, no mostrar nombre de mesa, solo la etiqueta
                    var mesaDisplay = isPago ? badgeTipo : (p.mesa||'N/A') + badgeTipo;
                    
                    return '<tr><td>' + hora + '</td><td>' + (p.mesoneros ? p.mesoneros.nombre : 'N/A') + '</td><td>' + mesaDisplay + '</td><td>' + (p.metodo||'N/A') + '</td><td style="color:' + colorMonto + '">' + signo + ' ' + displayMonto + '</td><td>' + (p.cajero||'N/A') + '</td></tr>';
                }).join('');
            } else {
                tbody.innerHTML = '<tr><td colspan="6" style="text-align:center;padding:1rem;color:var(--text-muted)">Sin propinas hoy</td></tr>';
            }
        }
    };

    window.verHistorialPropinaHoy = async function() {
        try {
            const h   = new Date(); h.setHours(0,0,0,0);
            const m   = new Date(h); m.setDate(m.getDate()+1);
            const tasa = window.configGlobal?.tasa_efectiva || window.configGlobal?.tasa_cambio || 400;
            // Mostrar TODOS los registros (sin filtrar por entregado) para historial completo
            const { data, error } = await window.supabaseClient
                .from('propinas').select('*, mesoneros(nombre)')
                .gte('fecha', h.toISOString()).lt('fecha', m.toISOString())
                .order('fecha', { ascending: false });
            if (error) throw error;
            const lista  = data || [];
            const totBs  = lista.reduce(function(s,p){ return s+(p.monto_bs||0); }, 0);
            const totUsd = tasa > 0 ? totBs/tasa : 0;
            const rows = lista.map(function(p) {
                var mUsd = tasa > 0 ? (p.monto_bs||0)/tasa : 0;
                var hora = new Date(p.fecha).toLocaleString('es-VE',{timeZone:'America/Caracas',hour:'2-digit',minute:'2-digit'});
                // Determinar si es pago usando referencia === 'EGRESO'
                var isPago = p.referencia === 'EGRESO';
                var signo = isPago ? '-' : '+';
                var colorMonto = isPago ? 'var(--text-dark)' : 'var(--success)';
                
                // Formato especial para efectivo_usd: mostrar monto_original y monto_bs
                var displayMonto = '';
                if (p.metodo === 'efectivo_usd' && p.monto_original) {
                    if (isPago) {
                        // Pago en USD: [-$ {monto_original} (-Bs. {monto_bs})]
                        displayMonto = '$' + p.monto_original.toFixed(2) + ' (-Bs. ' + p.monto_bs.toFixed(2) + ')';
                    } else {
                        // Ingreso en USD: [+$ {monto_original} (Bs. {monto_bs})]
                        displayMonto = '$' + p.monto_original.toFixed(2) + ' (Bs. ' + p.monto_bs.toFixed(2) + ')';
                    }
                } else {
                    // Para Bs: mostrar primero Bs, luego USD
                    displayMonto = window.formatBs(p.monto_bs||0) + ' | ' + window.formatUSD(mUsd);
                }
                
                var badgeTipo = isPago 
                    ? '<span style="display:inline-block;padding:2px 6px;border-radius:4px;font-size:.65rem;background:rgba(244,67,54,.15);color:var(--text-dark);font-weight:700;margin-left:.35rem">PAGO</span>'
                    : '<span style="display:inline-block;padding:2px 6px;border-radius:4px;font-size:.65rem;background:rgba(76,175,80,.15);color:var(--success);font-weight:700;margin-left:.35rem">INGRESO</span>';
                
                // En caso de pago, no mostrar nombre de mesa, solo la etiqueta
                var mesaDisplay = isPago ? badgeTipo : (p.mesa||'N/A') + badgeTipo;
                
                return '<tr>'
                    + '<td style="padding:.55rem .85rem;border-bottom:1px solid var(--border);font-size:.78rem;color:var(--text-muted)">' + hora + '</td>'
                    + '<td style="padding:.55rem .85rem;border-bottom:1px solid var(--border);font-size:.82rem;font-weight:600">' + (p.mesoneros ? p.mesoneros.nombre : 'N/A') + '</td>'
                    + '<td style="padding:.55rem .85rem;border-bottom:1px solid var(--border);font-size:.78rem;color:var(--text-muted)">' + mesaDisplay + '</td>'
                    + '<td style="padding:.55rem .85rem;border-bottom:1px solid var(--border);font-size:.78rem">' + (p.metodo||'N/A') + '</td>'
                    + '<td style="padding:.55rem .85rem;border-bottom:1px solid var(--border);font-size:.82rem;font-weight:700;color:' + colorMonto + '">' + signo + ' ' + displayMonto + '</td>'
                    + '</tr>';
            }).join('');
            var pl = lista.length;
            var totLine = pl + ' propina' + (pl!==1?'s':'') + ' · Total: ' + window.formatUSD(totUsd) + ' | ' + window.formatBs(totBs);
            var emptyRow = '<tr><td colspan="5" style="text-align:center;padding:1.5rem;color:var(--text-muted)">Sin propinas hoy</td></tr>';
            var ov = document.createElement('div');
            ov.style.cssText = 'position:fixed;inset:0;background:rgba(0,0,0,.75);z-index:10001;display:flex;align-items:center;justify-content:center;padding:1rem;backdrop-filter:blur(3px)';
            ov.innerHTML = '<div style="background:var(--card-bg);border-radius:16px;max-width:680px;width:100%;max-height:85vh;overflow:hidden;display:flex;flex-direction:column;box-shadow:0 20px 40px rgba(0,0,0,.4)">'
                + '<div style="background:linear-gradient(135deg,var(--propina),#7B1FA2);padding:1rem 1.5rem;color:#fff;display:flex;justify-content:space-between;align-items:center">'
                +   '<div><div style="font-weight:700;font-size:1rem"><i class="fas fa-hand-holding-heart"></i> Registro</div>'
                +   '<div style="font-size:.75rem;opacity:.8;margin-top:2px">' + totLine + '</div></div>'
                +   '<button onclick="this.closest(\'[style*=position]\').remove()" style="background:rgba(255,255,255,.2);border:none;color:#fff;border-radius:50%;width:30px;height:30px;cursor:pointer;font-size:1rem;font-weight:700;display:flex;align-items:center;justify-content:center">&#x2715;</button>'
                + '</div>'
                + '<div style="overflow-y:auto;flex:1"><table style="width:100%;border-collapse:collapse">'
                + '<thead><tr style="background:var(--secondary)">'
                + '<th style="padding:.6rem .85rem;text-align:left;font-size:.72rem;text-transform:uppercase;color:var(--text-muted);font-weight:700">Hora</th>'
                + '<th style="padding:.6rem .85rem;text-align:left;font-size:.72rem;text-transform:uppercase;color:var(--text-muted);font-weight:700">Mesonero</th>'
                + '<th style="padding:.6rem .85rem;text-align:left;font-size:.72rem;text-transform:uppercase;color:var(--text-muted);font-weight:700">Mesa</th>'
                + '<th style="padding:.6rem .85rem;text-align:left;font-size:.72rem;text-transform:uppercase;color:var(--text-muted);font-weight:700">Método</th>'
                + '<th style="padding:.6rem .85rem;text-align:left;font-size:.72rem;text-transform:uppercase;color:var(--text-muted);font-weight:700">Registro</th>'
                + '</tr></thead>'
                + '<tbody>' + (rows || emptyRow) + '</tbody></table></div>'
                + '<div style="padding:.85rem 1.5rem;border-top:1px solid var(--border);display:flex;justify-content:flex-end">'
                + '<button onclick="this.closest(\'[style*=position]\').remove()" style="background:var(--primary);color:#fff;border:none;padding:.55rem 1.25rem;border-radius:8px;cursor:pointer;font-family:Montserrat,sans-serif;font-weight:600;font-size:.85rem">Cerrar</button>'
                + '</div></div>';
            ov.addEventListener('click', function(e){ if(e.target===ov) ov.remove(); });
            document.body.appendChild(ov);
        } catch(e) {
            console.error('Error historial propinas:', e);
            window.mostrarToast('Error al cargar historial', 'error');
        }
    };

    // ════════════════════════════════════════
    // FOTO MESONERO
    // ════════════════════════════════════════
    function handleMesoneroFotoFile() {
        var fi=document.getElementById('mesoneroFoto');
        var ui=document.getElementById('mesoneroFotoUrl');
        var pd=document.getElementById('mesoneroFotoPreview');
        var pi=document.getElementById('mesoneroPreviewImg');
        var rb=document.getElementById('mesoneroFotoRemoveBtn');
        if (!fi||!pd) return;
        if (fi.files && fi.files[0]) {
            currentMesoneroFotoFile=fi.files[0]; currentMesoneroFotoUrl='';
            if(ui){ui.value='';ui.disabled=true;}
            var reader=new FileReader();
            reader.onload=function(e){if(pi)pi.src=e.target.result;pd.style.display='flex';if(rb)rb.style.display='flex';};
            reader.readAsDataURL(fi.files[0]);
        } else { if(ui)ui.disabled=false; }
    }
    function handleMesoneroFotoUrl() {
        var ui=document.getElementById('mesoneroFotoUrl');
        var fi=document.getElementById('mesoneroFoto');
        var pd=document.getElementById('mesoneroFotoPreview');
        var pi=document.getElementById('mesoneroPreviewImg');
        var rb=document.getElementById('mesoneroFotoRemoveBtn');
        if(!ui||!pd) return;
        if(fi&&fi.files&&fi.files[0]) return;
        var url=ui.value.trim();
        if(url){currentMesoneroFotoUrl=url;currentMesoneroFotoFile=null;if(pi)pi.src=url;pd.style.display='flex';if(rb)rb.style.display='flex';}
        else{pd.style.display='none';if(rb)rb.style.display='none';if(pi)pi.src='';currentMesoneroFotoUrl='';}
    }
    function removeMesoneroFoto() {
        var fi=document.getElementById('mesoneroFoto');
        var ui=document.getElementById('mesoneroFotoUrl');
        var pd=document.getElementById('mesoneroFotoPreview');
        var pi=document.getElementById('mesoneroPreviewImg');
        var rb=document.getElementById('mesoneroFotoRemoveBtn');
        if(fi)fi.value=''; if(ui){ui.value='';ui.disabled=false;}
        if(pd)pd.style.display='none'; if(rb)rb.style.display='none';
        if(pi)pi.src=''; currentMesoneroFotoFile=null; currentMesoneroFotoUrl='';
    }

    // ════════════════════════════════════════
    // GUARDAR MESONERO
    // ════════════════════════════════════════
    var saveMesoneroBtn = document.getElementById('saveMesonero');
    if (saveMesoneroBtn) {
        saveMesoneroBtn.addEventListener('click', async function() {
            if (this.disabled) return;
            var id     = window.mesoneroEditandoId;
            var nombre = (document.getElementById('mesoneroNombre')||{}).value;
            if (nombre) nombre = nombre.trim();
            var activoEl = document.getElementById('mesoneroActivo');
            var activo = activoEl ? activoEl.value === 'true' : true;
            if (!nombre) { window.mostrarToast('Ingresa un nombre', 'error'); return; }
            var fotoUrl = '';
            var archivoFoto = (document.getElementById('mesoneroFoto')||{files:[]}).files[0];
            var fotoUrlInput = ((document.getElementById('mesoneroFotoUrl')||{}).value)||'';
            if (archivoFoto) {
                var res = await window.subirImagenPlatillo(archivoFoto, 'mesoneros');
                if (res.success) fotoUrl = res.url;
                else { window.mostrarToast('Error al subir foto: '+res.error,'error'); return; }
            } else if (fotoUrlInput) { fotoUrl = fotoUrlInput; }
            try {
                this.disabled=true; this.innerHTML='<i class="fas fa-spinner fa-spin"></i>';
                var dataObj = { nombre: nombre, activo: activo, foto: fotoUrl || null };
                var err;
                if (id) {
                    var r1 = await window.supabaseClient.from('mesoneros').update(dataObj).eq('id', id);
                    err = r1.error;
                } else {
                    dataObj.id = window.generarId('mes_');
                    var r2 = await window.supabaseClient.from('mesoneros').insert([dataObj]);
                    err = r2.error;
                }
                if (err) throw err;
                window.cerrarModal('mesoneroModal');
                await window.cargarMesoneros();
                window.mostrarToast('Mesonero guardado', 'success');
            } catch(e) { window.mostrarToast('Error: '+e.message,'error'); }
            finally { this.disabled=false; this.innerHTML='Guardar'; }
        });
    }

    var closeBtn = document.getElementById('closeMesoneroModal');
    if (closeBtn) closeBtn.addEventListener('click', function(){ window.cerrarModal('mesoneroModal'); });
    var cancelBtn = document.getElementById('cancelMesoneroEdit');
    if (cancelBtn) cancelBtn.addEventListener('click', function(){ window.cerrarModal('mesoneroModal'); });
    var fotoInput = document.getElementById('mesoneroFoto');
    if (fotoInput) fotoInput.addEventListener('change', handleMesoneroFotoFile);
    var fotoUrlInp = document.getElementById('mesoneroFotoUrl');
    if (fotoUrlInp) fotoUrlInp.addEventListener('input', handleMesoneroFotoUrl);
    var removeBtn = document.getElementById('mesoneroFotoRemoveBtn');
    if (removeBtn) removeBtn.addEventListener('click', removeMesoneroFoto);

    // Inicializar al cargar el módulo
    if (window.supabaseClient) {
        window.cargarMesoneros();
    }
})();
