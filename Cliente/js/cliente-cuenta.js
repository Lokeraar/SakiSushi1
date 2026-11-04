/**
 * Cuenta del cliente: registrarse, entrar y salir.
 *
 * QUÉ ES ESTO Y QUÉ NO ES
 *
 * La carta funciona SIN cuenta. Un cliente puede pedir toda su vida como
 * anónimo: el teléfono guarda una ficha firmada y eso alcanza para crear el
 * pedido, ver su historial y recibir la campanita. La cuenta es OPCIONAL, y
 * solo agrega una cosa: si cambia de teléfono, sus pedidos la siguen.
 *
 * Por eso el registro nunca aparece como una pared. No hay "regístrate para
 * continuar". El botón está en el encabezado, y quien no lo toca nunca lo
 * necesita.
 *
 * EL MENSAJE CUANDO FALLA
 *
 * Si el inicio de sesión falla, el cliente NO pierde nada: sigue como
 * anónimo con su ficha intacta y puede pedir igual. El texto que se muestra
 * es "No se pudo iniciar sesión, aún puedes hacer y recibir tu pedido".
 * Decirlo así evita que alguien crea que se quedó sin poder pedir.
 */
(function () {
    'use strict';

    var modalListo = false;

    function $(id) { return document.getElementById(id); }

    function mostrarToast(mensaje, tipo) {
        if (typeof window.mostrarToast === 'function') {
            window.mostrarToast(mensaje, tipo || 'info');
        } else {
            console.log('[cuenta] ' + mensaje);
        }
    }

    // ══════════════════════════════════════════════════════════════
    //  Construcción del modal
    // ══════════════════════════════════════════════════════════════

    function construirModal() {
        if (modalListo || $('cuentaModal')) return;

        var overlay = document.createElement('div');
        overlay.className = 'modal-overlay';
        overlay.id = 'cuentaModal';
        overlay.innerHTML =
            '<div class="modal-container">' +
              '<div class="modal-header">' +
                '<h3><i class="fas fa-user-circle"></i> <span id="cuentaTitulo">Mi cuenta</span></h3>' +
                '<button class="modal-close" id="cerrarCuentaModal" type="button">&times;</button>' +
              '</div>' +
              '<div class="modal-body">' +

                // ── Vista: ya hay sesión ──
                '<div id="cuentaVistaSesion" style="display:none">' +
                  '<p style="margin:0 0 .25rem;font-size:.9rem;opacity:.8">Sesión iniciada como</p>' +
                  '<p id="cuentaCorreo" style="margin:0 0 1rem;font-size:1rem;font-weight:600;word-break:break-all"></p>' +
                  '<p style="margin:0 0 1rem;font-size:.88rem;opacity:.75;line-height:1.5">' +
                    'Tus pedidos quedan guardados en esta cuenta. Si cambias de teléfono, ' +
                    'entras con el mismo correo y los recuperas.' +
                  '</p>' +
                  '<button class="btn-primary" id="btnVerMisPedidos" type="button" ' +
                          'style="width:100%;margin-bottom:.5rem">' +
                    '<i class="fas fa-receipt"></i> Ver mis pedidos' +
                  '</button>' +
                  '<button type="button" id="btnCerrarSesionCliente" ' +
                          'style="width:100%;background:none;border:1px solid rgba(255,255,255,.25);' +
                          'color:inherit;border-radius:var(--radius-sm);padding:.7rem;font-size:.9rem;cursor:pointer">' +
                    'Cerrar sesión' +
                  '</button>' +
                '</div>' +

                // ── Vista: formulario ──
                '<div id="cuentaVistaForm">' +
                  '<p style="margin:0 0 1rem;font-size:.88rem;opacity:.75;line-height:1.5">' +
                    'Con una cuenta, tus pedidos te siguen si cambias de teléfono. ' +
                    'Puedes pedir sin cuenta cuando quieras.' +
                  '</p>' +

                  '<div id="cuentaError" role="alert" style="display:none;background:rgba(239,68,68,.15);' +
                       'border:1px solid rgba(239,68,68,.4);border-radius:var(--radius-sm);' +
                       'padding:.7rem;margin-bottom:.9rem;font-size:.88rem;line-height:1.4"></div>' +

                  '<label for="cuentaCorreoInput" style="display:block;font-size:.85rem;' +
                         'margin-bottom:.3rem;opacity:.85">Correo</label>' +
                  '<input type="email" id="cuentaCorreoInput" autocomplete="email" ' +
                         'inputmode="email" placeholder="nombre@correo.com" ' +
                         'style="width:100%;box-sizing:border-box;padding:.7rem;margin-bottom:.8rem;' +
                         'border-radius:var(--radius-sm);border:1px solid rgba(255,255,255,.2);' +
                         'background:rgba(0,0,0,.25);color:inherit;font-size:1rem">' +

                  '<label for="cuentaClaveInput" style="display:block;font-size:.85rem;' +
                         'margin-bottom:.3rem;opacity:.85">Contraseña</label>' +
                  '<input type="password" id="cuentaClaveInput" autocomplete="current-password" ' +
                         'placeholder="Al menos 6 caracteres" ' +
                         'style="width:100%;box-sizing:border-box;padding:.7rem;margin-bottom:1rem;' +
                         'border-radius:var(--radius-sm);border:1px solid rgba(255,255,255,.2);' +
                         'background:rgba(0,0,0,.25);color:inherit;font-size:1rem">' +

                  '<button class="btn-primary" id="btnEntrarCuenta" type="button" ' +
                          'style="width:100%;margin-bottom:.5rem">' +
                    '<i class="fas fa-sign-in-alt"></i> <span id="btnEntrarTexto">Iniciar sesión</span>' +
                  '</button>' +

                  '<div style="margin:.5rem 0;border-top:1px solid rgba(255,255,255,.12);padding-top:.5rem;font-size:.85rem;opacity:.8;text-align:center">' +
                    'O sigue con' +
                  '</div>' +

                  '<button class="btn-secondary" id="btnGoogleCuenta" type="button" ' +
                          'style="width:100%;margin-bottom:.5rem;border:1px solid rgba(255,255,255,.25);' +
                          'background:rgba(255,255,255,.08);color:inherit;border-radius:var(--radius-sm);' +
                          'padding:.7rem;font-size:.9rem;cursor:pointer;display:flex;align-items:center;justify-content:center;gap:.5rem">' +
                    '<i class="fab fa-google"></i> Entrar con Google' +
                  '</button>' +

                  '<button type="button" id="btnCambiarModoCuenta" ' +
                          'style="width:100%;background:none;border:none;color:var(--accent);' +
                          'padding:.6rem;font-size:.9rem;cursor:pointer;text-decoration:underline">' +
                    'No tengo cuenta, quiero crear una' +
                  '</button>' +
                '</div>' +

              '</div>' +
            '</div>';

        document.body.appendChild(overlay);
        modalListo = true;

        // ── Enlaces ──
        $('cerrarCuentaModal').addEventListener('click', cerrar);
        overlay.addEventListener('click', function (e) {
            if (e.target === overlay) cerrar();
        });

        $('btnCambiarModoCuenta').addEventListener('click', alternarModo);
        $('btnEntrarCuenta').addEventListener('click', enviarFormulario);
        $('btnGoogleCuenta').addEventListener('click', iniciarConGoogle);
        $('btnVerMisPedidos').addEventListener('click', abrirMisPedidos);
        $('btnCerrarSesionCliente').addEventListener('click', salir);

        // Enter en cualquiera de los dos campos envía.
        ['cuentaCorreoInput', 'cuentaClaveInput'].forEach(function (id) {
            var el = $(id);
            if (!el) return;
            el.addEventListener('keydown', function (e) {
                if (e.key === 'Enter') {
                    e.preventDefault();
                    enviarFormulario();
                }
            });
        });
    }

    var modoRegistro = false;

    function alternarModo() {
        modoRegistro = !modoRegistro;
        ocultarError();
        if (modoRegistro) {
            $('cuentaTitulo').textContent = 'Crear cuenta';
            $('btnEntrarTexto').textContent = 'Crear cuenta';
            $('cuentaClaveInput').setAttribute('autocomplete', 'new-password');
            $('btnCambiarModoCuenta').textContent = 'Ya tengo cuenta, quiero entrar';
        } else {
            $('cuentaTitulo').textContent = 'Entrar';
            $('btnEntrarTexto').textContent = 'Iniciar sesión';
            $('cuentaClaveInput').setAttribute('autocomplete', 'current-password');
            $('btnCambiarModoCuenta').textContent = 'No tengo cuenta, quiero crear una';
        }
    }

    function mostrarError(texto) {
        var caja = $('cuentaError');
        if (!caja) return;
        caja.textContent = texto;
        caja.style.display = 'block';
    }

    function ocultarError() {
        var caja = $('cuentaError');
        if (caja) { caja.style.display = 'none'; caja.textContent = ''; }
    }

    function bloquear(activo, texto) {
        var btn = $('btnEntrarCuenta');
        if (!btn) return;
        btn.disabled = !!activo;
        $('btnEntrarTexto').textContent = texto || (modoRegistro ? 'Crear cuenta' : 'Iniciar sesión');
    }

    // ══════════════════════════════════════════════════════════════
    //  Acciones
    // ══════════════════════════════════════════════════════════════

    function enviarFormulario() {
        if (!window.SakiCliente) {
            mostrarError('La aplicación no terminó de cargar. Cierra y vuelve a abrir.');
            return;
        }
        var correo = ($('cuentaCorreoInput') || {}).value || '';
        var clave = ($('cuentaClaveInput') || {}).value || '';

        ocultarError();
        bloquear(true, modoRegistro ? 'Creando cuenta...' : 'Entrando...');

        var accion = modoRegistro
            ? window.SakiCliente.registrar(correo, clave)
            : window.SakiCliente.iniciarSesion(correo, clave);

        accion.then(function (r) {
            bloquear(false);

            // Registro que pide confirmar el correo: todavía no hay sesión, así
            // que NO se cierra el modal (cerrarlo dejaría a la persona sin saber
            // qué pasó). Se queda abierto en modo "entrar" con el aviso arriba,
            // lista para que vuelva cuando haya confirmado.
            if (r && r.requiereConfirmacion) {
                modoRegistro = false;
                if ($('cuentaTitulo')) $('cuentaTitulo').textContent = 'Revisa tu correo';
                if ($('btnEntrarTexto')) $('btnEntrarTexto').textContent = 'Iniciar sesión';
                if ($('btnCambiarModoCuenta')) {
                    $('btnCambiarModoCuenta').textContent = 'No tengo cuenta, quiero crear una';
                }
                mostrarError(r.mensaje);
                return;
            }

            var cuantos = r && r.reclamados && r.reclamados.pedidos;
            if (cuantos > 0) {
                mostrarToast('✅ Entraste. Recuperamos ' + cuantos +
                    (cuantos === 1 ? ' pedido tuyo' : ' pedidos tuyos') + '.', 'success');
            } else {
                mostrarToast('✅ Sesión iniciada', 'success');
            }

            refrescarEncabezado();
            cerrar();

            // El formulario queda limpio para la próxima vez. El correo se
            // conserva: es lo que la persona vuelve a escribir al entrar.
            var clave = $('cuentaClaveInput');
            if (clave) clave.value = '';
            ocultarError();

            // El botón de "pedidos anteriores" se recalcula: con sesión, el
            // historial que se muestra es el de la cuenta.
            if (typeof window.actualizarBotonHistorial === 'function') {
                try { window.actualizarBotonHistorial(); } catch (e) { /* no crítico */ }
            }

        }).catch(function (e) {
            bloquear(false);
            // El mensaje acordado: el cliente NO se queda sin poder pedir.
            var propio = e && e.message ? e.message : 'No se pudo iniciar sesión.';
            mostrarError(propio + ' Aún puedes hacer y recibir tu pedido sin cuenta.');
        });
    }

    function iniciarConGoogle() {
        cerrar();
        if (window.SakiCliente && typeof window.SakiCliente.iniciarConGoogle === 'function') {
            window.SakiCliente.iniciarConGoogle();
        } else {
            mostrarError('La aplicación no terminó de cargar. Cierra y vuelve a abrir.');
        }
    }

    function salir() {
        if (!window.SakiCliente) return;

        var boton = $('btnCerrarSesionCliente');
        if (boton) { boton.disabled = true; boton.textContent = 'Cerrando...'; }

        // `cerrarSesion()` ya no espera a la red: suelta el token guardado y
        // vuelve al cliente anónimo. Antes llamaba a `signOut()` de GoTrue y la
        // promesa se quedaba colgada, así que este `.then()` nunca corría y el
        // modal se quedaba abierto como si el botón no hiciera nada.
        window.SakiCliente.cerrarSesion().then(function () {
            mostrarToast('Sesión cerrada. Sigues navegando como invitado.', 'info');
            refrescarEncabezado();
            cerrar();

            // Dejar el formulario listo para volver a entrar. Sin esto, al
            // abrir el modal otra vez quedaban el correo y la contraseña de la
            // sesión anterior, y `modoRegistro` podía seguir en `true`.
            reiniciarFormulario();

            if (typeof window.actualizarBotonHistorial === 'function') {
                try { window.actualizarBotonHistorial(); } catch (e) { /* no crítico */ }
            }
        }).catch(function () {
            // Aunque algo falle, la sesión local ya se soltó: se cierra igual.
            mostrarToast('Sesión cerrada. Sigues navegando como invitado.', 'info');
            refrescarEncabezado();
            cerrar();
            reiniciarFormulario();
        });
    }

    /**
     * Deja el formulario como recién abierto.
     *
     * Se llama al cerrar sesión y al abrir el modal sin sesión. Es un solo
     * lugar para que no se desincronicen el título, el texto del botón, el
     * modo y los campos.
     */
    function reiniciarFormulario() {
        modoRegistro = false;
        ocultarError();
        if ($('cuentaTitulo')) $('cuentaTitulo').textContent = 'Entrar';
        if ($('btnEntrarTexto')) $('btnEntrarTexto').textContent = 'Iniciar sesión';
        if ($('btnCambiarModoCuenta')) {
            $('btnCambiarModoCuenta').textContent = 'No tengo cuenta, quiero crear una';
        }
        if ($('cuentaClaveInput')) {
            $('cuentaClaveInput').value = '';
            $('cuentaClaveInput').setAttribute('autocomplete', 'current-password');
        }
        bloquear(false);

        // Se recuerda el correo con el que se entró antes, para que al volver
        // solo haga falta la contraseña. La contraseña NUNCA se guarda.
        var correoInput = $('cuentaCorreoInput');
        if (correoInput && !correoInput.value && window.SakiCliente &&
            typeof window.SakiCliente.ultimoCorreo === 'function') {
            try { correoInput.value = window.SakiCliente.ultimoCorreo() || ''; } catch (e) {}
        }
    }

    function abrirMisPedidos() {
        cerrar();
        if (typeof window.abrirHistorialPedidos === 'function') {
            window.abrirHistorialPedidos();
        }
    }

    function mostrarVistaSesion(usuario) {
        var conSesion = !!(usuario && usuario.id);
        var vistaForm = $('cuentaVistaForm');
        var vistaSesion = $('cuentaVistaSesion');
        var titulo = $('cuentaTitulo');
        if (!vistaForm || !vistaSesion) return;

        vistaForm.style.display = conSesion ? 'none' : 'block';
        vistaSesion.style.display = conSesion ? 'block' : 'none';

        // El título manda la vista. Antes se quedaba en "Crear cuenta" porque
        // lo había puesto `alternarModo()` y nadie lo devolvía: con sesión
        // iniciada el modal decía "Crear cuenta" arriba y "Sesión iniciada"
        // abajo, que es justo lo contrario de lo que está pasando.
        if (titulo) titulo.textContent = conSesion ? 'Mi cuenta' : 'Entrar';

        if (conSesion) {
            $('cuentaCorreo').textContent = usuario.correo || 'Cuenta';
            $('btnVerMisPedidos').style.display = 'block';
        }
    }

    // ══════════════════════════════════════════════════════════════
    //  Entrada y encabezado
    // ══════════════════════════════════════════════════════════════

    function abrir() {
        construirModal();

        var usuario = window.SakiCliente ? window.SakiCliente.usuario() : null;

        if (usuario) {
            ocultarError();
            mostrarVistaSesion(usuario);
            // El botón de salir vuelve a estar activo: pudo quedar en
            // "Cerrando..." si se cerró el modal a mitad de la operación.
            var botonSalir = $('btnCerrarSesionCliente');
            if (botonSalir) { botonSalir.disabled = false; botonSalir.textContent = 'Cerrar sesión'; }
        } else {
            // Sin sesión, el formulario arranca siempre limpio y en modo
            // "entrar". Si venía de crear cuenta o de cerrar sesión, no arrastra
            // ese estado.
            if ($('cuentaVistaForm')) $('cuentaVistaForm').style.display = 'block';
            if ($('cuentaVistaSesion')) $('cuentaVistaSesion').style.display = 'none';
            reiniciarFormulario();
        }

        $('cuentaModal').classList.add('active');

        // El cursor arranca donde toca: en la contraseña si el correo ya está
        // puesto, en el correo si está vacío.
        var correoInput = $('cuentaCorreoInput');
        var claveInput = $('cuentaClaveInput');
        var enfocar = correoInput && correoInput.value ? claveInput : correoInput;
        if (enfocar) setTimeout(function () { try { enfocar.focus(); } catch (e) {} }, 120);
    }

    function cerrar() {
        var m = $('cuentaModal');
        if (m) m.classList.remove('active');
    }

    /**
     * Pinta el botón del encabezado según haya sesión o no.
     *
     * El icono cambia pero el botón nunca desaparece: si alguien ya está
     * registrado y el botón se escondiera, no tendría por dónde cerrar sesión.
     */
    function refrescarEncabezado() {
        var btn = document.getElementById('btnCuentaCliente');
        if (!btn) return;
        var usuario = window.SakiCliente ? window.SakiCliente.usuario() : null;

        if (usuario) {
            btn.innerHTML = '<i class="fas fa-user-check"></i>';
            btn.setAttribute('data-tooltip', 'Mi cuenta');
            btn.setAttribute('aria-label', 'Mi cuenta');
            btn.style.color = 'var(--accent)';
        } else {
            btn.innerHTML = '<i class="fas fa-user-circle"></i>';
            btn.setAttribute('data-tooltip', 'Entrar o crear cuenta');
            btn.setAttribute('aria-label', 'Entrar o crear cuenta');
            btn.style.color = '';
        }
    }

    function iniciar() {
        construirModal();
        refrescarEncabezado();
        var btn = document.getElementById('btnCuentaCliente');
        if (btn) btn.addEventListener('click', abrir);
    }

    if (document.readyState === 'loading') {
        document.addEventListener('DOMContentLoaded', iniciar);
    } else {
        iniciar();
    }

    window.SakiCuenta = {
        abrir: abrir,
        cerrar: cerrar,
        refrescarEncabezado: refrescarEncabezado
    };
})();
