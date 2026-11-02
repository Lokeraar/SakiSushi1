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

    // ── Identidad del visitante ──
    //
    // El identificador ya NO se inventa acá. Antes era
    // `cli-<fecha en base36>-<8 de Math.random()>`, con dos problemas:
    // `Math.random()` no es criptográfico, y 8 caracteres son unos 41 bits,
    // algo que una computadora puede recorrer. Además ese valor se usaba tal
    // cual, sin que el servidor pudiera comprobar que era de quien decía.
    //
    // Ahora lo emite la base con 128 bits reales y lo devuelve FIRMADO. Todo
    // el manejo vive en cliente-identidad.js.
    function fichaDeCliente() {
        if (!window.SakiCliente) return Promise.resolve(null);
        return window.SakiCliente.obtenerFicha();
    }

    // Clave pública VAPID. Tiene que ser exactamente la pareja de la privada
    // que usa la edge function `send-push`, y en base64url SIN relleno.
    //
    // Antes acá había otra clave (BHRvBz9v...), distinta de la del servidor.
    // El navegador rechazaba el push firmado con la privada del otro par, así
    // que aunque el registro funcionara, ninguna notificación llegaba.
    var VAPID_PUBLICA = 'BC6oJ4E-5pGIn4icpzCBLMi6_nk-1JJenrUA41uJrAs1ELraSw5ctvRAlh8sHVldqzBXUtEwEeFKBm0_hmuM9EY';

    function solicitarPermisoPushAuto() {
        if (!('Notification' in window)) return;
        if (!('serviceWorker' in navigator)) return;
        if (!window.supabaseClient) return; // sin DB no hay dónde registrar

        // El permiso se PIDE acá. Antes la función arrancaba con
        // `if (Notification.permission !== 'granted') return;`, y nadie más
        // en la carta lo solicitaba: quedaba esperando un permiso que nunca
        // se pedía, así que el registro no ocurría nunca.
        //
        // Se pide al cargar, que es el único momento en que el navegador lo
        // permite sin requerir un gesto previo del usuario.
        if (Notification.permission === 'denied') return; // ya dijo no: no insistir
        var pedirPermiso = Notification.permission === 'granted'
            ? Promise.resolve('granted')
            : Notification.requestPermission();
        pedirPermiso.then(function(permiso) {
            if (permiso !== 'granted') return;
            registrarSuscripcion();
        }).catch(function() {});
    }

    function registrarSuscripcion() {
        // El service worker se registra ACÁ, no se asume registrado.
        //
        // `Cliente/index.html` no lo registraba en ninguna parte, así que
        // `navigator.serviceWorker.ready` era una promesa que nunca se
        // resolvía: el push quedaba esperando para siempre, en silencio.
        //
        // La ruta tiene que ser '../sw.js', NO '../../sw.js'.
        //
        // Este archivo se sirve desde /Cliente/js/, pero un service worker
        // se resuelve contra la URL del DOCUMENTO, que es /Cliente/. Desde
        // ahí 'sw.js' ya alcanza, y '../../' se sale del ámbito del sitio:
        // pedía /SakiSushi1/Cliente/../../sw.js, que normaliza fuera del
        // proyecto y da 404. Lo confirmé con el navegador real por CDP:
        //
        //   A bad HTTP response code (404) was received when fetching the
        //   script.
        //
        // Comprobado con curl: /SakiSushi1/Cliente/../../sw.js -> 404,
        // /SakiSushi1/sw.js -> 200.
        navigator.serviceWorker.register('../sw.js')
            .catch(function() { /* sin SW no hay push, pero la carta anda */ })
            .then(function() { return navigator.serviceWorker.ready; })
            .then(function(reg) {
            reg.pushManager.subscribe({
                userVisibleOnly: true,
                applicationServerKey: urlBase64ToUint8Array(VAPID_PUBLICA)
            }).then(function(sub) {
                // ANTES: solo suscribía en el navegador, y la suscripción se
                // quedaba afuera de la base: el servidor no podía avisarle
                // nada. Ahora se registra, para que el cierre del local pueda
                // llegarle como push.
                var p256dh = btoa(String.fromCharCode.apply(null, new Uint8Array(sub.getKey('p256dh'))));
                var auth   = btoa(String.fromCharCode.apply(null, new Uint8Array(sub.getKey('auth'))));

                // Se registra por RPC y no con un upsert directo.
                //
                // El upsert desde el navegador no puede funcionar: RLS le
                // exige poder LEER la fila para actualizarla, y al visitante
                // anónimo no se le da SELECT a propósito (leería los
                // endpoints de todos los demás dispositivos). La función hace
                // el upsert del lado del servidor, fuerza rol 'cliente' y no
                // expone ninguna lectura.
                //
                // La identidad va como FICHA firmada, no como un id suelto:
                // la base comprueba la firma antes de guardar nada.
                return fichaDeCliente().then(function(ficha) {
                    if (!ficha) return; // sin identidad no hay a quién avisar
                    return window.supabaseClient.rpc('registrar_push_cliente', {
                        p_ficha:      ficha,
                        p_endpoint:   sub.endpoint,
                        p_p256dh:     p256dh,
                        p_auth:       auth,
                        p_user_agent: navigator.userAgent
                    });
                }).catch(function() { /* sin push, pero la carta anda */ });
            }).catch(function() {});
        });
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

        // La campanita lee por FUNCIÓN, no por consulta directa.
        //
        // Consultar la tabla directamente nunca funcionó para un invitado: la
        // regla es `session_id = auth.uid()::text`, y un anónimo tiene
        // auth.uid() = NULL. En SQL, NULL = NULL no es verdadero: es NULL. Por
        // eso la campanita del cliente estaba vacía SIEMPRE, no por un fallo
        // puntual sino por construcción.
        //
        // La función comprueba la firma de la ficha y devuelve solo las filas
        // de ese cliente. Un cliente registrado también puede usarla: la
        // función prefiere auth.uid() cuando hay sesión.
        var conFicha = window.SakiCliente
            ? window.SakiCliente.obtenerFicha()
            : Promise.resolve(null);

        conFicha.then(function (ficha) {
            return window.supabaseClient.rpc('notificaciones_de_cliente', { p_ficha: ficha });
        }).then(function (resp) {
                if (!resp || resp.error) return;
                var datos = resp.data || [];
                if (datos.length === 0) return;
                datos.sort(function(a, b) {
                    return new Date(b.fecha + 'Z') - new Date(a.fecha + 'Z');
                });
                notisCompletas = datos;
                notisNoLeidas = datos.filter(function(n) { return !n.leida; }).length;
                actualizarNotificacionesUI();
            }).catch(function() { /* sin conexión: se queda lo que hubiera */ });
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
