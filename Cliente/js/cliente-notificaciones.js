// cliente-notificaciones.js - Push notifications, Realtime, sounds, badges
(function() {
    window.Saki = window.Saki || {};
    window.Saki.modules = window.Saki.modules || {};
    window.Saki.modules.notificaciones = {};
    var S = window.Saki;

    var _realtimeChannel = null;
    var notisNoLeidas = 0;
    var notisCache = [];
    var notisCompletas = [];
    var _audioDesbloqueado = false;

    function urlBase64ToUint8Array(base64String) {
        var padding = '='.repeat((4 - base64String.length % 4) % 4);
        var base64 = (base64String + padding).replace(/\-/g, '+').replace(/_/g, '/');
        var rawData = window.atob(base64);
        var output = new Uint8Array(rawData.length);
        for (var i = 0; i < rawData.length; ++i) {
            output[i] = rawData.charCodeAt(i);
        }
        return output;
    }
    window.urlBase64ToUint8Array = urlBase64ToUint8Array;
    S.modules.notificaciones.urlBase64ToUint8Array = urlBase64ToUint8Array;

    function solicitarPermisoPushAuto() {
        if (!('Notification' in window)) return;
        if (Notification.permission === 'granted') {
            if ('serviceWorker' in navigator && 'SyncManager' in window) {
                navigator.serviceWorker.ready.then(function(reg) {
                    reg.pushManager.subscribe({
                        userVisibleOnly: true,
                        applicationServerKey: urlBase64ToUint8Array('BHRvBz9vUsBOfNF7KGb14R7WjfaBoFy7rG8RYUuRs4IYQcKCJ-3H7iVQOmL1gstnHIClAC_5PR1J2GuxyBj2BqI')
                    }).catch(function() {});
                });
            }
        }
    }
    window.solicitarPermisoPushAuto = solicitarPermisoPushAuto;
    S.modules.notificaciones.solicitarPermisoPushAuto = solicitarPermisoPushAuto;

    function mostrarToastNotificacion(titulo, mensaje) {
        if (window.mostrarToast) {
            window.mostrarToast(titulo + ': ' + mensaje, 'info');
        }
    }
    S.modules.notificaciones.mostrarToastNotificacion = mostrarToastNotificacion;

    function reproducirSonidoNotificacion() {
        try {
            var audio = document.getElementById('notificationSound');
            if (audio) {
                audio.currentTime = 0;
                var playPromise = audio.play();
                if (playPromise && playPromise.catch) {
                    playPromise.catch(function() {});
                }
            }
            if (navigator.vibrate) navigator.vibrate(200);
        } catch(e) {}
    }
    window.reproducirSonidoNotificacion = reproducirSonidoNotificacion;
    S.modules.notificaciones.reproducirSonidoNotificacion = reproducirSonidoNotificacion;

    function actualizarNotificacionesUI() {
        var badge = document.getElementById('notificationBadge');
        var panel = document.getElementById('notificationsPanel');
        if (!panel) return;

        var lista = panel.querySelector('.notifications-list');
        if (!lista) return;

        if (notisNoLeidas > 0) {
            if (badge) {
                badge.textContent = notisNoLeidas;
                badge.style.display = 'inline';
                badge.classList.add('pop');
                setTimeout(function() { badge.classList.remove('pop'); }, 300);
            }
        } else {
            if (badge) badge.style.display = 'none';
        }

        if (notisCompletas.length === 0) {
            lista.innerHTML = '<div class="loading-container" style="padding:1rem;color:var(--gray-400)"><p style="font-size:.9rem">No hay notificaciones</p></div>';
            return;
        }

        var html = '';
        var mostrar = notisCompletas.slice(0, 20);
        mostrar.forEach(function(notif) {
            var estado = notif.estado || 'pending';
            var estadoInfo = S.state.mensajesEstado ? S.state.mensajesEstado[estado] : null;
            if (!estadoInfo) estadoInfo = { titulo: '⏳ Pedido ' + estado, icono: 'clock' };
            var fecha = notif.fecha ? new Date(notif.fecha + 'Z') : new Date();
            var hora = fecha.toLocaleString('es-VE', { hour: '2-digit', minute: '2-digit' });
            var leida = notif.leida ? '' : ' unread';
            html += '<div class="notification-item' + leida + ' ' + estado + '" data-id="' + (notif.id || '') + '">' +
                '<div class="notification-title"><i class="fas fa-' + estadoInfo.icono + '"></i> ' + estadoInfo.titulo + '</div>' +
                '<div class="notification-message">' + (notif.mensaje || '') + '</div>' +
                '<div class="notification-time"><i class="far fa-clock"></i> ' + hora + '</div></div>';
        });
        lista.innerHTML = html;

        // Click handler for individual notifications
        lista.querySelectorAll('.notification-item').forEach(function(item) {
            item.addEventListener('click', function() {
                var id = this.dataset.id;
                if (id && window.marcarNotificacionLeida) window.marcarNotificacionLeida(id);
            });
        });
    }
    window.actualizarNotificacionesUI = actualizarNotificacionesUI;
    S.modules.notificaciones.actualizarNotificacionesUI = actualizarNotificacionesUI;

    function recargarNotificacionesCompletas() {
        if (!window.supabaseClient) return;
        window.supabaseClient
            .from('notificaciones')
            .select('*')
            .order('fecha', { ascending: false })
            .limit(50)
            .then(function(resp) {
                if (resp.error) return;
                var datos = resp.data || [];
                if (datos.length === 0) return;
                datos.sort(function(a, b) {
                    return new Date(b.fecha + 'Z') - new Date(a.fecha + 'Z');
                });
                notisCompletas = datos;
                notisNoLeidas = datos.filter(function(n) { return !n.leida; }).length;
                actualizarNotificacionesUI();
            });
    }
    window.recargarNotificacionesCompletas = recargarNotificacionesCompletas;
    S.modules.notificaciones.recargarNotificacionesCompletas = recargarNotificacionesCompletas;

    function marcarTodasComoLeidas() {
        if (!window.supabaseClient) return;
        var ids = notisCompletas.filter(function(n) { return !n.leida; }).map(function(n) { return n.id; });
        if (ids.length === 0) return;
        window.supabaseClient
            .from('notificaciones')
            .update({ leida: true })
            .in('id', ids)
            .then(function() {
                notisCompletas.forEach(function(n) { n.leida = true; });
                notisNoLeidas = 0;
                actualizarNotificacionesUI();
            });
    }
    window.marcarTodasComoLeidas = marcarTodasComoLeidas;
    S.modules.notificaciones.marcarTodasComoLeidas = marcarTodasComoLeidas;

    function marcarNotificacionLeida(id) {
        if (!window.supabaseClient) return;
        window.supabaseClient
            .from('notificaciones')
            .update({ leida: true })
            .eq('id', id)
            .then(function() {
                var notif = notisCompletas.find(function(n) { return n.id == id; });
                if (notif) {
                    notif.leida = true;
                    notisNoLeidas = Math.max(0, notisNoLeidas - 1);
                    actualizarNotificacionesUI();
                }
            });
    }
    window.marcarNotificacionLeida = marcarNotificacionLeida;
    S.modules.notificaciones.marcarNotificacionLeida = marcarNotificacionLeida;

    function toggleNotifications() {
        var panel = document.getElementById('notificationsPanel');
        if (!panel) return;
        panel.classList.toggle('active');
        if (panel.classList.contains('active')) {
            marcarTodasComoLeidas();
        }
    }
    window.toggleNotifications = toggleNotifications;
    S.modules.notificaciones.toggleNotifications = toggleNotifications;

    function verificarPermisosAudio() {
        if (_audioDesbloqueado) return;
        var audio = document.getElementById('notificationSound');
        if (audio) {
            audio.load();
            _audioDesbloqueado = true;
        }
    }
    window.verificarPermisosAudio = verificarPermisosAudio;
    S.modules.notificaciones.verificarPermisosAudio = verificarPermisosAudio;

    function iniciarVerificacionPeriodica() {
        if (!window.supabaseClient) return;

        // Realtime channel — SIEMPRE activo (incluso en background)
        // Se suscribe a cambios en la tabla notificaciones
        try {
            _realtimeChannel = window.supabaseClient
                .channel('notificaciones-cliente')
                .on('postgres_changes',
                    { event: 'INSERT', schema: 'public', table: 'notificaciones' },
                    function(payload) {
                        var nueva = payload.new;
                        if (nueva) {
                            notisCompletas.unshift(nueva);
                            notisNoLeidas++;
                            actualizarNotificacionesUI();
                            reproducirSonidoNotificacion();
                            // Actualizar badge del título
                            if (nueva.estado === 'approved' || nueva.estado === 'rejected') {
                                mostrarToastNotificacion(
                                    nueva.estado === 'approved' ? '✅ Pedido aprobado' : '❌ Pedido rechazado',
                                    nueva.mensaje || ''
                                );
                            }
                        }
                    }
                )
                .subscribe();
        } catch(e) {
            // Fallback: si Realtime falla, usar polling como respaldo
            setInterval(function() {
                if (!S.state.paginaVisible) return;
                recargarNotificacionesCompletas();
            }, 30000);
        }
    }
    window.iniciarVerificacionPeriodica = iniciarVerificacionPeriodica;
    S.modules.notificaciones.iniciarVerificacionPeriodica = iniciarVerificacionPeriodica;

    function cerrarCanalRealtime() {
        if (_realtimeChannel && window.supabaseClient) {
            try {
                window.supabaseClient.removeChannel(_realtimeChannel);
            } catch(e) {}
            _realtimeChannel = null;
        }
    }
    S.modules.notificaciones.cerrarCanalRealtime = cerrarCanalRealtime;
})();
