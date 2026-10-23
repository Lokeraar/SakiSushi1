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
     * Muestra el diálogo de continuación.
     * `alAceptar` y `alCancelar` permiten que cada flujo decida qué hacer.
     */
    window.mostrarDialogoReanudarCarrito = function (opciones) {
        opciones = opciones || {};
        var alAceptar  = opciones.alAceptar  || function () {};
        var alCancelar = opciones.alCancelar || function () {};

        if (document.getElementById(ID_DIALOGO)) return;   // ya está abierto

        var segundos = window.segundosCarritoRestantes
            ? window.segundosCarritoRestantes()
            : null;

        var detalleTiempo = '';
        if (segundos !== null && segundos > 0) {
            var m = Math.floor(segundos / 60);
            var s = segundos % 60;
            detalleTiempo = 'Te quedan ' + m + ':' + String(s).padStart(2, '0') +
                            ' para confirmarlo.';
        }

        var overlay = document.createElement('div');
        overlay.className = 'modal-overlay active';
        overlay.id = ID_DIALOGO;
        overlay.innerHTML =
            '<div class="confirm-dialog">' +
              '<i class="fas fa-shopping-basket"></i>' +
              '<h3>¿Continuar con tu pedido anterior?</h3>' +
              '<p>Tienes un pedido sin finalizar. ¿Deseas continuar donde lo dejaste?</p>' +
              (detalleTiempo ? '<p style="font-size:.8rem;opacity:.75;margin-top:-.3rem">' +
                                detalleTiempo + '</p>' : '') +
              '<div class="confirm-dialog-buttons">' +
                '<button class="btn-cancel" id="cancelarPedidoAnterior">Empezar de cero</button>' +
                '<button class="btn-confirm" id="confirmarPedidoAnterior">Continuar</button>' +
              '</div>' +
            '</div>';

        document.body.appendChild(overlay);

        document.getElementById('cancelarPedidoAnterior').addEventListener('click', function () {
            cerrarDialogo();
            if (window.vencerCarrito) window.vencerCarrito();
            try { alCancelar(); } catch (e) { console.warn(e); }
        });

        document.getElementById('confirmarPedidoAnterior').addEventListener('click', function () {
            cerrarDialogo();
            // NO se reinicia el contador: aceptar el carrito no es una acción
            // nueva del cliente sobre él. El plazo sigue corriendo desde el
            // último cambio real.
            if (window.iniciarVigilanciaCarrito) window.iniciarVigilanciaCarrito();
            if (window.actualizarCarritoUI) window.actualizarCarritoUI();
            if (window.actualizarCarritoBadge) window.actualizarCarritoBadge();
            try { alAceptar(); } catch (e) { console.warn(e); }
        });
    };

    /**
     * Decide si corresponde preguntar al arrancar.
     *
     * Solo pregunta si:
     *   - hay carrito restaurado,
     *   - no venció (si venció, el timer ya lo vació y avisó),
     *   - el cliente no está a mitad de un pago (no interrumpir con un modal
     *     encima de otro).
     */
    window.mostrarDialogoSiCorresponde = function () {
        if (!window.Saki || !window.Saki.state) return false;

        var items = (window.Saki.state.carrito || []).length;
        if (items === 0) return false;

        // Si el plazo del modal de pago está vigente, el cliente está en fase 2:
        // no se le interrumpe con este diálogo.
        if (window.segundosModalRestantes && window.segundosModalRestantes() > 0) return false;

        var segundos = window.segundosCarritoRestantes
            ? window.segundosCarritoRestantes()
            : null;

        // Sin contador no hay evidencia de vigencia: no se pregunta de más.
        if (segundos === null) return false;

        // Vencido: el timer se encarga, no se pregunta.
        if (segundos <= 0) return false;

        window.mostrarDialogoReanudarCarrito({
            alAceptar: function () {
                if (window.Saki.utils && window.Saki.utils.mostrarToast) {
                    window.Saki.utils.mostrarToast('🔄 Pedido anterior restaurado', 'success');
                }
                // Reabrir la barra del carrito para que lo vea.
                var sidebar = document.getElementById('cartSidebar');
                var ov = document.getElementById('overlay');
                if (sidebar && window.innerWidth <= 992) {
                    sidebar.classList.add('open');
                    if (ov) ov.classList.add('active');
                }
            }
        });
        return true;
    };
})();
