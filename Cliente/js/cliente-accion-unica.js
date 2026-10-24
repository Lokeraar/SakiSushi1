// cliente-accion-unica.js — Un solo freno para todo lo que confirma
//
// EL PROBLEMA QUE RESUELVE
//
// En el modal de confirmar pedido, el botón no se bloqueaba ni mostraba que
// estaba procesando. El cliente tocaba, no pasaba nada visible, tocaba otra
// vez, y otra. Al rato respondía... y al cajero le llegaban CINCO pedidos.
//
// No fue un caso aislado: fue una CLASE de problema. Cada modal que confirma
// algo puede nacer sin freno si nadie se acuerda de ponerlo. Parchear botón
// por botón no sirve: el próximo modal vuelve a nacer roto.
//
// Este archivo da dos cosas:
//
//   1. `conAccionUnica(btn, fn)` — envuelve la acción de un botón: lo
//      bloquea, le pone el spinner, y SI FALLA lo vuelve a habilitar para
//      que el cliente pueda reintentar. Si no se vuelve a habilitar, el
//      cliente queda mirando un botón muerto.
//
//   2. Una red global: mientras haya una confirmación en curso, se ignora
//      cualquier toque nuevo. Así, aunque alguien escriba mañana un modal
//      sin freno, no rompe nada.

(function () {
    'use strict';

    // Cuántas confirmaciones están en curso ahora mismo.
    var enCurso = 0;

    /** ¿Hay algo confirmándose en este momento? */
    window.hayAccionEnCurso = function () {
        return enCurso > 0;
    };

    /**
     * Ejecuta `fn` una sola vez, con el botón bloqueado y un spinner.
     *
     * @param {HTMLElement|string} boton  El elemento o su id.
     * @param {Function} fn               Acción async a ejecutar.
     * @param {Object} opciones           { texto, textoCargando, silencioso }
     * @returns {Promise<any>|undefined}  undefined si se ignoró el toque.
     */
    window.conAccionUnica = function (boton, fn, opciones) {
        var el = typeof boton === 'string' ? document.getElementById(boton) : boton;
        var opc = opciones || {};

        // Ya está corriendo algo: se ignora el toque. Esta es la parte que
        // evita los pedidos duplicados, y vale para CUALQUIER botón.
        if (enCurso > 0) return undefined;

        // El botón ya está bloqueado: doble protección por si el navegador
        // dispara el evento dos veces antes de que se aplique `disabled`.
        if (el && el.disabled) return undefined;

        // Se guarda el contenido original para restaurarlo pase lo que pase.
        var htmlOriginal = el ? el.innerHTML : null;
        var textoOriginal = opc.texto || null;

        if (el) {
            el.disabled = true;
            el.setAttribute('aria-busy', 'true');
            // Sin el spinner el cliente vuelve a tocar: no hay señal de que
            // el toque se registró. Eso fue justo lo que pasó antes.
            el.innerHTML = '<i class="fas fa-spinner fa-spin"></i> ' +
                (opc.textoCargando || 'Procesando...');
        }

        enCurso++;

        return Promise.resolve()
            .then(fn)
            .catch(function (err) {
                // Un error no puede dejar el botón muerto: se habilita para
                // que el cliente reintente.
                if (window.mostrarToast && !opc.silencioso) {
                    window.mostrarToast('❌ ' + (err && err.message ? err.message : err), 'error');
                }
                throw err;
            })
            .finally(function () {
                enCurso = Math.max(0, enCurso - 1);
                if (!el) return;
                el.disabled = false;
                el.removeAttribute('aria-busy');
                el.innerHTML = textoOriginal || htmlOriginal;
            });
    };

    /**
     * Red global de respaldo.
     *
     * Mientras haya una confirmación en curso, cualquier clic sobre un botón
     * de confirmar se descarta. Es la capa que protege a los modales que se
     * escriban en el futuro sin usar `conAccionUnica`.
     */
    document.addEventListener('click', function (e) {
        if (enCurso === 0) return;

        var btn = e.target && e.target.closest
            ? e.target.closest('button, .btn-primary, .btn-confirm, .btn-secondary')
            : null;
        if (!btn) return;

        e.stopPropagation();
        e.preventDefault();
    }, true);   // captura: corre antes que cualquier listener del botón

})();
