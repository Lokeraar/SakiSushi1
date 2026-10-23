// cliente-mesonero.js — Acceso del mesonero por PIN de 4 dígitos
//
// CÓMO FUNCIONA (definido por el dueño)
//
//   El emoji 🤵🏻‍♂️ del Hero abre un modal titulado "Soy mesonero".
//   El mesonero escribe 4 dígitos y el sistema RECONOCE SOLO a quién
//   corresponde: no se elige de una lista.
//   Al validar, el mesonero queda identificado y su nombre aparece en la
//   interfaz, y sus pedidos llevan "Atendido por: (nombre)".
//
// POR QUÉ EL PIN NO SE VALIDA EN EL NAVEGADOR
//
// Invariante del proyecto: la validación de credenciales va en el servidor,
// nunca en el cliente. `pin_hash` no sale nunca de la base. El navegador
// manda el PIN y el servidor responde con la identidad o con un error.
//
// Esa función (`verificar_pin_mesonero`) tiene protección de intentos: un
// PIN de 4 dígitos son solo 10.000 combinaciones, así que sin límite se
// rompe por fuerza bruta.

(function () {
    'use strict';

    var ID_MODAL = 'pinMesoneroModal';
    var CLAVE_SESION = 'saki_mesonero';

    // ============================================================
    // Sesión del mesonero
    // ============================================================

    function guardarSesion(m) {
        try {
            sessionStorage.setItem(CLAVE_SESION, JSON.stringify({
                id: m.mesonero_id,
                nombre: m.mesonero_nombre,
                foto: m.mesonero_foto || null,
                desde: Date.now()
            }));
        } catch (e) {}
    }

    window.obtenerMesoneroActual = function () {
        try {
            var raw = sessionStorage.getItem(CLAVE_SESION);
            return raw ? JSON.parse(raw) : null;
        } catch (e) { return null; }
    };

    window.cerrarSesionMesonero = function () {
        try { sessionStorage.removeItem(CLAVE_SESION); } catch (e) {}
        window.actualizarUiMesonero();
        if (window.mostrarToast) window.mostrarToast('Sesión de mesonero cerrada', 'info');
    };

    /** Muestra u oculta el distintivo "Atendido por: X". */
    window.actualizarUiMesonero = function () {
        var m = window.obtenerMesoneroActual();
        var chip = document.getElementById('mesoneroChip');

        if (m) {
            if (!chip) {
                chip = document.createElement('div');
                chip.id = 'mesoneroChip';
                chip.style.cssText =
                    'display:flex;align-items:center;gap:.4rem;background:rgba(255,152,0,.15);' +
                    'border:1px solid rgba(255,152,0,.4);border-radius:20px;' +
                    'padding:.25rem .6rem;font-size:.78rem;margin:.4rem auto 0;width:fit-content';
                var hero = document.querySelector('.logo-area');
                if (hero && hero.parentNode) hero.parentNode.insertBefore(chip, hero.nextSibling);
                else document.body.appendChild(chip);
            }
            chip.innerHTML = '<span>🤵🏻‍♂️</span><span>Atendido por: <strong>' +
                m.nombre + '</strong></span>' +
                '<button onclick="cerrarSesionMesonero()" title="Salir" ' +
                'style="background:none;border:none;color:inherit;cursor:pointer;opacity:.6;font-size:.9rem">✕</button>';
            chip.style.display = 'flex';

            // El emoji del Hero deja de ofrecer login: ya hay sesión.
            var btn = document.getElementById('btnMesonero');
            if (btn) btn.title = 'Atendido por: ' + m.nombre;
        } else if (chip) {
            chip.style.display = 'none';
            var btn2 = document.getElementById('btnMesonero');
            if (btn2) btn2.title = 'Soy mesonero';
        }
    };

    // ============================================================
    // Modal del PIN
    // ============================================================

    function cerrarModal() {
        var el = document.getElementById(ID_MODAL);
        if (el && el.parentNode) el.parentNode.removeChild(el);
    }
    window.cerrarModalPinMesonero = cerrarModal;

    window.abrirModalPinMesonero = function () {
        // Si ya hay sesión, se ofrece cerrarla en vez de pedir el PIN otra vez.
        var actual = window.obtenerMesoneroActual();
        if (actual) {
            if (confirm('Ya estás como ' + actual.nombre + '. ¿Cerrar la sesión de mesonero?')) {
                window.cerrarSesionMesonero();
            }
            return;
        }

        if (document.getElementById(ID_MODAL)) return;

        var overlay = document.createElement('div');
        overlay.className = 'modal-overlay active';
        overlay.id = ID_MODAL;
        overlay.innerHTML =
            '<div class="confirm-dialog" style="max-width:340px">' +
              '<div style="font-size:2.4rem;line-height:1">🤵🏻‍♂️</div>' +
              '<h3>Soy mesonero</h3>' +
              '<p style="font-size:.85rem;opacity:.8;margin-bottom:1rem">' +
                'Ingresá tu PIN de 4 dígitos' +
              '</p>' +
              '<input id="pinMesoneroInput" type="password" inputmode="numeric" ' +
                'pattern="[0-9]*" maxlength="4" autocomplete="off" ' +
                'style="width:100%;max-width:200px;margin:0 auto .5rem;display:block;' +
                'padding:.8rem 1rem;font-size:1.8rem;font-weight:700;text-align:center;' +
                'letter-spacing:.6rem;border:2px solid rgba(255,255,255,.2);border-radius:12px;' +
                'background:rgba(0,0,0,.25);color:inherit;outline:none;box-sizing:border-box">' +
              '<div id="pinMesoneroError" style="color:#ff6b6b;font-size:.8rem;' +
                'min-height:1.2rem;margin-bottom:.5rem"></div>' +
              '<div class="confirm-dialog-buttons">' +
                '<button class="btn-cancel" id="pinMesoneroCancelar">Cancelar</button>' +
                '<button class="btn-confirm" id="pinMesoneroConfirmar">Entrar</button>' +
              '</div>' +
            '</div>';

        document.body.appendChild(overlay);

        var input = document.getElementById('pinMesoneroInput');
        var error = document.getElementById('pinMesoneroError');
        var btnOk = document.getElementById('pinMesoneroConfirmar');

        // Solo dígitos, y enviar al llegar a 4 automáticamente
        input.addEventListener('input', function () {
            this.value = this.value.replace(/\D/g, '').slice(0, 4);
            error.textContent = '';
            if (this.value.length === 4) validar();
        });

        input.addEventListener('keydown', function (e) {
            if (e.key === 'Enter' && this.value.length === 4) validar();
            if (e.key === 'Escape') cerrarModal();
        });

        document.getElementById('pinMesoneroCancelar').addEventListener('click', cerrarModal);

        btnOk.addEventListener('click', validar);

        setTimeout(function () { input.focus(); }, 120);

        var _validando = false;

        async function validar() {
            if (_validando) return;
            var pin = input.value;
            if (pin.length !== 4) {
                error.textContent = 'Faltan dígitos';
                return;
            }

            _validando = true;
            btnOk.disabled = true;
            btnOk.textContent = 'Verificando...';

            try {
                if (!window.supabaseClient) {
                    error.textContent = 'Sin conexión. Intentá de nuevo.';
                    return;
                }

                // El PIN viaja al servidor; la identidad vuelve resuelta.
                var resp = await window.supabaseClient.rpc('verificar_pin_mesonero', { p_pin: pin });

                if (resp.error) {
                    error.textContent = 'No se pudo verificar. Intentá de nuevo.';
                    console.warn('[mesonero] error RPC:', resp.error.message);
                    return;
                }

                var data = resp.data;
                if (!data || data.success !== true) {
                    error.textContent = (data && data.error) || 'PIN incorrecto';
                    input.value = '';
                    input.focus();
                    return;
                }

                // Reconocido: se guarda la identidad y se cierra el modal.
                guardarSesion(data);
                cerrarModal();
                window.actualizarUiMesonero();

                var msg = '🤵🏻‍♂️ Hola, ' + data.mesonero_nombre + '. Ya estás identificado.';
                if (window.mostrarToast) window.mostrarToast(msg, 'success');
                else if (window.Saki && window.Saki.utils && window.Saki.utils.mostrarToast) {
                    window.Saki.utils.mostrarToast(msg, 'success');
                }
            } catch (e) {
                error.textContent = 'Error de conexión';
                console.warn('[mesonero] excepción:', e.message);
            } finally {
                _validando = false;
                btnOk.disabled = false;
                btnOk.textContent = 'Entrar';
            }
        }
    };

    // Al arrancar, si quedó una sesión de mesonero, mostrar el distintivo.
    document.addEventListener('DOMContentLoaded', function () {
        window.actualizarUiMesonero();
    });
})();
