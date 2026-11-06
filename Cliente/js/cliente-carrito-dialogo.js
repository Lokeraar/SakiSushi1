// cliente-carrito-dialogo.js — "¿Continuar con pedido anterior?"
//
// OJO CON EL NOMBRE: NO se llama `mostrarDialogoContinuar` porque
// `cliente-delivery.js` ya define esa función y hace otra cosa (un toast
// informativo que carga DESPUÉS y pisaba a esta). Se usa
// `mostrarDialogoReanudarCarrito` para que no vuelva a colisionar.
//
// HISTORIA
//
// Este diálogo existía en la versión monolítica del Cliente
// (`mostrarDialogoContinuar` en el index.html original) y se perdió en la
// modularización de mayo: `restaurarCarrito` quedó sin el diálogo y empezó a
// restaurar el carrito en silencio, con un TTL de 1 hora.
//
// El dueño lo pidió de vuelta, y tiene sentido: no es lo mismo "recuperé tu
// carrito" que "¿querés seguir con lo que dejaste?". El cliente debe decidir.
//
// CÓMO COEXISTE CON LOS CONTADORES (cliente-carrito-timer.js)
//
//   El contador decide SI el carrito sigue vigente.
//   El diálogo decide SI el cliente quiere recuperarlo.
//   Son decisiones distintas y no se pisan:
//
//   - Si venció (más de 20 min sin confirmar), NO se muestra el diálogo:
//     el carrito se vacía y se avisa. Preguntar "¿continuar?" sobre algo
//     que ya no está en plazo sería mentir.
//   - Si sigue vigente, se pregunta. "Continuar" reanuda el carrito Y el
//     contador sigue desde donde estaba (no se reinicia por aceptar).
//   - "Cancelar" vacía el carrito y limpia el plazo.
//
// El texto del diálogo dice el tiempo real que queda, en vez de un
// "menos de una hora" genérico.

(function () {
    'use strict';

    var ID_DIALOGO = 'continuarDialogo';

    function minutos() {
        var m = window.configGlobal && parseInt(window.configGlobal.minutos_pago, 10);
        return (m > 0) ? m : 20;
    }

    function cerrarDialogo() {
        var el = document.getElementById(ID_DIALOGO);
        if (el && el.parentNode) el.parentNode.removeChild(el);
    }

    /**
     * Diálogo de continuación, VÁLIDO PARA LAS DOS FASES.
     *
     * FASE 1 — carrito en construcción. El contador es el del carrito
     *         (se reinicia cada vez que el cliente cambia algo).
     * FASE 2 — modal de pago abierto. El contador es el plazo de pago:
     *         una sola cuenta que no se reinicia al reabrir el modal.
     *
     * Las dos fases muestran LA MISMA VENTANA, con las mismas dos salidas:
     * "Empezar de cero" y "Continuar". Es lo que pidió el dueño: antes en
     * fase 2 solo quedaba un toast que decía "tienes 1 items en tu carrito",
     * sin forma de limpiarlo ni de volver a la pantalla de pago.
     *
     * POR QUÉ EL PLAZO SE MIDE SIEMPRE EN SEGUNDOS ABSOLUTOS
     *   El contador se pinta desde `segundosRestantes()`, que compara marcas
     *   de tiempo reales guardadas en localStorage. Así sobrevive a cerrar
     *   la pestaña, a que el teléfono suspenda el navegador y a recargar la
     *   página, sin desfases ni redondeos.
     */
    window.mostrarDialogoReanudarCarrito = function mostrarDialogoReanudarCarrito (opciones) {
        opciones = opciones || {};
        var alAceptar  = opciones.alAceptar  || function () {};
        var alCancelar = opciones.alCancelar || function () {};

        if (document.getElementById(ID_DIALOGO)) return;   // ya está abierto

        // ── ¿En qué fase está el cliente? ──
        // El plazo del modal de pago manda si está corriendo: es el más
        // urgente y es el que el cliente reconoce en la pantalla de pago.
        var segundosPago = window.segundosModalRestantes ? window.segundosModalRestantes() : null;
        var enFase2 = (segundosPago !== null && segundosPago > 0);

        // De dónde se lee el tiempo que se muestra, en una función para poder
        // repintarlo cada segundo sin duplicar la lógica.
        var leerSegundos = enFase2
            ? function () { return window.segundosModalRestantes(); }
            : function () {
                return window.segundosCarritoRestantes ? window.segundosCarritoRestantes() : null;
              };

        function texto(s) {
            if (s === null || s <= 0) return '';
            var m = Math.floor(s / 60);
            var seg = s % 60;
            return 'Te quedan ' + m + ':' + (seg < 10 ? '0' : '') + seg +
                   (enFase2 ? ' para pagar.' : ' para confirmarlo.');
        }

        var primerTexto = texto(leerSegundos());

        var overlay = document.createElement('div');
        overlay.className = 'modal-overlay active';
        overlay.id = ID_DIALOGO;
        overlay.innerHTML =
            '<div class="confirm-dialog">' +
              '<i class="fas fa-shopping-basket"></i>' +
              '<h3>¿Continuar con tu pedido anterior?</h3>' +
              '<p>Tienes un pedido sin finalizar. ¿Deseas continuar donde lo dejaste?</p>' +
              // El hueco existe siempre, aunque empiece vacío: así el alto de
              // la ventana no salta cuando el contador se repinta.
              '<p class="dlg-tiempo" id="dlgTiempo"' +
                (primerTexto ? '' : ' style="display:none"') + '>' + primerTexto + '</p>' +
              '<div class="confirm-dialog-buttons">' +
                '<button class="btn-cancel" id="cancelarPedidoAnterior">Empezar de cero</button>' +
                '<button class="btn-confirm" id="confirmarPedidoAnterior">Continuar</button>' +
              '</div>' +
            '</div>';

        document.body.appendChild(overlay);

        // ── El contador corre también aquí dentro ──
        // Antes la ventana mostraba una foto del tiempo al abrirse: si te
        // quedabas mirándola, el número se congelaba. Ahora baja segundo a
        // segundo, y si se agota solo, la ventana se cierra sin dejar una
        // decisión imposible en pantalla.
        var nodoTiempo = document.getElementById('dlgTiempo');
        var intervalo = setInterval(function () {
            var s = leerSegundos();

            if (s === null) {           // se perdió el plazo: no mentir
                if (nodoTiempo) { nodoTiempo.textContent = ''; nodoTiempo.style.display = 'none'; }
                return;
            }
            if (s <= 0) {               // venció mientras la ventana estaba abierta
                cerrarDialogo();
                return;
            }
            if (nodoTiempo) {
                nodoTiempo.textContent = texto(s);
                nodoTiempo.style.display = '';
            }
        }, 1000);

        // El intervalo tiene que morir con la ventana, o sigue corriendo para
        // siempre cada vez que el diálogo se abre y se cierra.
        var cerrarYParar = function () {
            clearInterval(intervalo);
            cerrarDialogo();
        };
        window._cerrarDialogoContinuar = cerrarYParar;

        document.getElementById('cancelarPedidoAnterior').addEventListener('click', function () {
            cerrarYParar();

            // ── Empezar de cero ──
            // Se descarta el pedido anterior en las dos fases.
            //
            // OJO: en fase 2 NO hay reserva de ingredientes todavía. La RPC
            // que aparta stock (`crear_pedido_con_reserva`) corre al
            // CONFIRMAR el pedido, no al abrir el modal. Por eso aquí no hay
            // nada que devolver al inventario: solo se limpia lo local.
            if (enFase2) {
                if (window.limpiarPlazoModal) window.limpiarPlazoModal();
                if (window.detenerTimer) window.detenerTimer('delivery');
                if (window.detenerTimer) window.detenerTimer('reserva');
                ['delivery', 'reserva'].forEach(function (t) {
                    var m = document.getElementById(t + 'Modal');
                    if (m) m.classList.remove('active');
                });
                if (window.olvidarPedidoPendiente) window.olvidarPedidoPendiente();
                if (window.Saki && window.Saki.state) window.Saki.state.pedidoPendienteId = null;
            }

            // En las dos fases el carrito se vacía y su contador se limpia.
            if (window.vencerCarrito) {
                // Silencioso: el cliente eligió empezar de cero, no se le
                // anuncia un vencimiento que no ocurrió.
                window.vencerCarrito({ silencioso: true });
            } else {
                if (window.Saki && window.Saki.state) window.Saki.state.carrito = [];
                if (window.guardarCarrito) window.guardarCarrito();
                if (window.actualizarCarritoUI) window.actualizarCarritoUI();
                if (window.actualizarCarritoBadge) window.actualizarCarritoBadge();
            }

            // Aviso de confirmación: sin esto el carrito desaparece y el
            // cliente no sabe si hizo bien en tocar ahí.
            if (window.mostrarToastNotificacion) {
                window.mostrarToastNotificacion('🧺 Empezaste un pedido nuevo.', 'success');
            }

            try { alCancelar(); } catch (e) { console.warn(e); }
        });

        document.getElementById('confirmarPedidoAnterior').addEventListener('click', function () {
            cerrarYParar();

            // NO se reinicia el contador: aceptar el carrito no es una acción
            // nueva del cliente sobre él. El plazo sigue corriendo desde el
            // último cambio real.
            if (window.iniciarVigilanciaCarrito) window.iniciarVigilanciaCarrito();
            if (window.actualizarCarritoUI) window.actualizarCarritoUI();
            if (window.actualizarCarritoBadge) window.actualizarCarritoBadge();

            // En fase 2, "Continuar" devuelve al cliente A LA PANTALLA DE
            // PAGO. Sin esto el modal seguía cerrado tras recargar, con el
            // reloj corriendo: el cliente veía el carrito pero había perdido
            // el acceso a los datos de Pago Móvil y al botón de confirmar.
            if (enFase2) {
                var plazo = null;
                try { plazo = JSON.parse(localStorage.getItem('saki_modal_plazo')); } catch (e) {}
                var tipo = (plazo && plazo.tipo) || 'delivery';
                if (tipo === 'reserva') {
                    if (window.iniciarProcesoReserva) window.iniciarProcesoReserva();
                } else {
                    if (window.iniciarProcesoDelivery) window.iniciarProcesoDelivery();
                }
            }

            try { alAceptar(); } catch (e) { console.warn(e); }
        });
    };

    /**
     * Decide si corresponde preguntar al arrancar.
     *
     * Solo pregunta si:
     *   - hay carrito restaurado,
     *   - no venció (si venció, el timer ya lo vació y avisó),
     *   - el plazo siga vigente (sea el del carrito o el del pago).
     *
     * YA NO SE EXCLUYE LA FASE 2. Antes, si el modal de pago estaba vigente,
     * este diálogo se saltaba a propósito y el cliente solo veía un toast
     * "tienes N items en tu carrito", sin forma de limpiarlo ni de volver a
     * la pantalla de pago. Ahora la ventana sirve para las dos fases.
     */
    window.mostrarDialogoSiCorresponde = function mostrarDialogoSiCorresponde () {
        if (!window.Saki || !window.Saki.state) return false;

        var items = (window.Saki.state.carrito || []).length;
        if (items === 0) return false;

        // ── Qué contador manda ──
        //
        // Si el plazo del modal de pago sigue vivo, el cliente está en fase 2
        // y es ESE plazo el que decide, no el del carrito.
        //
        // Es importante que sean excluyentes: el plazo del carrito pudo
        // haberse cumplido mientras el cliente estaba en la pantalla de pago
        // (el carrito se reinicia con cada cambio, el de pago no). Exigir los
        // dos dejaría al cliente sin ventana justo en el caso que el dueño
        // reportó.
        var segundosPago = window.segundosModalRestantes ? window.segundosModalRestantes() : null;
        var segundos;

        if (segundosPago !== null) {
            if (segundosPago <= 0) return false;    // fase 2 vencida: el timer avisa
            segundos = segundosPago;
        } else {
            segundos = window.segundosCarritoRestantes
                ? window.segundosCarritoRestantes()
                : null;
            // Sin contador no hay evidencia de vigencia: no se pregunta de más.
            if (segundos === null) return false;
            // Vencido: el timer se encarga, no se pregunta.
            if (segundos <= 0) return false;
        }

        window.mostrarDialogoReanudarCarrito({
            alAceptar: function () {
                if (window.Saki.utils && window.Saki.utils.mostrarToast) {
                    window.Saki.utils.mostrarToast('🔄 Pedido anterior restaurado', 'success');
                }
                // Reabrir la barra del carrito para que lo vea.
                //
                // Pasa por la regla de un panel a la vez: si el menú de
                // categorías o las notificaciones estaban abiertos, se
                // cierran. Abrir el carrito a mano aquí dejaba dos paneles
                // superpuestos.
                if (window.innerWidth <= 992) {
                    if (window.cerrarPanelesExcepto) {
                        window.cerrarPanelesExcepto('carrito');
                    }
                    var sidebar = document.getElementById('cartSidebar');
                    var ov = document.getElementById('overlay');
                    if (sidebar) sidebar.classList.add('open');
                    if (ov) ov.classList.add('active');
                }
            }
        });
        return true;
    };
})();
