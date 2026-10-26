// admin-config.js - Configuración de tasa de cambio y parámetros globales
(function() {
    window.cargarConfiguracion = async function() {
        try {
            // Verificar que haya token JWT antes de hacer la consulta
            if (!window.jwtToken) {
                console.warn('⚠️ No hay token JWT, usando configuración por defecto');
                return;
            }
            
            const { data, error } = await window.supabaseClient
                .from('config')
                .select('*')
                .eq('id', 1)
                .single();
            
            // Si hay error 401, no lanzar excepción, usar valores por defecto
            if (error) {
                if (error.status === 401 || error.code === 'PGRST301') {
                    console.warn('⚠️ Token expirado o sin permisos para cargar configuración');
                    return;
                }
                throw error;
            }
            
            window.configGlobal = data || {};
            
            window.configGlobal.tasa_cambio = window.configGlobal.tasa_cambio || 400;
            window.configGlobal.tasa_efectiva = window.configGlobal.tasa_efectiva || 400;
            window.configGlobal.aumento_diario = window.configGlobal.aumento_diario || 0;
            window.configGlobal.aumento_activo = window.configGlobal.aumento_activo || false;
            window.configGlobal.aumento_semanal = window.configGlobal.aumento_semanal || false;
            
        } catch (e) {
            // No mostrar error en consola si es un error 401 o de JWT (ya se manejó arriba)
            if (!(e.status === 401 || e.code === 'PGRST301' || (e.message && e.message.includes('JWT')))) {
                console.error('Error cargando configuración:', e);
            }
            window.configGlobal = {
                tasa_cambio: 400,
                tasa_efectiva: 400,
                aumento_diario: 0,
                aumento_activo: false,
                aumento_semanal: false
            };
        }
    };

    // Helpers para mostrar el botón como "ya configurado" sin ocultarlo
    function botonSutil(btn) {
        btn.style.opacity = '0.5';
        btn.style.pointerEvents = '';
    }
    function botonNormal(btn) {
        btn.style.opacity = '';
        btn.style.pointerEvents = '';
    }

    window._actualizarVisibilidadBotonBCV = function() {
        const btn = document.getElementById('btnObtenerTasaBCV');
        if (!btn) return;
        const fechaHoy = new Date().toLocaleDateString('en-CA', { timeZone: 'America/Caracas' });
        const ultimaAct = window.configGlobal?.ultima_actualizacion;
        const fechaUltima = ultimaAct ? new Date(ultimaAct).toLocaleDateString('en-CA', { timeZone: 'America/Caracas' }) : null;
        if (fechaUltima === fechaHoy) {
            botonSutil(btn);
            btn.title = 'Ya configurada hoy — click para re-consultar';
            let indicator = document.getElementById('tasaHoyIndicator');
            if (!indicator) {
                indicator = document.createElement('span');
                indicator.id = 'tasaHoyIndicator';
                indicator.style.cssText = 'color:#4CAF50;font-size:.75rem;font-weight:600;margin-left:8px';
                btn.parentNode.appendChild(indicator);
            }
            indicator.textContent = '✅ Tasa configurada hoy';
            indicator.style.display = 'inline';
        } else {
            botonNormal(btn);
            btn.title = 'Obtener tasa del BCV automáticamente';
            const indicator = document.getElementById('tasaHoyIndicator');
            if (indicator) indicator.style.display = 'none';
        }
    };

    window.cargarConfiguracionInicial = async function() {
        await window.cargarConfiguracion();
        window.actualizarTasaUI();
        window.recalcularTasaEfectiva();
        window.actualizarMenuTasaBanner();
        window._actualizarVisibilidadBotonBCV();
    };

    window.actualizarTasaUI = function() {
        document.getElementById('tasaBaseInput').value      = window.configGlobal.tasa_cambio || 400;
        document.getElementById('aumentoDiarioInput').value = window.configGlobal.aumento_diario || 0;
        document.getElementById('aumentoActivoToggle').checked = window.configGlobal.aumento_activo || false;
        const semEl = document.getElementById('aumentoSemanalToggle');
        if (semEl) semEl.checked = window.configGlobal.aumento_semanal || false;
        document.getElementById('tasaEfectivaDisplay').textContent = (window.configGlobal.tasa_efectiva || 400).toFixed(2);

        // Interruptor de descuento al quitar ingredientes. Si la columna no
        // llegó (versión vieja), se muestra encendido: es el comportamiento
        // histórico y el menos sorpresivo.
        var chkDescuento = document.getElementById('descuentoAlQuitar');
        if (chkDescuento) {
            chkDescuento.checked = window.configGlobal.descuento_al_quitar !== false;
        }
        document.getElementById('aumentoAcumuladoDisplay').textContent = (window.configGlobal.aumento_acumulado || 0).toFixed(2) + '%';
        if (window.configGlobal.aumento_desde && document.getElementById('aumentoDesde'))
            document.getElementById('aumentoDesde').value = window.configGlobal.aumento_desde.split('T')[0];
        if (window.configGlobal.aumento_hasta && document.getElementById('aumentoHasta'))
            document.getElementById('aumentoHasta').value = window.configGlobal.aumento_hasta.split('T')[0];
        if (window.configGlobal.aumento_indefinido && document.getElementById('aumentoIndefinido'))
            document.getElementById('aumentoIndefinido').checked = true;
        // Mostrar fechas card si hay aumento activo (diario o semanal) O si está marcado indefinido
        const algunAumentoActivo = (window.configGlobal.aumento_activo || window.configGlobal.aumento_semanal || window.configGlobal.aumento_indefinido);
        document.getElementById('tasaFechasDiv').style.display = algunAumentoActivo ? 'flex' : 'none';
        if (typeof _actualizarLabelAumento === 'function') _actualizarLabelAumento();
    };

    window.actualizarMenuTasaBanner = window.actualizarTasaUI;

    window.recalcularTasaEfectiva = function() {
        const tasaBaseInput = document.getElementById('tasaBaseInput');
        if (tasaBaseInput && window.configGlobal) {
            window.configGlobal.tasa_cambio = parseFloat(tasaBaseInput.value) || 0;
        }
        const tasaBase     = parseFloat(document.getElementById('tasaBaseInput').value) || 0;
        const aumentoPct   = parseFloat(document.getElementById('aumentoDiarioInput').value) || 0;
        const activoDiario  = document.getElementById('aumentoActivoToggle').checked;
        const activoSemanal = document.getElementById('aumentoSemanalToggle') &&
                              document.getElementById('aumentoSemanalToggle').checked;
        const estaActivo   = activoDiario || activoSemanal;
        const indefinido   = document.getElementById('aumentoIndefinido') &&
                             document.getElementById('aumentoIndefinido').checked;
        const desdeVal     = document.getElementById('aumentoDesde')?.value || '';
        const hastaVal     = !indefinido ? (document.getElementById('aumentoHasta')?.value || '') : '';

        let periodos = 0;

        if (estaActivo && desdeVal) {
            const hoy        = new Date(); hoy.setHours(0,0,0,0);
            const desdeDate  = new Date(desdeVal + 'T00:00:00');
            const hastaDate  = hastaVal ? new Date(hastaVal + 'T00:00:00') : null;

            if (desdeDate <= hoy) {
                const finEfectivo = hastaDate && hastaDate < hoy ? hastaDate : hoy;
                const msDay      = 24 * 60 * 60 * 1000;
                const msPeriodo  = activoSemanal ? 7 * msDay : msDay;
                const diffMs     = finEfectivo - desdeDate;
                periodos = Math.max(0, Math.floor(diffMs / msPeriodo) + 1);
            }
        }

        const aumentoAcumulado = periodos * aumentoPct;
        const tasaEfectiva     = tasaBase * (1 + aumentoAcumulado / 100);

        console.group('%c🔄 Saki Sushi — Cálculo de Tasa', 'color:#FF9800;font-weight:700');
        console.log('Modo activo:', estaActivo ? (activoSemanal ? 'SEMANAL' : 'DIARIO') : 'DESACTIVADO');
        console.log('Fecha inicio (Desde):', desdeVal || '—');
        console.log('Fecha fin   (Hasta): ', hastaVal || (indefinido ? 'Indefinido' : '—'));
        if (estaActivo && desdeVal) {
            const _hoyLog = new Date(); _hoyLog.setHours(0,0,0,0);
            const _desdeLog = new Date(desdeVal + 'T00:00:00');
            const _msD = 24*60*60*1000;
            const _mpLog = activoSemanal ? 7*_msD : _msD;
            const _diffDias = Math.floor((_hoyLog - _desdeLog) / _msD);
            console.log('Días transcurridos desde "Desde":', _diffDias);
            console.log('Períodos ' + (activoSemanal ? 'semanales' : 'diarios') + ' completados:', periodos);
        }
        console.log('Porcentaje por período:', aumentoPct + '%');
        console.log('Períodos aplicados:', periodos);
        console.log('Acumulado total:', aumentoAcumulado.toFixed(2) + '%');
        console.log('Tasa Base:', tasaBase);
        console.log('Tasa Efectiva 💵 Bs', tasaEfectiva.toFixed(2));
        console.groupEnd();

        document.getElementById('tasaEfectivaDisplay').textContent = tasaEfectiva.toFixed(2);
        document.getElementById('aumentoAcumuladoDisplay').textContent = aumentoAcumulado.toFixed(2) + '%';
        if (document.getElementById('tasaEfectivaCard'))
            document.getElementById('tasaEfectivaCard').textContent = 'Bs. ' + tasaEfectiva.toFixed(2);

        window.configGlobal.tasa_cambio       = tasaBase;
        window.configGlobal.aumento_diario    = aumentoPct;
        window.configGlobal.aumento_activo    = activoDiario;
        window.configGlobal.aumento_semanal   = activoSemanal;
        window.configGlobal.aumento_acumulado = aumentoAcumulado;
        window.configGlobal.tasa_efectiva     = tasaEfectiva;
    };

    window.guardarConfiguracion = async function() {
        try {
            const tasaBase = parseFloat(document.getElementById('tasaBaseInput').value) || 0;
            const aumentoPct = parseFloat(document.getElementById('aumentoDiarioInput').value) || 0;
            const activoDiario = document.getElementById('aumentoActivoToggle').checked;
            const activoSemanal = document.getElementById('aumentoSemanalToggle')?.checked || false;
            const indefinido = document.getElementById('aumentoIndefinido')?.checked || false;

            // ── Guardas antes de escribir ──
            // Este es el único punto donde el aumento entra a la base, así que
            // es donde tiene que doler si el valor no tiene sentido. Un dedazo
            // acá descuadra TODOS los precios del restaurante.
            if (!(tasaBase > 0)) {
                window.mostrarToast('❌ La tasa base debe ser mayor que 0', 'error');
                return;
            }
            if (aumentoPct < 0) {
                window.mostrarToast('❌ El aumento no puede ser negativo', 'error');
                return;
            }
            if (aumentoPct > 100) {
                window.mostrarToast('❌ Un aumento de ' + aumentoPct + '% por periodo es imposible. Revisá el valor.', 'error');
                return;
            }
            // Aviso, no bloqueo: un aumento alto puede ser legítimo en una
            // emergencia cambiaria, pero el admin tiene que confirmarlo sabiendo.
            if (aumentoPct > 5) {
                const sigue = confirm(
                    'Vas a guardar un aumento de ' + aumentoPct + '% por periodo.\n\n' +
                    'Para referencia, el ajuste pensado para compensar inflación es del orden de 0.01%.\n\n' +
                    '¿Confirmás que es intencional?'
                );
                if (!sigue) return;
            }

            window.configGlobal.tasa_cambio = tasaBase;
            window.configGlobal.aumento_diario = aumentoPct;
            window.configGlobal.aumento_activo = activoDiario;
            window.configGlobal.aumento_semanal = activoSemanal;
            
            window.recalcularTasaEfectiva();
            
            await window.supabaseClient.from('config').update({
                tasa_cambio:       window.configGlobal.tasa_cambio,
                aumento_diario:    window.configGlobal.aumento_diario,
                aumento_activo:    window.configGlobal.aumento_activo,
                aumento_semanal:   window.configGlobal.aumento_semanal || false,
                aumento_detenido:  window.configGlobal.aumento_detenido,
                aumento_acumulado: window.configGlobal.aumento_acumulado,
                tasa_efectiva:     window.configGlobal.tasa_efectiva,
                aumento_desde:     (document.getElementById('aumentoDesde') && document.getElementById('aumentoDesde').value) || null,
                aumento_hasta:     (!document.getElementById('aumentoIndefinido')?.checked && document.getElementById('aumentoHasta')?.value) || null,
                aumento_indefinido: document.getElementById('aumentoIndefinido')?.checked || false,
                // Decisión de negocio: ¿quitar un ingrediente abarata el plato?
                descuento_al_quitar: document.getElementById('descuentoAlQuitar')?.checked ?? true,
                ultima_actualizacion: new Date().toISOString()
            }).eq('id', 1);
            
            window.renderizarMenu(document.getElementById('menuBuscador')?.value || '');
            await window._actualizarVentasHoyNeto();
            await window._actualizarDeliverysHoy();
            
            window.configGlobal.descuento_al_quitar =
                document.getElementById('descuentoAlQuitar')?.checked ?? true;

            const tasaDisplay = document.getElementById('tasaEfectivaDisplay');
            if (tasaDisplay) {
                tasaDisplay.textContent = (window.configGlobal.tasa_efectiva || 0).toFixed(2);
            }
            
            window.mostrarToast(`💱 Configuración guardada. Nueva tasa efectiva: Bs ${(window.configGlobal.tasa_efectiva || 0).toFixed(2)} por USD`, 'success');
            
        } catch (e) { 
            console.error('Error guardando configuración:', e); 
            window.mostrarToast('❌ Error al guardar la configuración', 'error'); 
        }
    };

    // ── Botón "Obtener del BCV" ──
    window.obtenerTasaBCV = async function() {
        const btn = document.getElementById('btnObtenerTasaBCV');
        if (btn) { btn.disabled = true; btn.innerHTML = '<i class="fas fa-spinner fa-spin"></i> Consultando...'; }

        try {
            // Se lee de la base, que sí guarda la FECHA VALOR de la captura.
            // Antes esto llamaba a una Edge Function que devolvía un número
            // pelado: no sabía si era la tasa de hoy o la del martes que
            // todavía no rige. Ese programa se retiró (ver memoria
            // `saki-sushi1/edge-function-duplicada`).
            const detalle = await window.obtenerTasaBCVDetalle({ forzar: true });

            if (!detalle || !(detalle.valor > 0)) {
                window.mostrarToast('❌ No hay ninguna tasa del BCV capturada todavía', 'error');
                return;
            }

            // Mostrar modal de confirmación
            const tasaEncontrada = detalle.valor;
            const fechaValor = detalle.fecha_valor
                ? new Date(detalle.fecha_valor + 'T12:00:00').toLocaleDateString('es-VE', {
                      weekday: 'long', day: '2-digit', month: '2-digit'
                  })
                : 'sin fecha valor';

            // Si la captura tiene días, se dice. La fecha valor es el dato que
            // distingue una tasa vigente de una que todavía no rige.
            const antiguedad = (detalle.dias_atras !== null && detalle.dias_atras !== undefined)
                ? (detalle.dias_atras === 0 ? 'de hoy'
                   : detalle.dias_atras === 1 ? 'de ayer'
                   : 'hace ' + detalle.dias_atras + ' días')
                : '';

            // Crear modal overlay
            const overlay = document.createElement('div');
            overlay.className = 'modal-overlay';
            overlay.style.cssText = 'position:fixed;inset:0;z-index:10000;display:flex;align-items:center;justify-content:center;background:rgba(0,0,0,.6);padding:1rem';

            const modal = document.createElement('div');
            modal.style.cssText = 'background:linear-gradient(135deg,#1a1a2e,#16213e);border:1px solid rgba(255,255,255,.12);border-radius:16px;padding:1.5rem;max-width:420px;width:100%;text-align:center;box-shadow:0 8px 32px rgba(0,0,0,.5)';

            modal.innerHTML = `
                <div style="font-size:2rem;margin-bottom:.75rem">📡</div>
                <h3 style="color:#FF9800;margin:0 0 .3rem">Tasa BCV</h3>
                <p style="color:rgba(255,255,255,.6);font-size:.85rem;margin:0 0 .3rem">Fecha valor: ${fechaValor}</p>
                <p style="color:rgba(255,255,255,.45);font-size:.78rem;margin:0 0 1rem">${antiguedad}${detalle.fuente ? ' · ' + detalle.fuente : ''}</p>
                <div style="font-size:2.5rem;font-weight:800;color:#fff;margin-bottom:1.5rem">
                    Bs ${tasaEncontrada.toFixed(2)}
                </div>
                <div style="display:flex;gap:.8rem;flex-wrap:wrap">
                    <button id="modalUsarTasa" style="flex:1;padding:.75rem;border:none;border-radius:10px;background:linear-gradient(135deg,#D32F2F,#b71c1c);color:#fff;font-weight:700;font-size:.95rem;cursor:pointer">
                        ✅ Usar esta tasa
                    </button>
                    <button id="modalModificarTasa" style="flex:1;padding:.75rem;border:none;border-radius:10px;background:rgba(255,255,255,.1);color:#fff;font-weight:600;font-size:.95rem;cursor:pointer">
                        ✏️ Modificar
                    </button>
                    <button id="modalCancelarTasa" style="flex:1;padding:.75rem;border:none;border-radius:10px;background:transparent;color:rgba(255,255,255,.5);font-size:.85rem;cursor:pointer">
                        Cancelar
                    </button>
                </div>
            `;

            overlay.appendChild(modal);
            document.body.appendChild(overlay);

            // Eventos del modal
            document.getElementById('modalUsarTasa').onclick = async () => {
                document.getElementById('tasaBaseInput').value = tasaEncontrada.toFixed(2);
                window.configGlobal.tasa_cambio = tasaEncontrada;
                window.recalcularTasaEfectiva();
                await window.guardarConfiguracion();
                overlay.remove();
                window._actualizarVisibilidadBotonBCV();
                window.mostrarToast('✅ Tasa BCV aplicada: Bs ' + tasaEncontrada.toFixed(2), 'success');
            };

            document.getElementById('modalModificarTasa').onclick = () => {
                document.getElementById('tasaBaseInput').value = tasaEncontrada.toFixed(2);
                window.configGlobal.tasa_cambio = tasaEncontrada;
                window.recalcularTasaEfectiva();
                overlay.remove();
                document.getElementById('tasaBaseInput').focus();
                document.getElementById('tasaBaseInput').select();
                window.mostrarToast('📝 Tasa del BCV cargada. Podés ajustar el valor antes de guardar.', 'info');
            };

            document.getElementById('modalCancelarTasa').onclick = () => {
                overlay.remove();
            };

            // Cerrar con click fuera
            overlay.onclick = (e) => { if (e.target === overlay) overlay.remove(); };

        } catch (e) {
            console.error('Error obteniendo tasa BCV:', e);
            window.mostrarToast('❌ Error de conexión al consultar BCV', 'error');
        } finally {
            if (btn) { btn.disabled = false; btn.innerHTML = '<i class="fas fa-satellite-dish"></i> Obtener del BCV'; }
        }
    };

    // Agregar el botón "Obtener del BCV" al lado del botón Guardar
    (function _agregarBotonBCV() {
        const saveWrap = document.querySelector('.tcb-save-wrap');
        if (!saveWrap) return;
        const btn = document.createElement('button');
        btn.id = 'btnObtenerTasaBCV';
        btn.className = 'btn-secondary tcb-save-btn';
        btn.style.marginLeft = '8px';
        btn.innerHTML = '<i class="fas fa-satellite-dish"></i> Obtener del BCV';
        btn.onclick = window.obtenerTasaBCV;
        saveWrap.appendChild(btn);
    })();
})();
