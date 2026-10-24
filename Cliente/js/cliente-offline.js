// cliente-offline.js — Datos de ejemplo cuando NO hay internet, solo en local
//
// PARA QUÉ
//
// El dueño necesita tocar la carta (secciones, tarjetas, carrito,
// personalizador) sin depender de tener internet. Pero el cliente real SÍ
// necesita estar online: si no tiene conexión, no puede pedir nada.
//
// POR QUÉ NO UN SERVICE WORKER
//
// Un service worker que guarde la carta serviría al cliente también, y eso no
// se quiere: el cliente debe estar online obligatoriamente. Acá el objetivo es
// solo el entorno de desarrollo.
//
// CÓMO FUNCIONA (cascada, no interruptor)
//
//   1. Se intenta Supabase con los datos reales.
//   2. Si responde: se usan los reales. Fin. Nada de datos de mentira.
//   3. Si falla Y estamos en local: se usa `dev/datos.json`.
//   4. Si falla Y NO estamos en local: no se usa nada (el cliente ve el error,
//      que es lo correcto: sin internet no hay carta).
//
// Esto es mejor que "en local siempre datos falsos": con internet, el dueño ve
// su base de verdad aunque esté en localhost. Si fuera un interruptor fijo, se
// arriesgaría a creer que prueba la base cuando está mirando una copia.
//
// CÓMO SE SABE QUE ES LOCAL
//
// Solo 127.0.0.1, localhost o la IP de la red interna. GitHub Pages NUNCA
// entra acá, así que el cliente real jamás ve datos de ejemplo.

(function () {
    'use strict';

    var datosCargados = false;

    /** ¿Estamos en un servidor local de desarrollo? */
    window.esEntornoLocal = function () {
        var h = location.hostname;
        return h === '127.0.0.1' || h === 'localhost' || h === '::1' ||
               /^192\.168\.\d+\.\d+$/.test(h) ||
               /^10\.\d+\.\d+\.\d+$/.test(h);
    };

    /** Aviso visible para que nadie confunda datos de ejemplo con los reales. */
    function pintarAvisoDev(motivo) {
        if (document.getElementById('avisoDatosEjemplo')) return;

        var b = document.createElement('div');
        b.id = 'avisoDatosEjemplo';
        b.style.cssText =
            'position:fixed;top:0;left:0;right:0;z-index:99999;' +
            'background:#f59e0b;color:#000;font-size:.72rem;font-weight:700;' +
            'text-align:center;padding:.25rem .5rem;letter-spacing:.02em';
        b.textContent = '⚠️ DATOS DE EJEMPLO (sin conexión) — ' + motivo;
        document.body.appendChild(b);
    }

    /**
     * Carga la copia local. Devuelve true si la usó.
     *
     * Se llama SOLO cuando Supabase ya falló, así que nunca pisa datos reales.
     */
    window.usarDatosDeEjemplo = async function (motivo) {
        if (!window.esEntornoLocal()) {
            // Fuera de local no se usan datos falsos nunca, ni por error.
            return false;
        }
        if (datosCargados) return true;

        try {
            var resp = await fetch('js/dev/datos.json?v=' + Date.now());
            if (!resp.ok) return false;
            var datos = await resp.json();

            window.Saki = window.Saki || {};
            window.Saki.state = window.Saki.state || {};

            if (Array.isArray(datos.menu)) window.Saki.state.menuItems = datos.menu;
            if (Array.isArray(datos.inventario)) window.Saki.state.inventario = datos.inventario;
            if (Array.isArray(datos.secciones)) window.Saki.state.secciones = datos.secciones;

            if (datos.config) {
                window.Saki.state.config = {
                    ...(window.Saki.state.config || {}),
                    descuento_al_quitar: datos.config.descuento_al_quitar !== false
                };
                window.configGlobal = window.configGlobal || {};
                window.configGlobal.tasa_efectiva = datos.config.tasa_efectiva;
                window.configGlobal.tasa_cambio = datos.config.tasa_cambio;
                window.configGlobal.descuento_al_quitar = datos.config.descuento_al_quitar !== false;
            }

            datosCargados = true;
            pintarAvisoDev(motivo || 'sin conexión');
            console.warn('[offline] usando datos de ejemplo. Los pedidos NO se guardan.');
            return true;
        } catch (e) {
            console.warn('[offline] no se pudo cargar la copia local:', e.message);
            return false;
        }
    };

    /** ¿Los datos que se están viendo son de ejemplo? */
    window.estaUsandoDatosDeEjemplo = function () {
        return datosCargados;
    };
})();
