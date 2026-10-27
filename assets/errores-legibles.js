// errores-legibles.js — Traduce errores técnicos a algo que una persona entienda
//
// POR QUÉ EXISTE
//
// La auditoría de caída de red (recibos R2 y R3, 2026-10-26) encontró que sin
// internet el usuario veía el mensaje crudo del motor:
//
//   cliente:  "❌ TypeError: Failed to fetch"
//   cajero:   "❌ Error al registrar el cobro: TypeError: Failed to fetch"
//
// Eso no dice nada. El cliente no sabe si el pedido entró, si lo tiene que
// repetir, o si perdió la plata. El cajero no sabe si el cobro se registró.
//
// La regla: si el error es de los que ya conocemos, se explica en castellano y
// se dice qué hacer. Si es desconocido, se muestra igual pero con un prefijo
// claro, porque ocultar un error real es peor que mostrar uno feo.

(function () {
    'use strict';

    // Cada entrada: cómo reconocer el error, qué decir, y qué hacer.
    var CASOS = [
        {
            // Sin internet, o el servidor no responde.
            probar: function (t) {
                return t.indexOf('failed to fetch') >= 0 ||
                       t.indexOf('networkerror') >= 0 ||
                       t.indexOf('network request failed') >= 0 ||
                       t.indexOf('load failed') >= 0 ||
                       t.indexOf('offline') >= 0;
            },
            mensaje: 'No hay conexión con el servidor. Revisá el internet y volvé a intentar.'
        },
        {
            // La operación tardó más de lo que el navegador espera.
            probar: function (t) { return t.indexOf('timeout') >= 0 || t.indexOf('timed out') >= 0; },
            mensaje: 'El servidor tardó demasiado en responder. Volvé a intentar en unos segundos.'
        },
        {
            // Sesión vencida: el token expira en minutos.
            probar: function (t) { return t.indexOf('jwt') >= 0 || t.indexOf('token has expired') >= 0 ||
                                          t.indexOf('invalid claim') >= 0; },
            mensaje: 'Tu sesión venció. Volvé a iniciar sesión.'
        },
        {
            // El servidor rechazó por permisos.
            probar: function (t) { return t.indexOf('permission denied') >= 0 ||
                                          t.indexOf('row-level security') >= 0 ||
                                          t.indexOf('no autorizado') >= 0; },
            mensaje: 'No tenés permiso para esta acción. Consultá con el administrador.'
        },
        {
            // El servidor está arriba pero caído por dentro.
            probar: function (t) { return t.indexOf('500') >= 0 || t.indexOf('internal server error') >= 0 ||
                                          t.indexOf('bad gateway') >= 0 || t.indexOf('service unavailable') >= 0; },
            mensaje: 'El servidor tuvo un problema. Volvé a intentar en unos minutos.'
        }
    ];

    /**
     * Devuelve un mensaje legible para el usuario a partir de cualquier error.
     *
     * @param {*} err  Error, string, objeto de Supabase, o lo que venga.
     * @returns {string} Texto en castellano, listo para mostrar.
     */
    window.mensajeDeError = function (err) {
        if (err === null || err === undefined) return 'Ocurrió un error inesperado.';

        // Los errores de Supabase traen `.message`, `.details` y `.hint`.
        // Los de `fetch` traen solo `.message`.
        var bruto = '';
        if (typeof err === 'string') {
            bruto = err;
        } else if (err.message) {
            bruto = String(err.message);
        } else if (err.error_description) {
            bruto = String(err.error_description);
        } else {
            try { bruto = JSON.stringify(err); } catch (e) { bruto = String(err); }
        }

        var t = bruto.toLowerCase();

        for (var i = 0; i < CASOS.length; i++) {
            if (CASOS[i].probar(t)) return CASOS[i].mensaje;
        }

        // Desconocido: se muestra, pero marcado como inesperado. Ocultarlo
        // dejaría al usuario sin nada, y sin forma de reportar qué pasó.
        return 'Ocurrió un error inesperado: ' + bruto;
    };

    /**
     * Igual que arriba, pero para casos donde hay que decir si la operación
     * llegó a completarse. El silencio ante un corte es lo más peligroso:
     * el cajero necesita saber si el cobro se registró o no.
     */
    window.mensajeDeFallo = function (queSeIntentaba, err) {
        return 'No se pudo ' + queSeIntentaba + '. ' + window.mensajeDeError(err);
    };

    /**
     * Traduce y muestra un error en un solo paso.
     *
     * Antes cada pantalla armaba el texto a mano y varias le hacían
     * `r.error.message.replace('.message','')` antes de pasarlo. Eso no limpia
     * nada: si el mensaje del servidor contenía ese texto, lo borraba del
     * medio, y si no lo contenía, no hacía absolutamente nada. El efecto era
     * un mensaje cambiado sin motivo y una traducción que a veces no coincidía
     * con ningún caso conocido.
     *
     * Acá se pasa el error tal como llega. `mensajeDeError` ya sabe leer
     * `.message`, `.error_description` o un texto suelto.
     */
    window.mostrarErrorLegible = function (err, queSeIntentaba) {
        var texto = queSeIntentaba
            ? window.mensajeDeFallo(queSeIntentaba, err)
            : window.mensajeDeError(err);

        if (typeof window.mostrarToast === 'function') {
            window.mostrarToast('\u274C ' + texto, 'error');
        }

        // Se devuelve el texto para quien quiera además registrarlo o
        // devolverlo como valor de retorno.
        return texto;
    };

})();
