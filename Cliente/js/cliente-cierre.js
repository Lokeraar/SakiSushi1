// cliente-cierre.js — Cuando el local está cerrado
//
// QUÉ HACE
//
// Si el comercio no abre ese día, el visitante tiene que enterarse apenas
// entra. Pero NO se le esconde la carta: puede navegar el menú, tocar las
// tarjetas, ver los precios del día y hasta el despiece de ingredientes.
// Lo que no puede es armar el pedido.
//
// POR QUÉ NO SE OCULTA TODO
//
// Esconder el menú sería peor: el cliente se va sin saber qué hay ni cuánto
// cuesta, y no vuelve. Mostrar la carta con un aviso claro le deja el antojo
// armado para cuando reabra.
//
// QUIÉN DECIDE
//
// La base. `cierre_vigente()` devuelve el motivo y el mensaje que escribió el
// admin, o nada si está abierto. Y aunque alguien saltee esta capa, el pedido
// no se crea: el candado real vive en `crear_pedido_con_reserva()`.

(function () {
    'use strict';

    // Estado en memoria. Lo consultan el carrito y los botones para saber si
    // tienen que negarse.
    window._localCerrado = false;
    window._cierreInfo   = null;

    // ============================================================
    // Consultar el estado
    // ============================================================

    window.consultarCierreLocal = async function () {
        if (!window.supabaseClient) return null;
        try {
            var { data, error } = await window.supabaseClient.rpc('cierre_vigente');
            if (error) throw error;

            var cierre = (data && data.length) ? data[0] : null;
            window._cierreInfo   = cierre;
            window._localCerrado = !!cierre;
            return cierre;
        } catch (e) {
            // Si la consulta falla, NO se bloquea al cliente. Un error de red
            // no puede cerrarle la tienda a un local que está abierto: sería
            // peor el remedio que la enfermedad.
            console.warn('[cierre] no se pudo consultar:', e.message);
            window._localCerrado = false;
            return null;
        }
    };

    // ============================================================
    // La franja de aviso
    // ============================================================

    window.pintarAvisoCierre = function (cierre) {
        var viejo = document.getElementById('avisoCierreLocal');
        if (viejo) viejo.remove();

        if (!cierre) {
            document.body.classList.remove('local-cerrado');
            return;
        }

        document.body.classList.add('local-cerrado');

        var barra = document.createElement('div');
        barra.id = 'avisoCierreLocal';
        barra.style.cssText =
            'position:sticky;top:0;z-index:9998;width:100%;' +
            'background:linear-gradient(135deg,#7f1d1d,#991b1b);' +
            'color:#fff;padding:.75rem 1rem;text-align:center;' +
            'box-shadow:0 2px 12px rgba(0,0,0,.35);' +
            'font-size:.9rem;line-height:1.4';

        var hasta = cierre.hasta
            ? ' Volvemos el ' + new Date(cierre.hasta).toLocaleString('es-VE', {
                  day: '2-digit', month: 'long', hour: '2-digit', minute: '2-digit'
              }) + '.'
            : '';

        barra.innerHTML =
            '<div style="font-weight:700;margin-bottom:.15rem">' +
              '<i class="fas fa-store-slash"></i> Hoy no estamos abiertos' +
            '</div>' +
            '<div style="opacity:.95">' + escapar(cierre.mensaje || '') + escapar(hasta) + '</div>' +
            '<div style="font-size:.78rem;opacity:.8;margin-top:.2rem">' +
              'Puede ver la carta y los precios. Los pedidos se habilitan cuando reabramos.' +
            '</div>';

        // Va arriba de todo, antes del contenido.
        document.body.insertBefore(barra, document.body.firstChild);
    };

    function escapar(s) {
        return String(s == null ? '' : s)
            .replace(/&/g, '&amp;').replace(/</g, '&lt;')
            .replace(/>/g, '&gt;').replace(/"/g, '&quot;');
    }

    // ============================================================
    // Impedir armar el pedido
    // ============================================================
    //
    // Se envuelve `agregarAlCarrito` en vez de tocar los cinco botones que lo
    // llaman (tarjeta, preview, personalizador...). El próximo botón que se
    // agregue nace protegido.

    window.instalarBloqueoCarrito = function () {
        if (window._bloqueoInstalado) return;
        window._bloqueoInstalado = true;

        var original = window.agregarAlCarrito;
        if (typeof original !== 'function') return;

        window.agregarAlCarrito = function () {
            if (window._localCerrado) {
                window.mostrarAvisoCierreAlTocar();
                return false;
            }
            return original.apply(this, arguments);
        };
    };

    window.mostrarAvisoCierreAlTocar = function () {
        if (window.mostrarToast) {
            window.mostrarToast('🔒 El local está cerrado. No se pueden hacer pedidos hoy.', 'warning');
            return;
        }
        // Sin sistema de toasts: un aviso mínimo, nunca un alert del navegador.
        var t = document.createElement('div');
        t.style.cssText = 'position:fixed;bottom:1.2rem;left:50%;transform:translateX(-50%);' +
            'background:#991b1b;color:#fff;padding:.7rem 1.1rem;border-radius:10px;' +
            'font-size:.88rem;z-index:99999;box-shadow:0 8px 24px rgba(0,0,0,.4)';
        t.textContent = 'El local está cerrado. No se pueden hacer pedidos hoy.';
        document.body.appendChild(t);
        setTimeout(function () { t.remove(); }, 3200);
    };

    // ============================================================
    // Arranque
    // ============================================================

    window.iniciarCierreCliente = async function () {
        var cierre = await window.consultarCierreLocal();
        window.pintarAvisoCierre(cierre);
        window.instalarBloqueoCarrito();

        // La carta se sigue viendo y navegando: no se toca nada más.
        return cierre;
    };

})();
