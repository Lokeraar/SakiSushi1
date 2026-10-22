// admin-realtime.js - Suscripciones realtime y push
(function() {
    window.setupRealtimeSubscriptions = function() {
        try {
            window.supabaseClient
                .channel('admin-menu')
                .on('postgres_changes', { event: '*', schema: 'public', table: 'menu' },
                    () => { window.cargarMenu(); })
                .subscribe();

            window.supabaseClient
                .channel('admin-inventario')
                .on('postgres_changes', { event: '*', schema: 'public', table: 'inventario' },
                    async (p) => {
                        if (p.eventType === 'UPDATE' && p.new.stock <= p.new.minimo) {
                            window.verificarStockCritico();
                            window.mostrarToast(`⚠️ Stock crítico: ${p.new.nombre}`, 'warning');
                            window._notificarAdminStockCritico && window._notificarAdminStockCritico(p.new.nombre);
                        }
                        if (p.eventType === 'UPDATE' && (p.old?.stock || 0) <= 0 && p.new.stock > 0) {
                            await window.cargarInventario();
                        }
                        window.cargarInventario();
                        window.actualizarStockCriticoHeader();
                    })
                .subscribe();

            window.supabaseClient
                .channel('admin-usuarios')
                .on('postgres_changes', { event: '*', schema: 'public', table: 'usuarios' },
                    () => { window.cargarUsuarios(); })
                .subscribe();

            window.supabaseClient
                .channel('admin-qr')
                .on('postgres_changes', { event: '*', schema: 'public', table: 'codigos_qr' },
                    () => { window.cargarQRs(); })
                .subscribe();

            window.supabaseClient
                .channel('admin-pedidos')
                .on('postgres_changes', { event: '*', schema: 'public', table: 'pedidos' },
                    () => {
                        window.cargarPedidosRecientes();
                        const rPane = document.getElementById('reportesPane');
                        if (rPane && rPane.classList.contains('active')) window.cargarReportes();
                    })
                .subscribe();

            window.supabaseClient
                .channel('admin-mesoneros')
                .on('postgres_changes', { event: '*', schema: 'public', table: 'mesoneros' },
                    () => { window.cargarMesoneros(); })
                .subscribe();

            window.supabaseClient
                .channel('admin-deliverys')
                .on('postgres_changes', { event: '*', schema: 'public', table: 'deliverys' },
                    () => { window.cargarDeliverys(); })
                .subscribe();

            window.supabaseClient
                .channel('admin-propinas')
                .on('postgres_changes', { event: '*', schema: 'public', table: 'propinas' },
                    () => { window.cargarPropinas(); })
                .subscribe();

            window.supabaseClient
                .channel('admin-config')
                .on('postgres_changes', { event: 'UPDATE', schema: 'public', table: 'config' },
                    (p) => {
                        window.configGlobal = { ...window.configGlobal, ...p.new };
                        const bi = document.getElementById('tasaBaseInput');
                        if (bi && p.new.tasa_cambio) bi.value = parseFloat(p.new.tasa_cambio).toFixed(2);
                        // Actualizar tasa efectiva desde la BD si viene en el payload
                        if (p.new.tasa_efectiva !== undefined) {
                            window.configGlobal.tasa_efectiva = parseFloat(p.new.tasa_efectiva);
                            const ted = document.getElementById('tasaEfectivaDisplay');
                            if (ted) ted.textContent = window.configGlobal.tasa_efectiva.toFixed(2);
                            const tec = document.getElementById('tasaEfectivaCard');
                            if (tec) tec.textContent = 'Bs. ' + window.configGlobal.tasa_efectiva.toFixed(2);
                            // Recalcular platillo estrella con nueva tasa
                            if (window.platillosTop5 && window.platillosTop5.length > 0) {
                                window.cargarTopVentasCliente();
                            }
                        } else {
                            window.recalcularTasaEfectiva && window.recalcularTasaEfectiva();
                        }
                        window.mostrarToast('💱 Tasa actualizada desde cajero: Bs ' + parseFloat(p.new.tasa_cambio||0).toFixed(2), 'info');
                    })
                .subscribe();

            window.supabaseClient
                .channel('admin-platillo-estrella')
                .on('postgres_changes', { event: '*', schema: 'public', table: 'vista_platillo_estrella' },
                    () => { window.cargarTopVentasCliente(); })
                .subscribe();

            // Escuchar cambios en la tabla menu para actualizar platillo estrella en tiempo real
            // Esto asegura que si cambia la imagen de un platillo en menu, se refleje inmediatamente
            window.supabaseClient
                .channel('admin-menu-platillo-estrella')
                .on('postgres_changes', { event: '*', schema: 'public', table: 'menu' },
                    () => { 
                        // Pequeño delay para asegurar que la vista se haya actualizado
                        setTimeout(() => { window.cargarTopVentasCliente(); }, 500);
                    })
                .subscribe();

        } catch (e) { console.error('Error configurando suscripciones realtime:', e); }
    };

    window._notificarAdminStockCritico = async function(ingredienteNombre) {
        try {
            const { data: subs } = await window.supabaseClient
                .from('push_subscriptions')
                .select('session_id')
                .in('rol', ['admin', 'cajero']);
            if (!subs || !subs.length) return;
            const sessions = [...new Set(subs.map(s => s.session_id).filter(Boolean))];
            for (const sid of sessions) {
                await window.supabaseClient.from('notificaciones').insert([{
                    pedido_id: null, tipo: 'stock_critico',
                    titulo: '⚠️ Stock crítico',
                    mensaje: `El ingrediente "${ingredienteNombre}" está por debajo del mínimo. Revisa el inventario.`,
                    session_id: sid, leida: false
                }]);
            }
            window.mostrarToast(`🔔 Alerta enviada: stock crítico en ${ingredienteNombre}`, 'warning');
        } catch (e) { console.error('Error notificando stock crítico:', e); }
    };

    window._registrarPushAdmin = async function() {
        if (!('Notification' in window) || !('serviceWorker' in navigator)) return;
        if (location.protocol !== 'https:' && location.hostname !== 'localhost') return;
        if (Notification.permission === 'denied') return;

        let sid = localStorage.getItem('saki_admin_session_id');
        if (!sid) {
            sid = 'admin_' + Date.now() + '_' + Math.random().toString(36).slice(2, 9);
            localStorage.setItem('saki_admin_session_id', sid);
        }

        const _registrar = async () => {
            try {
                const reg  = await navigator.serviceWorker.register('/sw.js', { scope: '/' });
                await navigator.serviceWorker.ready;
                let sub = await reg.pushManager.getSubscription();
                if (!sub) {
                    const vapid = 'BC6oJ4E+5pGIn4icpzCBLMi6/nk+1JJenrUA41uJrAs1ELraSw5ctvRAlh8sHVldqzBXUtEwEeFKBm0/hmuM9EY=';
                    const key   = (function(b64) {
                        const pad = '='.repeat((4 - b64.length % 4) % 4);
                        const raw = atob((b64 + pad).replace(/-/g, '+').replace(/_/g, '/'));
                        const arr = new Uint8Array(raw.length);
                        for (let i = 0; i < raw.length; i++) arr[i] = raw.charCodeAt(i);
                        return arr;
                    })(vapid);
                    sub = await reg.pushManager.subscribe({ userVisibleOnly: true, applicationServerKey: key });
                }
                const p256dh = btoa(String.fromCharCode.apply(null, new Uint8Array(sub.getKey('p256dh'))));
                const auth   = btoa(String.fromCharCode.apply(null, new Uint8Array(sub.getKey('auth'))));
                await window.supabaseClient.from('push_subscriptions').upsert([{
                    session_id: sid,
                    endpoint:   sub.endpoint,
                    p256dh, auth,
                    rol: 'admin',
                    user_agent: navigator.userAgent
                }], { onConflict: 'endpoint' });
                console.log('📢 Push admin registrado:', sid);
            } catch (e) { console.warn('⚠️ Push admin no disponible:', e.message); }
        };

        if (Notification.permission === 'granted') {
            await _registrar();
        } else {
            setTimeout(async () => {
                const perm = await Notification.requestPermission();
                if (perm === 'granted') await _registrar();
            }, 3000);
        }
    };
})();
