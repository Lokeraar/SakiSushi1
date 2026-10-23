// cliente-carrito-timer.js — Contadores de las dos fases
//
// REGLAS DEFINIDAS POR EL DUEÑO (leer antes de tocar)
//
// FASE 1 — carrito sin confirmar
//   20 minutos, SE REINICIAN cada vez que el cliente agrega, quita o cambia
//   algo del carrito.
//   El contador SIGUE CORRIENDO si el cliente cierra el navegador: se guarda
//   la marca de tiempo absoluta. Si vuelve antes de los 20 minutos, el carrito
//   SE REANUDA desde donde quedó, con sus campos intactos.
//   Solo se vacía si se cumplen los 20 minutos sin confirmar.
//
// FASE 2 — modal de pago abierto (delivery o reserva)
//   20 minutos, UNA SOLA CUENTA. NO se reinicia por cerrar el modal y volver
//   a entrar. Es el plazo para pagar.
//   SÍ se reinicia si el cliente vuelve atrás y agrega/quita algo del carrito,
//   o si cambia de tipo de pedido (delivery <-> reserva).
//   También sobrevive al cierre del navegador.
//
// LOS CAMPOS NO SE LIMPIAN AL VENCER LA FASE 1
//   Excepción explícita del dueño: los campos del formulario solo se limpian
//   cuando el cliente PAGA (sube comprobante o paga en caja). Al vencer un
//   contador se limpia el CARRITO, no el formulario.
//
// POR QUÉ ACÁ NO SE LIBERA STOCK
//   En ninguna de las dos fases hay reserva en la base: la RPC
//   `crear_pedido_con_reserva` es la que aparta ingredientes, y ocurre al
//   confirmar. Lo que vence acá es el carrito local y el plazo del modal.
//   La liberación real de inventario es de `liberar_reservas_vencidas` (pg_cron).

(function () {
    'use strict';

    var CLAVE_CARRITO = 'saki_carrito';
    var CLAVE_CARRITO_INICIO = 'saki_carrito_inicio';
    var CLAVE_MODAL = 'saki_modal_plazo';   // { tipo, inicio }
    var MINUTOS_DEFECTO = 20;

    var _intervalo = null;

    function minutos() {
        var m = window.configGlobal && parseInt(window.configGlobal.minutos_pago, 10);
        return (m > 0) ? m : MINUTOS_DEFECTO;
    }

    // ============================================================
    // FASE 1 — carrito
    // ============================================================

    /** Reinicia el plazo del carrito. Se llama en cada cambio del carrito. */
    window.reiniciarContadorCarrito = function () {
        try { localStorage.setItem(CLAVE_CARRITO_INICIO, String(Date.now())); } catch (e) {}
        // Cambiar el carrito invalida el plazo del modal: el cliente está
        // volviendo atrás a modificar, así que la fase 2 vuelve a empezar.
        limpiarPlazoModal();
        actualizarAviso();
    };

    function inicioCarrito() {
        try {
            var v = parseInt(localStorage.getItem(CLAVE_CARRITO_INICIO), 10);
            return (v > 0) ? v : null;
        } catch (e) { return null; }
    }

    window.segundosCarritoRestantes = function () {
        var t0 = inicioCarrito();
        if (!t0) return null;
        return Math.floor((t0 + minutos() * 60000 - Date.now()) / 1000);
    };

    window.vencerCarrito = function () {
        var tenia = window.Saki && window.Saki.state && window.Saki.state.carrito &&
                    window.Saki.state.carrito.length > 0;

        if (window.Saki && window.Saki.state) window.Saki.state.carrito = [];
        try {
            localStorage.removeItem(CLAVE_CARRITO);
            localStorage.removeItem(CLAVE_CARRITO_INICIO);
        } catch (e) {}
        limpiarPlazoModal();

        if (window.actualizarCarritoUI) window.actualizarCarritoUI();
        if (window.actualizarCarritoBadge) window.actualizarCarritoBadge();

        // OJO: NO se tocan los campos del formulario. Regla del dueño: se
        // limpian solo al pagar.
        if (tenia) {
            avisar('⏰ Pasaron ' + minutos() + ' minutos sin confirmar tu pedido. ' +
                   'El carrito se vació para liberar los ingredientes.');
        }
        detenerVigilancia();
        return true;
    };

    // ============================================================
    // FASE 2 — plazo del modal de pago (una sola cuenta)
    // ============================================================

    function leerPlazoModal() {
        try {
            var raw = localStorage.getItem(CLAVE_MODAL);
            return raw ? JSON.parse(raw) : null;
        } catch (e) { return null; }
    }

    function limpiarPlazoModal() {
        try { localStorage.removeItem(CLAVE_MODAL); } catch (e) {}
    }
    window.limpiarPlazoModal = limpiarPlazoModal;

    /**
     * Arranca el plazo del modal SOLO si no hay uno en curso del mismo tipo.
     * Volver a abrir el mismo modal NO reinicia la cuenta; cambiar de tipo
     * (delivery <-> reserva) sí, porque es otro pedido.
     */
    window.iniciarPlazoModal = function (tipo) {
        var actual = leerPlazoModal();
        if (actual && actual.tipo === tipo && actual.inicio) {
            return false;   // ya estaba corriendo: se respeta
        }
        try {
            localStorage.setItem(CLAVE_MODAL, JSON.stringify({ tipo: tipo, inicio: Date.now() }));
        } catch (e) {}
        return true;
    };

    window.segundosModalRestantes = function () {
        var p = leerPlazoModal();
        if (!p || !p.inicio) return null;
        return Math.floor((p.inicio + minutos() * 60000 - Date.now()) / 1000);
    };

    /**
     * Vence el plazo del modal: se cierra el modal y se vacía el carrito.
     * Los campos NO se limpian (regla del dueño).
     */
    window.vencerPlazoModal = function () {
        var p = leerPlazoModal();
        var tipo = (p && p.tipo) || 'delivery';

        try {
            var modal = document.getElementById(tipo + 'Modal');
            if (modal) modal.classList.remove('active');
        } catch (e) {}
        limpiarPlazoModal();

        if (window.detenerTimer) window.detenerTimer(tipo);

        var tenia = window.Saki && window.Saki.state && window.Saki.state.carrito &&
                    window.Saki.state.carrito.length > 0;
        if (window.Saki && window.Saki.state) window.Saki.state.carrito = [];
        try {
            localStorage.removeItem(CLAVE_CARRITO);
            localStorage.removeItem(CLAVE_CARRITO_INICIO);
        } catch (e) {}

        if (window.actualizarCarritoUI) window.actualizarCarritoUI();
        if (window.actualizarCarritoBadge) window.actualizarCarritoBadge();

        if (tenia) {
            avisar('⏰ Pasaron ' + minutos() + ' minutos sin completar el pago. ' +
                   'El carrito se vació para liberar los ingredientes.');
        }
        return true;
    };

    // ============================================================
    // Avisos y vigilancia
    // ============================================================

    function avisar(msg) {
        if (window.mostrarToastNotificacion) window.mostrarToastNotificacion(msg, 'warning');
        else if (window.Saki && window.Saki.utils && window.Saki.utils.mostrarToast) {
            window.Saki.utils.mostrarToast(msg, 'warning');
        }
        // Dejar constancia en la campana: el toast desaparece y el cliente
        // puede volver más tarde sin entender qué pasó.
        if (window.supabaseClient && window.supabaseClient.from) {
            try {
                window.supabaseClient.from('notificaciones').insert([{
                    pedido_id: null,
                    tipo: 'rejected',
                    titulo: '⏰ Carrito vaciado por inactividad',
                    mensaje: msg,
                    session_id: null,
                    leida: false
                }]).then(function () {}).catch(function () {});
            } catch (e) {}
        }
    }

    function actualizarAviso() {
        var el = document.getElementById('carritoVenceAviso');
        if (!el) return;
        var s = window.segundosModalRestantes();
        if (s === null) s = window.segundosCarritoRestantes();
        if (s === null || s <= 0) { el.textContent = ''; el.style.display = 'none'; return; }
        var m = Math.floor(s / 60), seg = s % 60;
        el.textContent = '⏳ ' + m + ':' + String(seg).padStart(2, '0') + ' para confirmar';
        el.style.display = '';
    }

    window.iniciarVigilanciaCarrito = function () {
        if (_intervalo) return;
        _intervalo = setInterval(function () {
            // La fase 2 manda si está corriendo: es un plazo más urgente.
            var sm = window.segundosModalRestantes();
            if (sm !== null && sm <= 0) { window.vencerPlazoModal(); return; }

            var sc = window.segundosCarritoRestantes();
            if (sc !== null && sc <= 0) { window.vencerCarrito(); return; }

            actualizarAviso();
        }, 1000);
    };

    function detenerVigilancia() {
        if (_intervalo) { clearInterval(_intervalo); _intervalo = null; }
    }
    window.detenerVigilanciaCarrito = detenerVigilancia;

    /**
     * Al arrancar: reanuda los contadores que quedaron corriendo mientras el
     * navegador estaba cerrado, y vence lo que ya expiró.
     */
    window.revisarCarritoAlCargar = function () {
        if (!window.Saki || !window.Saki.state) return false;

        // Fase 2 primero: si el cliente cerró con el modal de pago abierto,
        // ese es el plazo que manda.
        var sm = window.segundosModalRestantes();
        if (sm !== null) {
            if (sm <= 0) { window.vencerPlazoModal(); return true; }
            // Sigue vigente: REANUDAR el reloj del modal desde donde quedó.
            var p = leerPlazoModal();
            if (p && window.iniciarTimerFrontend && !window._timerCorriendo) {
                try {
                    window.iniciarTimerFrontend(p.tipo, Math.max(1, Math.ceil(sm / 60)));
                } catch (e) {}
            }
            window.iniciarVigilanciaCarrito();
            return false;
        }

        // Fase 1
        var items = (window.Saki.state.carrito || []).length;
        if (items === 0) {
            try {
                localStorage.removeItem(CLAVE_CARRITO_INICIO);
            } catch (e) {}
            return false;
        }

        var t0 = inicioCarrito();
        if (!t0) {
            // Carrito de una versión anterior sin contador: se le da el plazo completo.
            window.reiniciarContadorCarrito();
            return false;
        }

        var sc = window.segundosCarritoRestantes();
        if (sc !== null && sc <= 0) { window.vencerCarrito(); return true; }

        window.iniciarVigilanciaCarrito();
        return false;
    };
})();
