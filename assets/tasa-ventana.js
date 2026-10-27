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

    // ── Nombre de la fuente, legible para una persona ──
    //
    // El campo `fuente` guarda el origen técnico, y así tiene que ser en la
    // base: para auditar importa saber si una tasa la trajo el sistema o la
    // tipeó alguien. Pero `carga_inicial`, `manual_admin` y `panel_admin`
    // significan todos lo mismo para el que mira la pantalla: la puso una
    // persona. Mostrarlos crudos confunde, y la distinción entre "inicial" y
    // "manual" solo nos sirve a nosotros.
    function nombreFuente(f) {
        if (!f) return 'origen desconocido';
        var v = String(f);
        if (v === 'carga_inicial' || v === 'manual_admin' || v === 'panel_admin' || v === 'manual') {
            return 'Carga manual';
        }
        if (v === 'dolarapi.com' || v === 'dolarapi') return 'dolarapi.com';
        return v;
    }

    // Igual que cuandoFue, pero mirando para adelante: la próxima todavía no
    // llegó. Se lee "mañana", "en 2 días", y no "hace".
    function cuandoSera(diasAdelante) {
        var n = Number(diasAdelante);
        if (isNaN(n)) return '';
        if (n === 0) return 'hoy';
        if (n === 1) return 'mañana';
        return 'en ' + n + ' días';
    }

    function cuandoFue(diasAtras) {
        var n = Number(diasAtras);
        if (isNaN(n)) return '';
        if (n === 0) return 'de hoy';
        if (n === 1) return 'de ayer';
        return 'hace ' + n + ' días';
    }

    // ============================================================
    // Consultar si hay que mostrar la ventana
    // ============================================================
    // Última respuesta buena conocida. Se guarda en memoria para poder
    // volver a mostrarla si la consulta falla después.
    var _ultimoBueno = null;

    // ¿Se pudo consultar? La distinción es la clave de todo este archivo.
    //
    // Antes, CUALQUIER error devolvía null, y null significaba "no hace falta
    // ventana". Resultado medido en la auditoría de red (recibo R6): sin
    // internet, la ventana de tasa desaparecía y el panel quedaba entero
    // usable. Fail-open: la única barrera de "sin tasa no se opera" se caía
    // justo cuando el local está más indefenso.
    //
    // Ahora `null` significa UNA sola cosa: "consulté bien y no hay que
    // revisar nada". Todo lo demás es INCERTIDUMBRE, y ante la duda se
    // bloquea, porque el costo de bloquear de más es molesto y el costo de
    // dejar cobrar sin tasa es plata mal cobrada.
    //
    // Excepción deliberada: si la FUNCIÓN no existe (migración no aplicada),
    // no es incertidumbre, es que la ventana no está instalada todavía. Eso
    // sí devuelve null para no romper instalaciones viejas.
    window.consultarVentanaTasa = async function () {
        try {
            if (!window.supabaseClient) {
                // Sin cliente no se puede saber nada. Es incertidumbre.
                return { necesita_revision: true, modo_offline: true,
                         motivo: 'Sin conexión con el servidor' };
            }

            var r = await window.supabaseClient.rpc('estado_revision_tasa');

            if (r.error) {
                // La función no existe: la ventana no está instalada.
                if (r.error.code === '42883' || r.error.code === 'PGRST202') {
                    return null;
                }
                console.warn('estado_revision_tasa:', r.error.message);
                return _estadoDeIncertidumbre(r.error.message);
            }

            _estado = r.data;
            _ultimoBueno = r.data;
            return _estado;

        } catch (e) {
            console.warn('No se pudo consultar la ventana de tasa:', e.message);
            return _estadoDeIncertidumbre(e.message);
        }
    };

    // Estado que se devuelve cuando NO se pudo consultar.
    //
    // Se apoya en la última respuesta buena si existe, para no perder el dato
    // del BCV que ya estaba en pantalla. Pero `necesita_revision` se fuerza a
    // true: sin poder verificar la firma del día, hay que asumir que falta.
    function _estadoDeIncertidumbre(motivo) {
        var base = _ultimoBueno || {};
        return {
            necesita_revision: true,
            ya_revisada:       false,
            incertidumbre:     true,
            modo_offline:      true,
            motivo:            motivo || 'No se pudo verificar la tasa del día',
            aplicada:          base.aplicada,
            bcv:               base.bcv || null,
            proxima:           base.proxima || null,
            fecha_valor:       base.fecha_valor,
            dato_viejo:        base.dato_viejo,
            antiguedad_dias:   base.antiguedad_dias,
            fuente_bcv:        base.fuente_bcv
        };
    }

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

        // Aviso de antigüedad: si el dato no es de hoy, se dice antes que nada.
        // No es una confirmación extra, es una línea de contexto.
        var avisoViejo = '';
        var fuenteTxt = nombreFuente(bcv && bcv.fuente);

        // Antes acá iban dos avisos: "La tasa sigue siendo la de ayer, BCV no
        // publicó nueva" y "Este es el BCV de <fuente> del <fecha>, ¿lo
        // eliges?". Con el texto nuevo del dueño ("La última tasa publicada
        // conocida es X del <fecha>") los dos dicen lo mismo que el recuadro
        // de abajo, tres líneas antes. Repetir el dato no informa: distrae.
        //
        // Se conserva el caso en que la captura de hoy FALLÓ, porque eso sí es
        // información distinta: no es que el BCV no publicó, es que el sistema
        // no pudo ir a buscarla. Ahí el admin necesita saber que el número que
        // ve puede no ser el último.
        if (e.captura_fallo_hoy && !(bcv && Number(bcv.dias_atras) <= 1)) {
            avisoViejo =
                '<div class="tv-aviso tv-aviso-fallo">' +
                    'No se pudo consultar el BCV hoy. La última captura es de ' +
                    'hace ' + Number(bcv && bcv.dias_atras) + ' días.' +
                '</div>';
        }

        // ── Encabezado ──
        //
        // Texto pedido por el dueño: "Establezca la tasa del día". Antes decía
        // "La tasa del BCV, antes de abrir", que describía el mecanismo en vez
        // de pedir la acción.
        var titulo = 'Establezca la tasa del día';

        // Sin subtítulo, por pedido del dueño: el encabezado va solo.
        var sub = e.ya_revisada
            ? 'Revisada por ' + (e.revisada_por || 'alguien') + '. Puede cambiarla igual.'
            : '';

        // ── Bloque del BCV ──
        var bloqueBcv;

        // Caso incertidumbre: no se pudo consultar el servidor.
        //
        // No se puede verificar la firma del día ni traer una tasa nueva. Se
        // dice tal cual, y se ofrecen solo las salidas que siguen siendo
        // válidas sin conexión: conservar lo que ya está aplicado, o cargar
        // un número a mano. La opción de la "próxima" no aparece porque
        // depende de una consulta.
        if (e.incertidumbre) {
            bloqueBcv =
                '<div class="tv-caja tv-alerta">' +
                    '<div class="tv-titulo">No se pudo verificar la tasa del día</div>' +
                    '<div class="tv-nota">' +
                        'El sistema no pudo consultar el servidor, así que no sabe ' +
                        'si alguien ya la confirmó hoy. Mientras no se pueda verificar, ' +
                        'se cobra con la última tasa conocida.' +
                    '</div>' +
                '</div>' +
                (aplicada > 0 ?
                    '<div class="tv-caja">' +
                        '<div class="tv-titulo">Última tasa conocida</div>' +
                        '<div class="tv-valor">' + aplicada.toFixed(2) + '</div>' +
                    '</div>'
                    : '');
        } else if (!bcv) {
            bloqueBcv =
                '<div class="tv-caja tv-vacia">' +
                    '<div class="tv-titulo">Todavía no hay tasa del BCV</div>' +
                    '<div class="tv-nota">El sistema la busca de lunes a viernes a las 5 pm. ' +
                    'Si esto sigue así, revisá que el cron esté corriendo.</div>' +
                '</div>';
        } else {
            // Texto pedido por el dueño:
            //   "La última tasa publicada conocida es (Monto) del (fecha)"
            // Con la fuente real (dolarapi.com), no "respaldo".
            bloqueBcv =
                '<div class="tv-caja">' +
                    '<div class="tv-titulo">La última tasa publicada conocida</div>' +
                    '<div class="tv-valor">' + Number(bcv.valor).toFixed(2) + '</div>' +
                    '<div class="tv-fecha">' +
                        'Del <strong>' + fechaEnPalabras(bcv.fecha_valor) + '</strong>' +
                        '<span class="tv-tenue"> (' + cuandoFue(bcv.dias_atras) + ')</span>' +
                    '</div>' +
                    '<div class="tv-fuente">' +
                        'Fuente: <strong>' + nombreFuente(bcv.fuente) + '</strong>' +
                    '</div>' +
                '</div>';
        }

        // ── Botones: las tres opciones que pidió el dueño ──
        //
        // 1. Conservar la última conocida.
        // 2. Establecer la próxima conocida (publicada con fecha futura).
        // 3. Introducir manualmente.
        //
        // Cada una tiene una consecuencia distinta y la base ya las conoce:
        // `aplicar_tasa_elegida` acepta origen 'vigente', 'proxima' y 'manual'.
        var proxima = e.proxima;

        var botones = '';

        // ── Opción 1: conservar ──
        // Es el camino corto cuando lo que se está cobrando ya es correcto.
        // Se dice el monto Y la fecha, para que se sepa qué se está
        // conservando sin tener que mirar el recuadro de arriba.
        var etiquetaConservar = 'Conservar ' + aplicada.toFixed(2);
        if (bcv && bcv.fecha_valor) etiquetaConservar += ' del ' + fechaEnPalabras(bcv.fecha_valor);

        botones +=
            '<button class="tv-btn tv-btn-mantener" onclick="window._decidirTasaVentana(\'mantener\')">' +
                '<span class="tv-btn-txt"><i class="fas fa-check"></i> ' + etiquetaConservar + '</span>' +
            '</button>';

        // ── Opción 2: la próxima conocida ──
        //
        // Solo aparece si de verdad hay una publicación con fecha valor
        // futura. Si no hay, no se ofrece: un botón que no lleva a ningún
        // lado es peor que no tenerlo.
        //
        // OJO: elegirla ADELANTA la fecha valor. Por eso `_nivel_confirmacion_tasa`
        // devuelve 1 para este caso ("no es fricción, es una decisión con
        // consecuencia"), y el flujo de abajo vuelve a preguntar. El texto del
        // botón lo dice para que nadie se sorprenda después.
        if (proxima && Number(proxima.valor) > 0 && !e.incertidumbre) {
            botones +=
                '<button class="tv-btn tv-btn-proxima" onclick="window._decidirTasaVentana(\'aplicar_proxima\')">' +
                    '<span class="tv-btn-txt"><i class="fas fa-forward"></i> Establecer la próxima: ' +
                        Number(proxima.valor).toFixed(2) + '</span>' +
                    '<span class="tv-btn-sub">Publicada para el ' +
                        fechaEnPalabras(proxima.fecha_valor) +
                        ' (' + cuandoSera(proxima.dias_adelante) + ')</span>' +
                '</button>';
        }

        // ── Opción 3: manual ──
        botones +=
            '<button class="tv-btn tv-btn-otra" onclick="window._decidirTasaVentana(\'aplicar_otra\')">' +
                '<span class="tv-btn-txt"><i class="fas fa-pen"></i> Introducir manualmente</span>' +
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
                    '<div class="tv-bloqueo">' +
                        'Introduciendo la tasa ya se puede usar el panel' +
                    '</div>' +
                '</div>' +
            '</div>';

        document.body.appendChild(overlay);

        // BLOQUEO DURO. El modal tapa con z-index, pero eso no impide que el
        // teclado, un Tab o un script alcancen lo que está detrás. Se marca
        // como `inert` todo el resto del body: lo saca del árbol de foco y de
        // las tecnologías de asistencia, y ningún clic llega.
        bloquearFondo(overlay);

        // Y mientras esté abierto, el foco se queda adentro.
        overlay.addEventListener('keydown', function (ev) {
            if (ev.key !== 'Tab') return;
            var foco = overlay.querySelectorAll('button:not([disabled])');
            if (!foco.length) { ev.preventDefault(); return; }
            var primero = foco[0], ultimo = foco[foco.length - 1];
            if (ev.shiftKey && document.activeElement === primero) {
                ev.preventDefault(); ultimo.focus();
            } else if (!ev.shiftKey && document.activeElement === ultimo) {
                ev.preventDefault(); primero.focus();
            }
        });

        // El primer botón se lleva el foco: Enter trabaja de una.
        setTimeout(function () {
            var b = overlay.querySelector('button');
            if (b) b.focus();
        }, 60);

        // SIN SALIDA: tocar fuera NO cierra. Es a propósito.
        //
        // Sin tasa confirmada el restaurante no debería operar: los precios se
        // calcularían con un número que nadie validó hoy. Hasta la migración 26
        // esta ventana se podía posponer y eso permitía que el local trabajara
        // con una tasa de hace días sin que nadie firmara.
        overlay.addEventListener('click', function (ev) {
            if (ev.target === overlay) {
                overlay.animate(
                    [{ transform: 'translateX(0)' },
                     { transform: 'translateX(-7px)' },
                     { transform: 'translateX(7px)' },
                     { transform: 'translateX(0)' }],
                    { duration: 220 }
                );
            }
        });
    };

    // ============================================================
    // Bloqueo del fondo
    // ============================================================
    //
    // `inert` es lo que hace el trabajo: deja el elemento y sus hijos fuera del
    // foco, de los clics y de los lectores de pantalla. No cambia el aspecto,
    // así que el panel se sigue viendo detrás, oscurecido por el overlay.
    //
    // Se aplica a los hijos del body (no al body, que contiene al modal) y se
    // recuerda cuáles ya venían inert para no soltarlos de más al cerrar.
    var _inertPrevios = [];

    function bloquearFondo(overlay) {
        _inertPrevios = [];
        var hijos = document.body.children;
        for (var i = 0; i < hijos.length; i++) {
            var el = hijos[i];
            if (el === overlay) continue;
            _inertPrevios.push({ el: el, yaEra: el.hasAttribute('inert') });
            try { el.setAttribute('inert', ''); } catch (e) {}
            // Respaldo para navegadores sin `inert`: nada clickeable.
            el.style.pointerEvents = 'none';
        }
        // El scroll de la página tampoco: no tiene sentido moverse por una
        // pantalla que no se puede usar.
        document.documentElement.style.overflow = 'hidden';
    }

    function liberarFondo() {
        _inertPrevios.forEach(function (r) {
            if (!r.yaEra) {
                try { r.el.removeAttribute('inert'); } catch (e) {}
                r.el.style.pointerEvents = '';
            }
        });
        _inertPrevios = [];
        document.documentElement.style.overflow = '';
    }

    // ============================================================
    // Cerrar sin decidir
    // ============================================================
    // Se conserva el nombre por compatibilidad, pero ya NO es una salida libre:
    // el modal no se cierra sin decidir. Solo se llama desde `_decidirTasaVentana`.
    window._cerrarVentanaTasa = function () {
        var o = document.getElementById(_idVentana);
        if (o) o.remove();
        liberarFondo();

    };

    // Acá vivía `cerradaHacePoco()`, el mecanismo de "lo veo después" con
    // silencio de 90 minutos y tope a la tercera postergación. Se retiró
    // completo cuando la ventana pasó a ser bloqueante: ya no hay botón de
    // posponer, así que la función no se invocaba desde ningún lado y solo
    // dejaba dos claves escritas en sessionStorage que nadie leía.
    //
    // REA lo detectó como inventario de almacenamiento persistente
    // (`saki_ventana_tasa_cerrada` y `saki_ventana_tasa_veces`), que fue la
    // pista para encontrarlo.

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

        // ── Opción 2: establecer la próxima conocida ──
        //
        // Se adelanta una publicación que todavía no rige. La base ya lo
        // contempla: origen 'proxima' y fecha valor futura hacen que
        // `_nivel_confirmacion_tasa` devuelva 1, así que el flujo de abajo
        // vuelve a pedir confirmación. Es a propósito: cobrar con la tasa de
        // mañana cambia el precio de todos los platos hoy.
        if (accion === 'aplicar_proxima') {
            var prox = e.proxima;
            if (!prox) return;
            valor = Number(prox.valor);
            nota  = 'Se estableció por adelantado la tasa publicada para el ' +
                    fechaEnPalabras(prox.fecha_valor) + ' (origen: proxima)';
        }

        if (accion === 'mantener') {
            nota = 'Se mantuvo la tasa vigente sin cambios';
        }

        // ── Si hay que aplicar un número, se usa el camino único de la 23 ──
        if (valor !== null) {
            var origen;
            if (accion === 'aplicar_bcv')          origen = 'vigente';
            else if (accion === 'aplicar_proxima') origen = 'proxima';
            else                                   origen = 'manual';

            // La fecha valor viaja con la captura que se está eligiendo. Para
            // la manual es null (es de hoy); para las otras dos es la de la
            // publicación, aunque sea futura.
            var fecha = null;
            if (accion === 'aplicar_bcv')          fecha = (bcv  && bcv.fecha_valor)  || null;
            else if (accion === 'aplicar_proxima') fecha = (e.proxima && e.proxima.fecha_valor) || null;

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
        //
        // OJO: antes, si esto fallaba, solo se hacía un console.warn y la
        // ventana se cerraba igual. O sea: el admin creía haber firmado, el
        // día quedaba sin firma, y la ventana volvía en la próxima apertura
        // sin explicación. Ahora, si no se puede firmar, NO se cierra: se
        // avisa y se deja la ventana abierta.
        var r3;
        try {
            r3 = await window.supabaseClient.rpc('confirmar_revision_tasa', {
                p_accion: accion,
                p_nota:   nota
            });
        } catch (err) {
            r3 = { error: err };
        }

        if (!r3 || r3.error || (r3.data && r3.data.success === false)) {
            var msg = (r3 && r3.error && r3.error.message) ||
                      (r3 && r3.data && r3.data.error) ||
                      'sin conexión con el servidor';
            console.warn('confirmar_revision_tasa:', msg);
            // No se cierra la ventana: la decisión NO quedó registrada.
            window.mostrarToast &&
                window.mostrarToast('❌ No se pudo registrar la decisión: ' + msg, 'error');
            return;
        }

        // Cerrar y refrescar
        var o = document.getElementById(_idVentana);
        if (o) o.remove();
        liberarFondo();

        // No hace falta marcar nada en sessionStorage. La decisión quedó
        // escrita en `tasa_revision_diaria`, así que `necesita_revision` va a
        // dar false por sí sola. Si la escritura falló, ya se salió más arriba
        // sin cerrar la ventana.

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
                        liberarFondo();
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
    // Se llama después del login. No molesta si ya se revisó hoy.
    window.arrancarVentanaTasa = async function (opciones) {
        opciones = opciones || {};
        try {
            // Ya no existe el "lo veo después": sin decisión del día no hay
            // panel. La ventana bloquea, y la decisión se guarda en la base.
            var e = await window.consultarVentanaTasa();
            window.escucharRevisionTasaCompartida();
            if (!e) return;

            if (!opciones.forzar && !e.necesita_revision) return;

            await window.abrirVentanaTasa(opciones.forzar);

            // Si no hay ninguna tasa capturada, no se puede firmar. En ese caso
            // se avisa en vez de dejar el panel libre sin explicación.
            if (!e.bcv) {
                console.warn('[tasa] no hay ninguna captura del BCV: no se puede confirmar');
            }
        } catch (err) {
            console.warn('arrancarVentanaTasa:', err.message);
        }
    };

})();
