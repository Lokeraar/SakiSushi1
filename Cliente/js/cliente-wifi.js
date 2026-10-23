// cliente-wifi.js — Datos del wifi del local para el cliente
//
// POR QUÉ EXISTE ESTE ARCHIVO
//
// Antes el wifi viajaba DENTRO de la URL del QR (?wifi_ssid=...&wifi_pwd=...).
// Eso tiene dos problemas:
//
//   1. Si cambia la clave hay que reimprimir los seis portamesas de las mesas.
//      En un local eso es plata y tiempo, y los carteles viejos siguen
//      circulando con la clave muerta.
//   2. El cliente leía `?mesa=` y descartaba el resto: no había ninguna
//      pantalla que mostrara el wifi. La función estaba muerta de punta a punta.
//
// Ahora el QR lleva SOLO la mesa (un dato que nunca cambia) y el cliente pide
// el wifi a la base con la función `wifi_publico()`, que devuelve únicamente
// ssid y password — nunca el resto de `config`.
//
// La clave queda legible por anon. Es a propósito: es la misma clave que está
// pegada en la pared del local. Para credenciales que importen, esta tabla no
// sirve.

(function () {
    'use strict';

    var CLAVE_OCULTO = 'saki_wifi_banner_oculto';

    /**
     * Pide el wifi a la base. Devuelve {ssid, password} o null.
     * Se llama una sola vez por carga: el dato cambia poco.
     */
    window.obtenerWifiLocal = async function () {
        if (!window.supabaseClient) return null;

        try {
            var resp = await window.supabaseClient.rpc('wifi_publico');
            if (resp.error) {
                console.warn('[wifi] error RPC:', resp.error.message);
                return null;
            }
            var d = resp.data;
            if (!d || !d.ssid) return null;
            return { ssid: d.ssid, password: d.password || '' };
        } catch (e) {
            console.warn('[wifi] excepción:', e.message);
            return null;
        }
    };

    /**
     * Ofrece el wifi al cliente.
     *
     * Solo aparece si el local cargó los datos. Se muestra una vez por sesión
     * y el cliente puede cerrarlo; si lo cierra, no vuelve a molestar hasta
     * que abra de nuevo.
     */
    window.mostrarOfertaWifi = async function () {
        try {
            if (sessionStorage.getItem(CLAVE_OCULTO) === '1') return;
        } catch (e) {}

        var wifi = await window.obtenerWifiLocal();
        if (!wifi) return;          // el local no configuró wifi: no se muestra nada

        if (document.getElementById('wifiBanner')) return;

        var banner = document.createElement('div');
        banner.id = 'wifiBanner';
        banner.style.cssText =
            'position:fixed;left:12px;right:12px;bottom:12px;z-index:9000;' +
            'background:rgba(30,30,34,.97);color:#fff;border-radius:14px;' +
            'box-shadow:0 8px 28px rgba(0,0,0,.45);padding:.9rem 1rem;' +
            'display:flex;align-items:center;gap:.75rem;' +
            'border:1px solid rgba(255,255,255,.12);animation:wifiSube .25s ease-out';

        banner.innerHTML =
            '<i class="fas fa-wifi" style="font-size:1.2rem;color:#4ade80"></i>' +
            '<div style="flex:1;min-width:0">' +
              '<div style="font-size:.85rem;font-weight:600;margin-bottom:.15rem">' +
                'WiFi del local' +
              '</div>' +
              '<div style="font-size:.78rem;opacity:.85;word-break:break-all">' +
                escaparHtml(wifi.ssid) +
                (wifi.password
                  ? ' · Clave: <strong>' + escaparHtml(wifi.password) + '</strong>'
                  : ' · Red abierta') +
              '</div>' +
            '</div>' +
            (wifi.password
              ? '<button id="wifiCopiar" style="background:rgba(74,222,128,.15);' +
                'color:#4ade80;border:1px solid rgba(74,222,128,.4);border-radius:10px;' +
                'padding:.45rem .7rem;font-size:.78rem;font-weight:600;cursor:pointer;' +
                'white-space:nowrap">' +
                '<i class="fas fa-copy"></i> Copiar' +
                '</button>'
              : '') +
            '<button id="wifiCerrar" aria-label="Cerrar" style="background:none;border:none;' +
              'color:rgba(255,255,255,.55);font-size:1rem;cursor:pointer;padding:.2rem">' +
              '<i class="fas fa-times"></i></button>';

        document.body.appendChild(banner);

        var btnCerrar = document.getElementById('wifiCerrar');
        if (btnCerrar) {
            btnCerrar.addEventListener('click', function () {
                banner.remove();
                try { sessionStorage.setItem(CLAVE_OCULTO, '1'); } catch (e) {}
            });
        }

        var btnCopiar = document.getElementById('wifiCopiar');
        if (btnCopiar) {
            btnCopiar.addEventListener('click', async function () {
                var texto = wifi.password;
                var copiado = false;

                // navigator.clipboard exige HTTPS o localhost. En el celular
                // del cliente puede no estar disponible, así que hay respaldo.
                try {
                    if (navigator.clipboard && window.isSecureContext) {
                        await navigator.clipboard.writeText(texto);
                        copiado = true;
                    }
                } catch (e) {}

                if (!copiado) {
                    // Respaldo: seleccionar el texto en un campo temporal.
                    var ta = document.createElement('textarea');
                    ta.value = texto;
                    ta.style.cssText = 'position:fixed;opacity:0';
                    document.body.appendChild(ta);
                    ta.select();
                    try { copiado = document.execCommand('copy'); } catch (e) {}
                    ta.remove();
                }

                // En Android lo más útil no es copiar: es abrir el panel de
                // wifi con la red ya elegida.
                if (copiado) {
                    btnCopiar.innerHTML = '<i class="fas fa-check"></i> Copiada';
                    btnCopiar.disabled = true;
                } else {
                    // Último recurso: se la mostramos grande para que la lea.
                    btnCopiar.outerHTML =
                        '<span style="font-size:.9rem;font-weight:700;color:#4ade80;' +
                        'padding:.3rem .5rem;background:rgba(74,222,128,.12);' +
                        'border-radius:8px">' + escaparHtml(texto) + '</span>';
                }
            });
        }
    };

    function escaparHtml(s) {
        return String(s == null ? '' : s)
            .replace(/&/g, '&amp;').replace(/</g, '&lt;')
            .replace(/>/g, '&gt;').replace(/"/g, '&quot;');
    }

    // Animación de entrada (se inyecta una vez)
    if (!document.getElementById('wifiBannerStyle')) {
        var st = document.createElement('style');
        st.id = 'wifiBannerStyle';
        st.textContent = '@keyframes wifiSube{from{transform:translateY(24px);opacity:0}' +
                         'to{transform:translateY(0);opacity:1}}';
        (document.head || document.documentElement).appendChild(st);
    }

    // Al arrancar, si la página se abrió desde un QR de mesa, se ofrece el wifi.
    document.addEventListener('DOMContentLoaded', function () {
        var params = new URLSearchParams(window.location.search);
        if (params.get('mesa')) {
            // Con retraso: primero que cargue el menú, para no taparlo.
            setTimeout(function () { window.mostrarOfertaWifi(); }, 1800);
        }
    });
})();
