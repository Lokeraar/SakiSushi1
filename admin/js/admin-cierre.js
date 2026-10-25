// admin-cierre.js — Cerrar el local por duelo, feriado, inventario o lo que sea
//
// CÓMO FUNCIONA
//
// El admin elige uno de tres modos:
//
//   HOY          cierra desde ahora, sin fecha de fin. Se reabre a mano.
//   DESDE/HASTA  cierra una ventana concreta. Se puede programar a futuro:
//                cargar el cierre del lunes un viernes.
//   DESACTIVADO  reabre. Deja de bloquear y los pedidos vuelven a entrar.
//
// EL CANDADO NO ESTÁ ACÁ
//
// Este archivo solo maneja el panel. El bloqueo real vive en la base:
// `crear_pedido_con_reserva()` y `crear_reserva()` se niegan a crear nada si
// el local está cerrado. Aunque alguien tenga la página abierta desde ayer,
// el pedido no entra.
//
// SOLO ADMIN
//
// El cajero no puede cerrar ni reabrir: eso es un dato del negocio. La base lo
// valida también (`es_admin()`), así que aunque alguien llame la función a
// mano, la rechaza.

(function () {
    'use strict';

    var _modoActual = 'hoy';

    // ============================================================
    // Sugerencias
    // ============================================================
    //
    // El mensaje lo escribe el admin, siempre. Esto es solo para no arrancar
    // con el campo en blanco. "Cerrado por duelo" no se lee igual que
    // "volvemos el lunes por inventario", y solo el dueño sabe cuál toca.
    var MOTIVOS = [
        'Duelo familiar',
        'Feriado nacional',
        'Inventario',
        'Mantenimiento',
        'Falla de servicio (luz/agua)',
        'Vacaciones del personal',
        'Evento privado'
    ];

    var MENSAJES = [
        'Hoy el local permanece cerrado. Volvemos apenas nos sea posible.',
        'Cerrado por feriado. Abrimos en nuestro horario habitual.',
        'Estamos haciendo inventario. Volvemos mañana con todo listo.',
        'Cerrado por mantenimiento. Disculpe las molestias.',
        'Hoy no podremos atender. Gracias por su comprensión.'
    ];

    function pintarSugerencias() {
        var contM = document.getElementById('cierreSugerenciasMotivo');
        var contMsg = document.getElementById('cierreSugerenciasMensaje');
        if (contM && !contM.dataset.listo) {
            contM.dataset.listo = '1';
            contM.innerHTML = MOTIVOS.map(function (m) {
                return '<button type="button" onclick="window._usarSugerencia(\'motivo\',' +
                    JSON.stringify(m).replace(/"/g, '&quot;') + ')" ' +
                    'style="font-size:.68rem;padding:.15rem .45rem;border-radius:10px;border:1px solid rgba(255,255,255,.18);' +
                    'background:transparent;color:inherit;cursor:pointer;opacity:.75">' + m + '</button>';
            }).join('');
        }
        if (contMsg && !contMsg.dataset.listo) {
            contMsg.dataset.listo = '1';
            contMsg.innerHTML = MENSAJES.map(function (m, i) {
                return '<button type="button" onclick="window._usarSugerencia(\'mensaje\',' + i + ')" ' +
                    'style="font-size:.68rem;padding:.15rem .45rem;border-radius:10px;border:1px solid rgba(255,255,255,.18);' +
                    'background:transparent;color:inherit;cursor:pointer;opacity:.75">' +
                    m.slice(0, 32) + '…</button>';
            }).join('');
        }
    }

    window._usarSugerencia = function (campo, valor) {
        if (campo === 'motivo') {
            document.getElementById('cierreMotivo').value = valor;
        } else {
            document.getElementById('cierreMensaje').value = MENSAJES[valor] || '';
        }
    };

    // ============================================================
    // Modos
    // ============================================================

    window._cierreModo = function (modo) {
        _modoActual = modo;
        var rango = document.getElementById('cierreRangoFechas');
        var campos = document.getElementById('cierreCampos');
        var form = document.getElementById('cierreForm');

        document.querySelectorAll('.cierre-modo').forEach(function (b) {
            var on = b.dataset.modo === modo;
            b.style.background = on ? 'rgba(239,68,68,.85)' : '';
            b.style.color = on ? '#fff' : '';
            b.style.borderColor = on ? 'transparent' : '';
            b.style.fontWeight = on ? '700' : '';
        });

        if (modo === 'desactivado') {
            // "Desactivado" no es un formulario: es una acción directa.
            if (rango) rango.style.display = 'none';
            if (campos) campos.style.display = 'none';
            window.desactivarCierre();
            return;
        }

        if (campos) campos.style.display = '';
        if (rango) rango.style.display = (modo === 'rango') ? '' : 'none';
        pintarSugerencias();
    };

    // ============================================================
    // Estado actual
    // ============================================================

    window.cargarEstadoCierre = async function () {
        if (!window.supabaseClient) return null;
        try {
            var { data, error } = await window.supabaseClient
                .rpc('cierre_vigente');
            if (error) throw error;

            var cierre = (data && data.length) ? data[0] : null;
            window._cierreActual = cierre;
            window.renderizarEstadoCierre(cierre);
            return cierre;
        } catch (e) {
            console.warn('[cierre] no se pudo leer el estado:', e.message);
            return null;
        }
    };

    window.renderizarEstadoCierre = function (cierre) {
        var chip = document.getElementById('cierreEstadoChip');
        var box = document.getElementById('cierreVigenteBox');
        var form = document.getElementById('cierreForm');

        if (!chip || !box) return;

        if (cierre) {
            chip.textContent = 'Cerrado';
            chip.style.background = 'rgba(239,68,68,.18)';
            chip.style.color = '#fca5a5';

            document.getElementById('cierreVigenteMotivo').textContent = cierre.motivo || 'Cerrado';
            document.getElementById('cierreVigenteMensaje').textContent = '«' + (cierre.mensaje || '') + '»';

            var fechas = [];
            if (cierre.desde) fechas.push('desde ' + new Date(cierre.desde).toLocaleString('es-VE'));
            if (cierre.hasta) fechas.push('hasta ' + new Date(cierre.hasta).toLocaleString('es-VE'));
            document.getElementById('cierreVigenteFechas').textContent =
                fechas.length ? fechas.join(' · ') : 'sin fecha de fin, hasta desactivarlo';

            box.style.display = '';
            if (form) form.style.display = 'none';
        } else {
            chip.textContent = 'Abierto';
            chip.style.background = 'rgba(74,222,128,.15)';
            chip.style.color = '#4ade80';
            box.style.display = 'none';
            if (form) form.style.display = '';
            pintarSugerencias();
        }
    };

    // ============================================================
    // Cerrar
    // ============================================================

    function aIso(v) {
        if (!v) return null;
        var d = new Date(v);
        return isNaN(d.getTime()) ? null : d.toISOString();
    }

    window.crearCierre = async function () {
        if (!window.supabaseClient) return;

        var motivo = (document.getElementById('cierreMotivo').value || '').trim();
        var mensaje = (document.getElementById('cierreMensaje').value || '').trim();
        var desde = null, hasta = null;

        if (!mensaje) {
            window.mostrarToast('⚠️ Escriba el mensaje que verá el cliente', 'warning');
            document.getElementById('cierreMensaje').focus();
            return;
        }

        if (_modoActual === 'rango') {
            desde = aIso(document.getElementById('cierreDesde').value);
            hasta = aIso(document.getElementById('cierreHasta').value);
            if (desde && hasta && new Date(hasta) <= new Date(desde)) {
                window.mostrarToast('⚠️ La fecha de fin tiene que ser posterior a la de inicio', 'warning');
                return;
            }
            if (!desde) {
                window.mostrarToast('⚠️ Indique desde cuándo rige el cierre', 'warning');
                return;
            }
        }

        // Confirmación: cerrar el local deja sin pedidos a todo el que entre.
        // No es un botón para tocar de paso.
        var cuando = (_modoActual === 'hoy')
            ? 'desde ahora y sin fecha de fin'
            : ('desde ' + new Date(desde).toLocaleString('es-VE') +
               (hasta ? (' hasta ' + new Date(hasta).toLocaleString('es-VE')) : ' sin fecha de fin'));

        var ok = await window._confirmarCierre(cuando);
        if (!ok) return;

        try {
            var { data, error } = await window.supabaseClient.rpc('crear_cierre_local', {
                p_motivo: motivo || 'Cierre del local',
                p_mensaje: mensaje,
                p_desde: desde,
                p_hasta: hasta
            });
            if (error) throw error;

            if (data && data.success === false) {
                window.mostrarToast('⚠️ ' + data.error, 'warning');
                return;
            }

            window.mostrarToast('🔒 Local cerrado. Los pedidos quedan bloqueados.', 'success');
            document.getElementById('cierreMensaje').value = '';
            document.getElementById('cierreMotivo').value = '';
            await window.cargarEstadoCierre();

        } catch (e) {
            window.mostrarToast('⚠️ No se pudo cerrar: ' + (e.message || e), 'error');
        }
    };

    // Diálogo de confirmación armado a mano.
    //
    // Cerrar el local deja sin pedidos a todo el que entre, así que no puede
    // ser un botón que se toca de paso. Devuelve una promesa: true si el admin
    // confirma, false si cancela o toca fuera.
    window._confirmarCierre = function (cuando) {
        return new Promise(function (resolve) {
            var ov = document.createElement('div');
            ov.style.cssText = 'position:fixed;inset:0;background:rgba(0,0,0,.7);z-index:99999;' +
                'display:flex;align-items:center;justify-content:center;padding:1rem';

            var caja = document.createElement('div');
            caja.style.cssText = 'background:#1e293b;border-radius:14px;padding:1.25rem;max-width:360px;' +
                'width:100%;box-shadow:0 12px 40px rgba(0,0,0,.55);color:#e2e8f0';
            caja.innerHTML =
                '<div style="font-size:1.05rem;font-weight:700;margin-bottom:.6rem">¿Cerrar el local?</div>' +
                '<div style="font-size:.88rem;opacity:.9;line-height:1.5;margin-bottom:1rem">' +
                  'Los clientes van a poder <strong>ver el menú</strong>, pero ' +
                  '<strong>no van a poder hacer pedidos</strong> ' + cuando + '.' +
                '</div>' +
                '<div style="font-size:.8rem;opacity:.65;line-height:1.45;margin-bottom:1.1rem">' +
                  'Para volver a abrir tiene que entrar acá y tocar "Desactivar bloqueo".' +
                '</div>';

            var fila = document.createElement('div');
            fila.style.cssText = 'display:flex;gap:.5rem';

            var cancelar = document.createElement('button');
            cancelar.type = 'button';
            cancelar.textContent = 'Cancelar';
            cancelar.style.cssText = 'flex:1;padding:.55rem;border-radius:8px;border:1px solid rgba(255,255,255,.2);' +
                'background:transparent;color:inherit;font-size:.88rem;cursor:pointer';

            var aceptar = document.createElement('button');
            aceptar.type = 'button';
            aceptar.textContent = 'Sí, cerrar';
            aceptar.style.cssText = 'flex:1;padding:.55rem;border-radius:8px;border:none;' +
                'background:#ef4444;color:#fff;font-size:.88rem;font-weight:700;cursor:pointer';

            function cerrar(valor) {
                if (ov.parentNode) ov.parentNode.removeChild(ov);
                resolve(valor);
            }

            cancelar.addEventListener('click', function () { cerrar(false); });
            aceptar.addEventListener('click', function () { cerrar(true); });
            // Tocar el fondo oscuro cancela, que es lo seguro.
            ov.addEventListener('click', function (e) { if (e.target === ov) cerrar(false); });

            fila.appendChild(cancelar);
            fila.appendChild(aceptar);
            caja.appendChild(fila);
            ov.appendChild(caja);
            document.body.appendChild(ov);
        });
    };

    // ============================================================
    // Reabrir
    // ============================================================

    window.desactivarCierre = async function () {
        if (!window.supabaseClient) return;
        try {
            var { data, error } = await window.supabaseClient
                .rpc('desactivar_cierre_local', { p_id: null });
            if (error) throw error;

            if (data && data.success === false) {
                window.mostrarToast('⚠️ ' + data.error, 'warning');
                return;
            }

            window.mostrarToast('🔓 Local abierto. Ya se pueden hacer pedidos.', 'success');
            await window.cargarEstadoCierre();

        } catch (e) {
            window.mostrarToast('⚠️ No se pudo reabrir: ' + (e.message || e), 'error');
        }
    };


})();
