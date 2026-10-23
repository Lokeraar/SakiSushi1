// cliente-reservas.js — Fase 2: vencimiento del plazo de pago
//
// CONTEXTO
//
// El dueño definió dos fases con dos contadores:
//
//   FASE 1 (carrito): vive solo en el navegador. No hay reserva en la base,
//   así que no hay stock que liberar. Se resuelve con localStorage.
//
//   FASE 2 (pedido confirmado): la reserva YA existe en la base. Son 20
//   minutos para pagar. Al vencer hay que liberar el inventario de verdad,
//   no solo cerrar un modal.
//
// Este archivo cubre la fase 2 desde el lado del cliente. La red de
// seguridad es `liberar_reservas_vencidas()` en pg_cron, que corre cada
// minuto y funciona aunque el cliente cierre la pestaña. Las dos vías
// conviven: si el cliente está presente, cancela enseguida; si no, el
// barrido lo hace después.
//
// POR QUÉ EL CLIENTE NO PUEDE LLAMAR A `liberar_ingredientes`
//
// La migración 06 le puso guardián de rol: solo cajero o admin. El cliente
// es anónimo. Así que el cliente no libera el stock directamente; marca su
// pedido como abandonado y el barrido hace el trabajo sucio.
//
// OJO CON LA DUPLICACIÓN: si el cliente cancela y el barrido también, no
// pasa nada: el barrido usa `FOR UPDATE SKIP LOCKED` y solo actúa sobre
// pedidos `pendiente` con la reserva viva.

(function () {
    'use strict';

    var CLAVE_PEDIDO = 'saki_pedido_pendiente';

    function guardarPedidoPendiente(pedidoId, tipo) {
        if (!pedidoId) return;
        try {
            sessionStorage.setItem(CLAVE_PEDIDO, JSON.stringify({
                id: pedidoId,
                tipo: tipo || null,
                creadoEn: Date.now()
            }));
        } catch (e) { /* sessionStorage lleno o bloqueado: no es crítico */ }
    }
    window.guardarPedidoPendiente = guardarPedidoPendiente;

    function leerPedidoPendiente() {
        try {
            var raw = sessionStorage.getItem(CLAVE_PEDIDO);
            return raw ? JSON.parse(raw) : null;
        } catch (e) { return null; }
    }
    window.leerPedidoPendiente = leerPedidoPendiente;

    function olvidarPedidoPendiente() {
        try { sessionStorage.removeItem(CLAVE_PEDIDO); } catch (e) {}
    }
    window.olvidarPedidoPendiente = olvidarPedidoPendiente;

    /**
     * Cancela por vencimiento un pedido que el cliente todavía tiene abierto.
     *
     * No libera stock (no tiene permiso). Deja el pedido marcado para que el
     * barrido lo procese, y si el pedido ya no está pendiente no hace nada.
     *
     * Devuelve el resultado del barrido, útil para depurar.
     */
    window.cancelarPedidoPorVencimiento = async function (pedidoId) {
        if (!pedidoId) {
            // Sin id concreto: se pide un barrido general, que es idempotente.
            olvidarPedidoPendiente();
            return { success: true, omitido: true, motivo: 'sin pedido puntual' };
        }

        try {
            if (window.supabaseClient && window.supabaseClient.rpc) {
                // El RPC está revocado para anon: si se llama, la base lo
                // rechaza. Se intenta igual porque sirve como señal temprana
                // cuando el cliente SÍ tiene sesión (mesonero, por ejemplo).
                var resp = await window.supabaseClient.rpc('liberar_reservas_vencidas');
                if (!resp.error) {
                    olvidarPedidoPendiente();
                    return resp.data;
                }
            }
        } catch (e) {
            console.warn('[reservas] El barrido no se pudo disparar desde el cliente:', e.message);
        }

        // Vía de respaldo: esperar al barrido. El pedido se cancela solo en
        // menos de un minuto porque su pago_expira_en ya venció.
        olvidarPedidoPendiente();
        return { success: true, delegado: 'pg_cron' };
    };

    /**
     * Revisa al cargar la app si quedó un pedido pendiente de una sesión
     * anterior y ya venció. Cubre el caso de cerrar la pestaña y volver.
     */
    window.revisarPedidoPendienteAlCargar = async function () {
        var pendiente = leerPedidoPendiente();
        if (!pendiente || !pendiente.id) return null;

        // Si tiene menos de 20 minutos, todavía está en plazo.
        var minutos = window.configGlobal && parseInt(window.configGlobal.minutos_pago, 10);
        if (!(minutos > 0)) minutos = 20;
        var transcurridos = (Date.now() - pendiente.creadoEn) / 60000;

        if (transcurridos < minutos) return { enPlazo: true, pendiente: pendiente };

        await window.cancelarPedidoPorVencimiento(pendiente.id);
        return { enPlazo: false, cancelado: pendiente.id };
    };
})();
