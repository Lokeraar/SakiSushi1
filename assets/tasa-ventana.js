// tasa-ventana.js — La ventana del primer admin o cajero del día
//
// QUÉ PROBLEMA RESUELVE
//
// El BCV publica una tasa. El sistema la captura sola. Pero nadie la mira: el
// precio sigue saliendo de lo último que alguien guardó, que puede tener días.
//
// Antes, el primero que entraba al sistema tenía que acordarse de abrir el
// panel de tasa y revisar. Si no se acordaba, el restaurante cobraba con una
// tasa vieja hasta que alguien lo notara.
//
// Ahora, la primera persona del día —admin o cajero, la que sea— ve la tasa
// del BCV y su fecha valor, y decide una vez. Una sola vez para todo el
// restaurante: cuando confirma, la ventana se cierra en las demás
// computadoras.
//
// POR QUÉ EL CAJERO DECIDE Y NO SOLO EL ADMIN
//
// El dueño lo decidió: "accionable por cualquiera con rol admin" y el cajero
// abre la caja. Si el cajero no puede confirmar, y el admin llega a las 3 pm,
// el restaurante cobró cinco horas con la tasa de ayer. `exigir_cajero_o_admin`
// lo permite en la base.
//
// LO QUE ESTA VENTANA NO HACE
//
// No calcula nada, no aplica nada por su cuenta y no insiste. Si la persona
// cierra la ventana sin decidir, no vuelve a aparecer en todo el día. Ser
// intrusivo con quien atiende el mostrador es peor que una tasa sin revisar.
//
// DÓNDE ESTÁ LA REGLA
//
// Toda la lógica vive en `estado_revision_tasa()` y `confirmar_revision_tasa()`,
// en la migración 24. Este archivo solo pinta y manda la decisión.

(function () {
    'use strict';

    var _estado = null;
    var _idVentana = 'tasaVentanaOverlay';

    // ── Formato de fechas, igual que en el panel ──
    function fechaEnPalabras(iso) {
        if (!iso) return '—';
        var d = new Date(String(iso).slice(0, 10) + 'T12:00:00');
        if (isNaN(d)) return String(iso);
        var dias = ['domingo', 'lunes', 'martes', 'miércoles', 'jueves', 'viernes', 'sábado'];
        var dd = String(d.getDate()).padStart(2, '0');
        var mm = String(d.getMonth() + 1).padStart(2, '0');
        return dias[d.getDay()] + ' ' + dd + '/' + mm;
    }

    function cuandoFue(diasAtras) {
        var n = Number(diasAtras);
        if (isNaN(n)) return '';
        if (n === 0) return 'de hoy';
        if (n === 1) return 'de ayer';
        return 'hace ' + n + ' días';
    }

    function formatoBs(n) {
        return (typeof window.formatBs === 'function')
            ? window.formatBs(n)
            : 'Bs ' + Number(n || 0).toFixed(2);
    }

    // ============================================================
    // Consultar si hay que mostrar la ventana
    // ============================================================
    window.consultarVentanaTasa = async function () {
        try {
            if (!window.supabaseClient) return null;
            var r = await window.supabaseClient.rpc('estado_revision_tasa');
            if (r.error) {
                // 42883 / PGRST202: la migración 24 no está aplicada. La
                // ventana simplemente no existe y nada se rompe.
                if (r.error.code !== '42883' && r.error.code !== 'PGRST202') {
                    console.warn('estado_revision_tasa:', r.error.message);
                }
                return null;
            }
            _estado = r.data;
            return _estado;
        } catch (e) {
            console.warn('No se pudo consultar la ventana de tasa:', e.message);
            return null;
        }
    };

    // ============================================================
    // Mostrar la ventana, si corresponde
    // ============================================================
    //
    // `forzar` sirve para abrirla a mano desde el panel aunque ya se haya
    // revisado hoy: el admin tiene derecho a reconsiderar.
    window.abrirVentanaTasa = async function (forzar) {
        if (!forzar && document.getElementById(_idVentana)) return;

        var e = _estado || await window.consultarVentanaTasa();
        if (!e) return;

        // Sin tasa del BCV no hay nada que decidir. No se molesta a nadie.
        if (!forzar && !e.necesita_revision) return;

        // Ya hay una ventana abierta y sin forzar: no se duplica.
        if (document.getElementById(_idVentana)) return;

        var bcv       = e.bcv;
        var aplicada  = Number(e.aplicada || 0);
        var difBs     = Number(e.diferencia_bolivares || 0);
        var difPct    = Number(e.diferencia_porcentaje || 0);
        var esIgual   = Math.abs(difBs) < 0.01;

        // Aviso de antigüedad: si el dato no es de hoy, se dice antes que nada.
        // No es una confirmación extra, es una línea de contexto.
        var avisoViejo = '';
        if (e.captura_fallo_hoy) {
            avisoViejo =
                '<div class="tv-aviso tv-aviso-fallo">' +
                    'Hoy no se pudo capturar el BCV. Esta es la última tasa que tenemos.' +
                '</div>';
        } else if (e.dato_viejo) {
            avisoViejo =
                '<div class="tv-aviso">' +
                    'El BCV no publicó nada nuevo: este dato tiene ' +
                    (Number(e.antiguedad_dias) === 1 ? 'un día' : e.antiguedad_dias + ' días') +
                    '.' +
                '</div>';
        }

        // ── Encabezado, distinto si ya se revisó ──
        var titulo = e.ya_revisada
            ? 'La tasa del día ya fue revisada'
            : 'La tasa del BCV, antes de abrir';

        var sub = e.ya_revisada
            ? 'Revisada por ' + (e.revisada_por || 'alguien') + '. Podés cambiarla igual.'
            : 'Nadie la revisó todavía hoy. Es la única vez que este aviso va a aparecer.';

        // ── Bloque del BCV ──
        var bloqueBcv;
        if (!bcv) {
            bloqueBcv =
                '<div class="tv-caja tv-vacia">' +
                    '<div class="tv-titulo">Todavía no hay tasa del BCV</div>' +
                    '<div class="tv-nota">El sistema la busca de lunes a viernes a las 5 pm. ' +
                    'Si esto sigue así, revisá que el cron esté corriendo.</div>' +
                '</div>';
        } else {
            bloqueBcv =
                '<div class="tv-caja">' +
                    '<div class="tv-titulo">' +
                        'El BCV publicó' +
                        '<span class="tv-chip">' + (bcv.fuente || 'origen desconocido') + '</span>' +
                    '</div>' +
                    '<div class="tv-valor">' + Number(bcv.valor).toFixed(2) + '</div>' +
                    '<div class="tv-fecha">' +
                        'Fecha valor <strong>' + fechaEnPalabras(bcv.fecha_valor) + '</strong>' +
                        '<span class="tv-tenue"> (' + cuandoFue(bcv.dias_atras) + ')</span>' +
                    '</div>' +
                '</div>' +
                '<div class="tv-caja ' + (esIgual ? 'tv-ok' : 'tv-alerta') + '">' +
                    '<div class="tv-titulo">' +
                        (esIgual ? 'Está igual a la que cobrás' : 'Hay diferencia con la que cobrás') +
                    '</div>' +
                    '<div class="tv-nota">' +
                        'Estás cobrando <strong>' + aplicada.toFixed(2) + '</strong>.' +
                        (esIgual
                            ? ' Es la misma tasa: la diferencia es de redondeo.'
                            : ' Diferencia de <strong>' + formatoBs(Math.abs(difBs)) +
                              '</strong> por dólar (' + Math.abs(difPct).toFixed(2) + '%).') +
                    '</div>' +
                '</div>';
        }

        // ── Botones ──
        var botones = '';

        // "Mantener esta tasa: X" — el botón que pidió el dueño. Es el camino
        // corto cuando la que está aplicada ya es la correcta.
        botones +=
            '<button class="tv-btn tv-btn-mantener" onclick="window._decidirTasaVentana(\'mantener\')">' +
                '<span class="tv-btn-txt"><i class="fas fa-check"></i> Mantener esta tasa: ' +
                    aplicada.toFixed(2) + '</span>' +
                '<span class="tv-btn-sub">Dejo el precio como está</span>' +
            '</button>';

        // Aplicar la del BCV solo tiene sentido si difiere.
        if (bcv && !esIgual) {
            botones +=
                '<button class="tv-btn tv-btn-bcv" onclick="window._decidirTasaVentana(\'aplicar_bcv\')">' +
                    '<span class="tv-btn-txt"><i class="fas fa-building-columns"></i> Usar la del BCV: ' +
                        Number(bcv.valor).toFixed(2) + '</span>' +
                    '<span class="tv-btn-sub">Los precios se actualizan</span>' +
                '</button>';
        }

        botones +=
            '<button class="tv-btn tv-btn-otra" onclick="window._decidirTasaVentana(\'aplicar_otra\')">' +
                '<span class="tv-btn-txt"><i class="fas fa-pen"></i> Poner otra a mano</span>' +
            '</button>';

        // ── Armar ──
        var overlay = document.createElement('div');
        overlay.id = _idVentana;
        overlay.className = 'tv-overlay';

        overlay.innerHTML =
            '<div class="tv-modal" role="dialog" aria-modal="true" aria-labelledby="tvTitulo">' +
                '<div class="tv-head">' +
                    '<h3 id="tvTitulo">' + titulo + '</h3>' +
                    '<p>' + sub + '</p>' +
                '</div>' +
                '<div class="tv-body">' +
                    avisoViejo +
                    bloqueBcv +
                    '<div class="tv-botones">' + botones + '</div>' +
                    (bcv
                        ? '<button class="tv-link" onclick="window._cerrarVentanaTasa()">' +
                              'Lo veo después, sin decidir' +
                          '</button>'
                        : '<button class="tv-link" onclick="window._cerrarVentanaTasa()">Cerrar</button>') +
                '</div>' +
            '</div>';

        document.body.appendChild(overlay);

        // Cerrar tocando fuera
        overlay.addEventListener('click', function (ev) {
            if (ev.target === overlay) window._cerrarVentanaTasa();
        });
    };

    // ============================================================
    // Cerrar sin decidir
    // ============================================================
    window._cerrarVentanaTasa = function () {
        var o = document.getElementById(_idVentana);
        if (o) o.remove();

        // Se recuerda SOLO en esta sesión del navegador. No se escribe en la
        // base: "lo veo después" no es una decisión y no debe quedar
        // registrada como si lo fuera. Pero tampoco debe reaparecer cada vez
        // que la persona cambie de sección.
        try { sessionStorage.setItem('saki_ventana_tasa_cerrada', '1'); } catch (err) {}
    };

    // ============================================================
    // Decidir
    // ============================================================
    window._decidirTasaVentana = async function (accion) {
        var e = _estado || {};
        var bcv = e.bcv;

        var valor = null;
        var nota  = null;

        if (accion === 'aplicar_otra') {
            var entrada = prompt(
                'Escribí la tasa que querés aplicar.\n\n' +
                'Queda registrada como carga manual, con la fecha de hoy.'
            );
            if (entrada === null) return;
            valor = parseFloat(String(entrada).replace(',', '.'));
            if (!(valor > 0)) {
                window.mostrarToast && window.mostrarToast('Esa tasa no es un número válido', 'error');
                return;
            }
            nota = 'Cargada a mano desde la ventana del día';
        }

        if (accion === 'aplicar_bcv') {
            if (!bcv) return;
            valor = Number(bcv.valor);
            nota  = 'Se aplicó la tasa del BCV del ' + fechaEnPalabras(bcv.fecha_valor) +
                    ' desde la ventana del día';
        }

        if (accion === 'mantener') {
            nota = 'Se mantuvo la tasa vigente sin cambios';
        }

        // ── Si hay que aplicar un número, se usa el camino único de la 23 ──
        if (valor !== null) {
            var origen = (accion === 'aplicar_bcv') ? 'vigente' : 'manual';
            var fecha  = (accion === 'aplicar_bcv')
                ? (bcv && bcv.fecha_valor) || null
                : null;

            var r1 = await window.supabaseClient.rpc('aplicar_tasa_elegida', {
                p_valor:       valor,
                p_origen:      origen,
                p_fecha_valor: fecha,
                p_confirmar:   false
            });

            if (r1.error) {
                window.mostrarToast && window.mostrarToast('❌ ' + r1.error.message, 'error');
                return;
            }
            var d1 = r1.data || {};

            // Guarda contra el dedazo (8862 en vez de 886). Se vuelve a
            // llamar con confirmación explícita.
            if (d1.requiere_confirmacion) {
                if (!confirm('⚠️ ' + d1.error + '\n\n¿Confirmás que es intencional?')) return;
                var r2 = await window.supabaseClient.rpc('aplicar_tasa_elegida', {
                    p_valor:       valor,
                    p_origen:      origen,
                    p_fecha_valor: fecha,
                    p_confirmar:   true
                });
                if (r2.error || !(r2.data || {}).success) {
                    window.mostrarToast && window.mostrarToast(
                        '❌ ' + ((r2.error && r2.error.message) || (r2.data || {}).error || 'No se pudo aplicar'),
                        'error');
                    return;
                }
            } else if (!d1.success) {
                window.mostrarToast && window.mostrarToast('❌ ' + (d1.error || 'No se pudo aplicar'), 'error');
                return;
            }
        }

        // ── Registrar la decisión del día ──
        var r3 = await window.supabaseClient.rpc('confirmar_revision_tasa', {
            p_accion: accion,
            p_nota:   nota
        });

        if (r3.error) {
            console.warn('confirmar_revision_tasa:', r3.error.message);
        }

        // ── Cerrar y refrescar ──
        var o = document.getElementById(_idVentana);
        if (o) o.remove();

        if (window.mostrarToast) {
            var msj = accion === 'mantener'
                ? '👍 Tasa mantenida: ' + Number(e.aplicada || 0).toFixed(2)
                : '💱 Tasa aplicada: ' + Number(valor).toFixed(2) + '. Precio al cliente actualizado.';
            window.mostrarToast(msj, 'success');
        }

        // Refrescar el panel si está abierto y la config en memoria.
        if (window.cargarConfiguracion)   { try { await window.cargarConfiguracion(); } catch (err) {} }
        if (window.actualizarTasaUI)      { try { window.actualizarTasaUI(); } catch (err) {} }
        if (window.cargarTasaPanel)       { try { await window.cargarTasaPanel(); } catch (err) {} }
        if (window.renderizarMenu)        { try { window.renderizarMenu(); } catch (err) {} }
        if (window.cargarDatosIniciales && typeof window.cargarDatosIniciales === 'function'
            && document.getElementById('cajeroTasaInput')) {
            // Cajero: refrescar widgets sin recargar todo
            try {
                var inp = document.getElementById('cajeroTasaInput');
                if (inp && window.configGlobal) inp.value = parseFloat(window.configGlobal.tasa_cambio).toFixed(2);
                if (window.actualizarEstadisticas) window.actualizarEstadisticas();
            } catch (err) {}
        }
    };

    // ============================================================
    // Escuchar el cierre desde otras computadoras
    // ============================================================
    //
    // Cuando un admin confirma en su equipo, el cajero que tenía la ventana
    // abierta la ve desaparecer. Ese es el "replicar" que pidió el dueño.
    window.escucharRevisionTasaCompartida = function () {
        if (!window.supabaseClient || window.__escuchaRevisionTasa) return;
        window.__escuchaRevisionTasa = true;

        try {
            window.supabaseClient
                .channel('tasa-revision-compartida')
                .on('postgres_changes',
                    { event: '*', schema: 'public', table: 'tasa_revision_diaria' },
                    function (payload) {
                        var hoy = new Date().toLocaleDateString('en-CA', { timeZone: 'America/Caracas' });
                        var fila = payload.new || {};
                        if (String(fila.dia).slice(0, 10) !== hoy) return;

                        var o = document.getElementById(_idVentana);
                        if (!o) return;

                        o.remove();
                        if (window.mostrarToast) {
                            window.mostrarToast(
                                '🔒 ' + (fila.revisada_por || 'Otro equipo') +
                                ' ya revisó la tasa del día: ' + Number(fila.tasa_aplicada || 0).toFixed(2),
                                'info'
                            );
                        }
                        if (window.cargarConfiguracion) {
                            window.cargarConfiguracion().then(function () {
                                if (window.actualizarTasaUI) window.actualizarTasaUI();
                                if (window.cargarTasaPanel)  window.cargarTasaPanel();
                            });
                        }
                    })
                .subscribe();
        } catch (e) {
            console.warn('No se pudo escuchar la revisión de tasa:', e.message);
        }
    };

    // ============================================================
    // Arranque
    // ============================================================
    //
    // Se llama después del login. Respeta el "lo veo después" de la sesión y
    // no molesta si ya se revisó hoy.
    window.arrancarVentanaTasa = async function (opciones) {
        opciones = opciones || {};
        try {
            if (!opciones.forzar && sessionStorage.getItem('saki_ventana_tasa_cerrada') === '1') {
                // Ya la cerró en esta pestaña. Se consulta igual el estado
                // para que el panel muestre si otro equipo la revisó.
                window.escucharRevisionTasaCompartida();
                return;
            }

            var e = await window.consultarVentanaTasa();
            window.escucharRevisionTasaCompartida();
            if (!e) return;

            if (!opciones.forzar && !e.necesita_revision) return;

            await window.abrirVentanaTasa(opciones.forzar);
        } catch (err) {
            console.warn('arrancarVentanaTasa:', err.message);
        }
    };

})();
