// admin-tasa-panel.js — El cuadro completo de la tasa, con su origen y su fecha
//
// QUÉ PROBLEMA RESUELVE
//
// Antes el panel mostraba un número suelto. El admin tenía que creerle. No
// sabía de dónde salió, a qué fecha correspondía, ni si era la que el BCV
// tiene publicada hoy. Desmentirla obligaba a abrir el Instagram del BCV y
// comparar a ojo.
//
// Este archivo muestra el cuadro completo —valor, fecha valor y origen— y
// permite elegir con qué tasa se cobra, dejando registro de la elección.
//
// DÓNDE VIVE LA VERDAD
//
// Todo lo que se muestra sale de `tasa_panel()`, una sola llamada a la base.
// El navegador NO calcula la diferencia, NO decide qué es "vigente" y NO
// redondea nada. La regla vive en Postgres, igual que la vigencia de las
// ofertas.
//
// LA REGLA QUE SE ROMPE A PROPÓSITO
//
// La migración 22 dijo: "una fecha valor futura NUNCA se aplica". Eso protege
// contra un sistema que se adelanta solo. No protege contra un humano que
// decide, sabiendo, cobrar con la tasa que el BCV ya publicó para el martes.
//
// Se puede. Pero queda escrito: la captura se marca como adelanto y el motivo
// dice que fue una decisión del admin. Si alguien pregunta después por qué ese
// día se cobró con una tasa que todavía no regía, la respuesta está en la base.
//
// NOTA LEGAL (leer antes de tocar esto)
//
// El delito cambiario ya no existe: la Ley del Régimen Cambiario y sus Ilícitos
// fue derogada en 2018 (G.O. 41.452) y el Convenio Cambiario N° 1 estableció
// libre convertibilidad. El riesgo real no es la tasa, es el PRECIO: la Ley
// Orgánica de Precios Justos castiga el aumento sin causa en el costo, y la Ley
// de Protección al Consumidor prohíbe cobrar más que el precio exhibido.
//
// Por eso la diferencia entre la vigente y la próxima importa: un fiscal puede
// leer "subieron el precio antes de que la tasa rigiera". El registro con
// motivo es el papel que responde.

(function () {
    'use strict';

    var _datos = null;

    function hoyISO() {
        return new Date().toLocaleDateString('en-CA', { timeZone: 'America/Caracas' });
    }

    // "2026-10-23" -> "viernes 23/10"
    function fechaEnPalabras(iso) {
        if (!iso) return '—';
        var d = new Date(iso + 'T12:00:00');
        if (isNaN(d)) return iso;
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

    function cuandoFalta(diasPara) {
        var n = Number(diasPara);
        if (isNaN(n)) return '';
        if (n === 0) return 'hoy';
        if (n === 1) return 'mañana';
        return 'en ' + n + ' días';
    }

    function formatoBs(n) {
        return (typeof window.formatBs === 'function') ? window.formatBs(n) : 'Bs ' + Number(n).toFixed(2);
    }

    // ============================================================
    // Pintar el cuadro
    // ============================================================
    window.renderizarTasaPanel = function () {
        var cont = document.getElementById('tasaBcvPanel');
        if (!cont || !_datos) return;

        var bcv      = _datos.bcv;
        var proxima  = _datos.proxima;
        var aplicada = _datos.aplicada || {};
        var dif      = _datos.diferencia || {};

        // ── Bloque 1: la tasa del BCV ──
        var html = '';

        if (!bcv) {
            html +=
                '<div class="tbp-caja tbp-vacia">' +
                    '<div class="tbp-titulo"><i class="fas fa-triangle-exclamation"></i> No hay ninguna tasa del BCV capturada</div>' +
                    '<div class="tbp-nota">El cron la busca de lunes a viernes a las 5 pm. Si esto sigue así, revisá que el cron esté corriendo.</div>' +
                '</div>';
        } else {
            var fuente = bcv.fuente || 'origen desconocido';
            var chipOrigen = bcv.es_principal === false
                ? '<span class="tbp-chip tbp-chip-respaldo" title="La fuente principal no respondió y se usó esta">' + fuente + '</span>'
                : '<span class="tbp-chip">' + fuente + '</span>';

            // Aviso de antigüedad. No bloquea nada ni pide confirmación: es
            // información. Pero tiene que estar, porque el admin necesita
            // saber si el número que ve es de hoy o de la semana pasada.
            var avisoViejo = '';
            var rev = _datos.revision || {};
            var fuenteTxt = (bcv && bcv.fuente) ? bcv.fuente : 'fuente desconocida';

            if (rev.captura_fallo_hoy) {
                // No se pudo capturar hoy: se nombra la fuente y la fecha del
                // dato que se está mostrando, y se pregunta si es el que quiere.
                avisoViejo =
                    '<div class="tbp-aviso-viejo tbp-aviso-fallo">' +
                        '<i class="fas fa-plug-circle-xmark"></i> ' +
                        'Este es el BCV de ' + fuenteTxt + ' del ' +
                        fechaEnPalabras(rev.fecha_valor || (bcv && bcv.fecha_valor)) +
                        ', ¿lo eliges?' +
                    '</div>';
            } else if (rev.dato_viejo) {
                avisoViejo =
                    '<div class="tbp-aviso-viejo">' +
                        '<i class="fas fa-clock"></i> ' +
                        'La tasa sigue siendo la de ayer, BCV no publicó nueva' +
                    '</div>';
            }

            html +=
                '<div class="tbp-caja">' +
                    '<div class="tbp-titulo">' +
                        '<i class="fas fa-building-columns"></i> Lo que publicó el BCV' +
                        chipOrigen +
                    '</div>' +
                    avisoViejo +
                    '<div class="tbp-fila-principal">' +
                        '<div class="tbp-valor">' + Number(bcv.valor).toFixed(2) + '</div>' +
                        '<div class="tbp-fecha">' +
                            'Fecha valor: <strong>' + fechaEnPalabras(bcv.fecha_valor) + '</strong>' +
                            '<span class="tbp-tenue"> (' + cuandoFue(bcv.dias_atras) + ')</span>' +
                        '</div>' +
                    '</div>' +
                    '<div class="tbp-nota">Se cobra con <strong>' + Number(aplicada.tasa_cambio || 0).toFixed(2) +
                        '</strong> de base, y el precio al cliente sale con la efectiva de <strong>' +
                        Number(aplicada.tasa_efectiva || 0).toFixed(2) + '</strong>.</div>' +
                '</div>';
        }

        // ── Bloque 2: la diferencia ──
        if (bcv && Number(aplicada.tasa_cambio) > 0) {
            var pct  = Number(dif.porcentaje || 0);
            var abs  = Math.abs(pct);
            var cls  = dif.requiere_revision ? 'tbp-alerta' : 'tbp-ok';
            var icono = dif.requiere_revision ? 'fa-triangle-exclamation' : 'fa-circle-check';

            var texto;
            if (dif.es_igual || dif.signo === 'igual') {
                // A 2 decimales es la misma tasa: el BCV publica 886,2271 y se
                // cobra 886,23 porque es lo que entra en config. Avisar acá
                // enseña a ignorar el panel.
                texto = 'Estás cobrando la tasa del BCV. La diferencia es de redondeo.';
            } else if (dif.signo === 'falta') {
                texto = 'Estás cobrando por debajo del BCV: faltan <strong>' + formatoBs(dif.bolivares) +
                        '</strong> por dólar (' + abs.toFixed(2) + '%).';
            } else {
                texto = 'Estás cobrando por encima del BCV: sobran <strong>' + formatoBs(Math.abs(dif.bolivares)) +
                        '</strong> por dólar (' + abs.toFixed(2) + '%).';
            }

            if (dif.requiere_revision && dif.signo === 'falta') {
                texto += ' Cada 100 USD de venta estás dejando de cobrar <strong>' +
                         formatoBs(Math.abs(dif.por_100_usd)) + '</strong>.';
            }

            html +=
                '<div class="tbp-caja ' + cls + '">' +
                    '<div class="tbp-titulo"><i class="fas ' + icono + '"></i> ' +
                        (dif.requiere_revision ? 'Revisar' : 'Al día') +
                        '<span class="tbp-chip tbp-chip-umbral">umbral ' + dif.umbral_porcentaje + '%</span>' +
                    '</div>' +
                    '<div class="tbp-nota">' + texto + '</div>' +
                '</div>';
        }

        // ── Bloque 3: la próxima y la elección ──
        if (proxima) {
            var difProx = Number(proxima.valor) - Number(aplicada.tasa_cambio || 0);
            html +=
                '<div class="tbp-caja tbp-proxima">' +
                    '<div class="tbp-titulo"><i class="fas fa-forward"></i> Ya está publicada la próxima' +
                        '<span class="tbp-chip">' + (proxima.fuente || '—') + '</span>' +
                    '</div>' +
                    '<div class="tbp-pregunta">' +
                        'La próxima del <strong>' + fechaEnPalabras(proxima.fecha_valor) + '</strong> ' +
                        '<span class="tbp-tenue">(' + cuandoFalta(proxima.dias_para) + ')</span> ' +
                        'es <strong>' + Number(proxima.valor).toFixed(2) + '</strong>. ¿Cuál usamos?' +
                    '</div>' +
                    '<div class="tbp-difprox">' +
                        (difProx === 0
                            ? 'Es la misma que estás aplicando.'
                            : 'Diferencia con la que aplicás: <strong>' + (difProx > 0 ? '+' : '') +
                              difProx.toFixed(2) + '</strong> Bs por dólar.') +
                    '</div>' +
                    '<div class="tbp-botones">' +
                        '<button class="tbp-btn tbp-btn-vigente" onclick="window.elegirTasa(\'vigente\')">' +
                            '<i class="fas fa-check"></i> Usar la vigente' +
                            '<span class="tbp-btn-sub">' + Number(bcv ? bcv.valor : aplicada.tasa_cambio || 0).toFixed(2) + '</span>' +
                        '</button>' +
                        '<button class="tbp-btn tbp-btn-proxima" onclick="window.elegirTasa(\'proxima\')">' +
                            '<i class="fas fa-forward"></i> Usar la próxima' +
                            '<span class="tbp-btn-sub">' + Number(proxima.valor).toFixed(2) + '</span>' +
                        '</button>' +
                        '<button class="tbp-btn tbp-btn-manual" onclick="window.elegirTasa(\'manual\')">' +
                            '<i class="fas fa-pen"></i> Poner otra a mano' +
                        '</button>' +
                    '</div>' +
                    '<div class="tbp-aviso">' +
                        'Elegir la próxima la cobra antes de su fecha valor. Queda registrado como ' +
                        'decisión tuya, con el motivo escrito.' +
                    '</div>' +
                '</div>';
        }

        // ── Bloque 3b: ¿ya se revisó hoy? ──
        var rev = _datos.revision || {};
        if (rev.ya_revisada) {
            var etiquetas = {
                mantener:     'Se mantuvo la tasa',
                aplicar_bcv:  'Se aplicó la del BCV',
                aplicar_otra: 'Se aplicó una tasa a mano',
                sin_captura:  'No había tasa del BCV'
            };
            html +=
                '<div class="tbp-caja tbp-revisada">' +
                    '<div class="tbp-titulo"><i class="fas fa-lock"></i> Tasa del día ya revisada</div>' +
                    '<div class="tbp-nota">' +
                        (etiquetas[rev.accion] || 'Revisada') + ' por <strong>' +
                        (rev.revisada_por || 'alguien') + '</strong>.' +
                    '</div>' +
                    '<button class="tbp-btn-link" style="margin-top:.4rem" onclick="window.abrirVentanaTasa(true)">' +
                        '<i class="fas fa-rotate"></i> Revisar de nuevo' +
                    '</button>' +
                '</div>';
        }

        // ── Bloque 3c: respaldos esperando confirmación ──
        //
        // Una captura de respaldo entra como 'pendiente' porque su fecha valor
        // no es la del BCV. Si no se muestra acá queda invisible: no es
        // vigente (esa filtra estado 'aplicada') ni próxima (esa filtra fecha
        // futura). "Hay una tasa esperando que alguien la confirme" es
        // información que el admin necesita.
        var porConfirmar = _datos.por_confirmar || [];
        if (porConfirmar.length) {
            var filasCon = porConfirmar.map(function (c) {
                return '<div class="tbp-conf-fila">' +
                    '<div class="tbp-conf-datos">' +
                        '<strong>' + Number(c.valor).toFixed(2) + '</strong> ' +
                        '<span class="tbp-tenue">(' + fechaEnPalabras(c.fecha_valor) + ')</span>' +
                        '<div class="tbp-conf-fuente">' + (c.fuente || '—') + '</div>' +
                    '</div>' +
                    '<button class="tbp-btn tbp-btn-mini" ' +
                        'data-id="' + c.id + '" ' +
                        'data-valor="' + Number(c.valor) + '" ' +
                        'data-fecha="' + c.fecha_valor + '" ' +
                        'onclick="window.confirmarTasaRespaldo(this)">Confirmar</button>' +
                '</div>';
            }).join('');

            html +=
                '<div class="tbp-caja tbp-alerta">' +
                    '<div class="tbp-titulo"><i class="fas fa-circle-question"></i> ' +
                        'Tasas de respaldo esperando confirmación</div>' +
                    '<div class="tbp-nota">La fuente principal no respondió y se usó un respaldo. ' +
                        'Su fecha valor no es la del BCV, así que no se aplica sola.</div>' +
                    '<div class="tbp-conf-lista">' + filasCon + '</div>' +
                '</div>';
        }

        // ── Bloque 3d: cómo fue la captura de hoy ──
        var cadena = _datos.cadena_hoy || [];
        if (cadena.length) {
            var eslabones = cadena.map(function (c) {
                var icono = c.estado === 'ok' ? 'fa-circle-check'
                          : c.estado === 'fallido' ? 'fa-circle-xmark'
                          : 'fa-clock';
                var cls = c.estado === 'ok' ? 'tbp-es-ok'
                        : c.estado === 'fallido' ? 'tbp-es-fallo'
                        : 'tbp-es-curso';
                return '<div class="tbp-eslabon ' + cls + '">' +
                    '<i class="fas ' + icono + '"></i>' +
                    '<span class="tbp-es-nombre">' + (c.fuente || '—') + '</span>' +
                    '<span class="tbp-es-hora">' + (c.hora || '') + '</span>' +
                    (c.detalle ? '<span class="tbp-es-detalle">' + c.detalle + '</span>' : '') +
                '</div>';
            }).join('');

            html +=
                '<div class="tbp-caja">' +
                    '<div class="tbp-titulo"><i class="fas fa-diagram-project"></i> ' +
                        'Cómo fue la captura de hoy</div>' +
                    '<div class="tbp-eslabones">' + eslabones + '</div>' +
                '</div>';
        }

        // ── Bloque 4: acceso al historial ──
        var cuantas = (_datos.capturas || []).length;
        html +=
            '<div class="tbp-pie">' +
                '<button class="tbp-btn-link" onclick="window.abrirHistorialTasa()">' +
                    '<i class="fas fa-clock-rotate-left"></i> Ver historial de capturas (' + cuantas + ')' +
                '</button>' +
            '</div>';

        cont.innerHTML = html;
    };

    // ============================================================
    // Cargar
    // ============================================================
    window.cargarTasaPanel = async function () {
        try {
            if (!window.supabaseClient) return;
            var r = await window.supabaseClient.rpc('tasa_panel');
            if (r.error) {
                // 42883 = la función no existe todavía: la migración 23 no se
                // aplicó. El panel sigue funcionando como antes, sin este cuadro.
                if (r.error.code !== '42883' && r.error.code !== 'PGRST202') {
                    console.warn('tasa_panel:', r.error.message);
                }
                var cont = document.getElementById('tasaBcvPanel');
                if (cont) cont.style.display = 'none';
                return;
            }
            _datos = r.data;
            var cont2 = document.getElementById('tasaBcvPanel');
            if (cont2) cont2.style.display = '';
            window.renderizarTasaPanel();
        } catch (e) {
            console.warn('No se pudo cargar el panel de tasa:', e.message);
        }
    };

    // ============================================================
    // Elegir
    // ============================================================
    window.elegirTasa = async function (origen) {
        if (!_datos) return;

        var valor, fechaValor, etiqueta;

        if (origen === 'vigente') {
            if (!_datos.bcv) { window.mostrarToast('No hay tasa del BCV capturada', 'error'); return; }
            valor      = Number(_datos.bcv.valor);
            fechaValor = _datos.bcv.fecha_valor;
            etiqueta   = 'la vigente del BCV (' + fechaEnPalabras(fechaValor) + ')';

        } else if (origen === 'proxima') {
            if (!_datos.proxima) { window.mostrarToast('No hay tasa próxima capturada', 'error'); return; }
            valor      = Number(_datos.proxima.valor);
            fechaValor = _datos.proxima.fecha_valor;
            etiqueta   = 'la próxima (' + fechaEnPalabras(fechaValor) + ')';
        } else {
            var entrada = prompt(
                'Escribí la tasa que querés aplicar.\n\n' +
                'Se va a registrar como carga manual, con la fecha de hoy.'
            );
            if (entrada === null) return;
            valor = parseFloat(String(entrada).replace(',', '.'));
            if (!(valor > 0)) { window.mostrarToast('Esa tasa no es un número válido', 'error'); return; }
            fechaValor = hoyISO();
            etiqueta   = 'la que escribiste a mano';
        }

        var baseActual = Number((_datos.aplicada || {}).tasa_cambio || 0);

        // Se pregunta UNA VEZ, y solo cuando la respuesta no es obvia.
        //
        // Quien decide cuánta fricción hace falta es la base
        // (`_nivel_confirmacion_tasa`), no este archivo. Acá solo se respeta:
        //
        //   0 -> aplicar y nada más (es redondeo o el usuario ya escribió el
        //        número a mano; preguntar otra vez sería preguntar dos veces
        //        lo mismo)
        //   1 -> una confirmación
        //   2 -> una confirmación acá, y la base va a pedir la segunda si el
        //        salto es brusco
        //
        // El adelanto de la fecha valor siempre cae en nivel 1: no es fricción,
        // es una decisión con consecuencia y tiene que quedar registrada.
        var salto = baseActual > 0
            ? Math.abs(valor - baseActual) / baseActual * 100
            : 0;
        var nivel = 0;
        if (origen === 'proxima')                    nivel = 1;
        else if (baseActual > 0 && salto >= 0.5)     nivel = (salto > 50 ? 2 : 1);
        if (origen === 'manual' && salto <= 50)      nivel = 0;

        if (nivel === 0) {
            // Sin diálogo: el toast de resultado alcanza y sobra.
            await enviarTasa(valor, origen, fechaValor, false);
            return;
        }

        var texto;
        if (origen === 'proxima') {
            texto =
                'Vas a cobrar con ' + etiqueta + ': ' + valor.toFixed(2) + ' Bs por dólar.\n\n' +
                'Ojo: esa tasa tiene fecha valor ' + fechaEnPalabras(fechaValor) +
                ', o sea que todavía NO RIGE. La actual es ' + baseActual.toFixed(2) + '.\n\n' +
                'Queda registrado como decisión tuya. ¿Seguimos?';
        } else {
            texto =
                'Vas a aplicar ' + etiqueta + ': ' + valor.toFixed(2) + ' Bs por dólar.\n\n' +
                'La actual es ' + baseActual.toFixed(2) + '.\n\n' +
                'El aumento acumulado se conserva: la tasa efectiva se recalcula manteniendo el mismo factor.\n\n' +
                '¿Confirmás?';
        }

        if (!confirm(texto)) return;

        await enviarTasa(valor, origen, fechaValor, false);
    };

    async function enviarTasa(valor, origen, fechaValor, confirmado) {
        try {
            var r = await window.supabaseClient.rpc('aplicar_tasa_elegida', {
                p_valor:       valor,
                p_origen:      origen,
                p_fecha_valor: fechaValor,
                p_confirmar:   confirmado
            });

            if (r.error) {
                window.mostrarToast('❌ ' + r.error.message, 'error');
                return;
            }

            var d = r.data || {};

            // La función se niega a un salto mayor al 50% sin confirmación.
            // Es la guarda contra el dedazo (8862 en vez de 886).
            if (d.requiere_confirmacion) {
                if (!confirm('⚠️ ' + d.error + '\n\n¿Confirmás que es intencional?')) return;
                return enviarTasa(valor, origen, fechaValor, true);
            }

            if (!d.success) {
                window.mostrarToast('❌ ' + (d.error || 'No se pudo aplicar la tasa'), 'error');
                return;
            }

            window.mostrarToast(
                '💱 Tasa aplicada: ' + Number(d.tasa_aplicada).toFixed(2) +
                '. El precio al cliente sale con ' + Number(d.tasa_efectiva).toFixed(2) + '.',
                d.adelanto ? 'warning' : 'success'
            );

            // Refrescar el resto del panel con el valor nuevo, sin recargar
            // la página: el admin tiene que ver el efecto de lo que hizo.
            if (window.cargarConfiguracion) await window.cargarConfiguracion();
            if (window.actualizarTasaUI)   window.actualizarTasaUI();
            await window.cargarTasaPanel();
            if (window.renderizarMenu) window.renderizarMenu();

        } catch (e) {
            console.error('Error aplicando tasa:', e);
            window.mostrarToast('❌ Error de conexión al aplicar la tasa', 'error');
        }
    }

    // ============================================================
    // Confirmar una tasa de respaldo
    // ============================================================
    //
    // El respaldo trae el número pero no la fecha valor del BCV. Confirmarla
    // es decir "yo verifiqué que esta es la que rige". Se aplica con el mismo
    // camino único de siempre (`aplicar_tasa_elegida`) y queda con el motivo
    // escrito en la captura.
    window.confirmarTasaRespaldo = async function (btn) {
        if (!btn) return;

        var id     = btn.getAttribute('data-id');
        var valor  = Number(btn.getAttribute('data-valor'));
        var fecha  = btn.getAttribute('data-fecha');

        if (!(valor > 0)) {
            window.mostrarToast('Esa tasa no es un número válido', 'error');
            return;
        }

        var texto =
            'Vas a aplicar la tasa de respaldo: ' + valor.toFixed(2) + ' Bs por dólar.\n\n' +
            'Viene de una fuente secundaria, así que su fecha valor (' +
            fechaEnPalabras(fecha) + ') NO es la del BCV.\n\n' +
            'Confirmá solo si verificaste el número contra la publicación oficial.\n\n' +
            '¿Aplicar?';

        if (!confirm(texto)) return;

        try {
            var r = await window.supabaseClient.rpc('aplicar_tasa_elegida', {
                p_valor:       valor,
                p_origen:      'manual',
                p_fecha_valor: fecha,
                p_confirmar:   false
            });

            if (r.error) {
                window.mostrarToast('❌ ' + r.error.message, 'error');
                return;
            }

            var d = r.data || {};

            // Guarda contra el dedazo: la función se niega a un salto mayor al
            // 50% sin confirmación explícita.
            if (d.requiere_confirmacion) {
                if (!confirm('⚠️ ' + d.error + '\n\n¿Confirmás que es intencional?')) return;
                var r2 = await window.supabaseClient.rpc('aplicar_tasa_elegida', {
                    p_valor:       valor,
                    p_origen:      'manual',
                    p_fecha_valor: fecha,
                    p_confirmar:   true
                });
                if (r2.error) {
                    window.mostrarToast('❌ ' + r2.error.message, 'error');
                    return;
                }
                d = r2.data || {};
            }

            if (!d.success) {
                window.mostrarToast('❌ ' + (d.error || 'No se pudo aplicar'), 'error');
                return;
            }

            window.mostrarToast(
                '💱 Tasa de respaldo confirmada: ' + Number(d.tasa_aplicada).toFixed(2) +
                '. El precio al cliente sale con ' + Number(d.tasa_efectiva).toFixed(2) + '.',
                'success'
            );

            if (window.cargarConfiguracion) await window.cargarConfiguracion();
            if (window.actualizarTasaUI)    window.actualizarTasaUI();
            await window.cargarTasaPanel();
            if (window.renderizarMenu)      window.renderizarMenu();

        } catch (e) {
            console.error('Error confirmando respaldo:', e);
            window.mostrarToast('❌ Error de conexión', 'error');
        }
    };

    // ============================================================
    // Historial
    // ============================================================
    window.abrirHistorialTasa = function () {
        if (!_datos) return;
        var capturas = _datos.capturas || [];

        var filas = capturas.map(function (c) {
            var estado = c.estado;
            var chipEstado =
                estado === 'aplicada'   ? '<span class="tbh-chip tbh-aplicada">aplicada</span>' :
                estado === 'pendiente'  ? '<span class="tbh-chip tbh-pendiente">pendiente</span>' :
                                          '<span class="tbh-chip tbh-descartada">descartada</span>';

            var marcaAdelanto = c.fue_adelanto
                ? '<span class="tbh-chip tbh-adelanto" title="Se aplicó antes de su fecha valor">adelanto</span>'
                : '';

            return '<tr>' +
                '<td>' + fechaEnPalabras(c.fecha_valor) + '</td>' +
                '<td class="tbh-num">' + Number(c.valor).toFixed(2) + '</td>' +
                '<td>' + (c.fuente || '—') + '</td>' +
                '<td>' + chipEstado + marcaAdelanto + '</td>' +
                '<td class="tbh-motivo">' + (c.motivo_estado || '<span class="tbp-tenue">—</span>') + '</td>' +
            '</tr>';
        }).join('');

        var overlay = document.createElement('div');
        overlay.className = 'modal-overlay';
        overlay.style.cssText = 'position:fixed;inset:0;z-index:10000;display:flex;align-items:center;justify-content:center;background:rgba(0,0,0,.6);padding:1rem';

        var modal = document.createElement('div');
        modal.style.cssText = 'background:linear-gradient(135deg,#1a1a2e,#16213e);border:1px solid rgba(255,255,255,.12);border-radius:16px;padding:1.4rem;max-width:720px;width:100%;max-height:85vh;overflow-y:auto;box-shadow:0 8px 32px rgba(0,0,0,.5)';

        modal.innerHTML =
            '<div style="display:flex;justify-content:space-between;align-items:flex-start;gap:1rem;margin-bottom:.9rem">' +
                '<div>' +
                    '<h3 style="color:#FF9800;margin:0;font-size:1.15rem">Historial de la tasa</h3>' +
                    '<p style="color:rgba(255,255,255,.55);font-size:.82rem;margin:.2rem 0 0">' +
                        'Cada captura queda guardada, aunque no se haya aplicado. Sirve para reconstruir qué pasó un día que la tasa salió mal.' +
                    '</p>' +
                '</div>' +
                '<button id="cerrarHistTasa" style="background:transparent;border:none;color:rgba(255,255,255,.6);font-size:1.6rem;line-height:1;cursor:pointer;padding:0 .2rem">&times;</button>' +
            '</div>' +
            (capturas.length
                ? '<table class="tbh-tabla"><thead><tr>' +
                    '<th>Fecha valor</th><th class="tbh-num">Bs/USD</th><th>Origen</th><th>Estado</th><th>Motivo</th>' +
                  '</tr></thead><tbody>' + filas + '</tbody></table>'
                : '<p style="color:rgba(255,255,255,.5);text-align:center;padding:1.5rem 0">Todavía no hay capturas.</p>') +
            '<p style="color:rgba(255,255,255,.4);font-size:.74rem;margin:.9rem 0 0;line-height:1.5">' +
                '<strong>Fecha valor</strong> es la fecha a la que el BCV asigna la tasa, no la fecha en que se capturó. ' +
                'Una fecha valor futura no se aplica sola: solo entra si alguien la elige a mano, y en ese caso queda marcada como adelanto.' +
            '</p>';

        overlay.appendChild(modal);
        document.body.appendChild(overlay);

        document.getElementById('cerrarHistTasa').onclick = function () { overlay.remove(); };
        overlay.onclick = function (e) { if (e.target === overlay) overlay.remove(); };
    };

    // ============================================================
    // Engancharse
    // ============================================================
    //
    // `cargarConfiguracionInicial` corre después del login en las dos puertas
    // de entrada (admin-auth.js). Se envuelve una sola vez para no duplicar
    // llamadas si el admin entra y sale varias veces.
    (function _enganchar() {
        if (window.__tasaPanelEnganchado) return;
        window.__tasaPanelEnganchado = true;

        var original = window.cargarConfiguracionInicial;
        if (typeof original === 'function') {
            window.cargarConfiguracionInicial = async function () {
                await original.apply(this, arguments);
                await window.cargarTasaPanel();

                // La ventana del día. Es lo primero que ve el admin al entrar:
                // la tasa del BCV con su fecha valor, y la decisión de una vez.
                if (typeof window.arrancarVentanaTasa === 'function') {
                    try { await window.arrancarVentanaTasa(); } catch (e) {
                        console.warn('ventana de tasa:', e.message);
                    }
                }
            };
        }

        // Si por alguna razón el panel ya está en pantalla al cargar este
        // archivo, se pide igual: es idempotente.
        document.addEventListener('DOMContentLoaded', function () {
            if (window.isAdminAuthenticated) window.cargarTasaPanel();
        });
    })();

})();
