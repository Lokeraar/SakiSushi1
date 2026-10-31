// admin-config.js - Configuración de tasa de cambio y parámetros globales
(function() {
    window.cargarConfiguracion = async function() {
        try {
            // Verificar que haya token JWT antes de hacer la consulta
            if (!window.jwtToken) {
                console.warn('⚠️ No hay token JWT, usando configuración por defecto');
                return;
            }
            
            const { data, error } = await window.supabaseClient
                .from('config')
                .select('*')
                .eq('id', 1)
                .single();
            
            // Si hay error 401, no lanzar excepción, usar valores por defecto
            if (error) {
                if (error.status === 401 || error.code === 'PGRST301') {
                    console.warn('⚠️ Token expirado o sin permisos para cargar configuración');
                    return;
                }
                throw error;
            }
            
            window.configGlobal = data || {};
            
            window.configGlobal.tasa_cambio = window.configGlobal.tasa_cambio || 400;
            window.configGlobal.tasa_efectiva = window.configGlobal.tasa_efectiva || 400;
            window.configGlobal.aumento_diario = window.configGlobal.aumento_diario || 0;
            window.configGlobal.aumento_activo = window.configGlobal.aumento_activo || false;
            window.configGlobal.aumento_semanal = window.configGlobal.aumento_semanal || false;
            
        } catch (e) {
            // No mostrar error en consola si es un error 401 o de JWT (ya se manejó arriba)
            if (!(e.status === 401 || e.code === 'PGRST301' || (e.message && e.message.includes('JWT')))) {
                console.error('Error cargando configuración:', e);
            }
            window.configGlobal = {
                tasa_cambio: 400,
                tasa_efectiva: 400,
                aumento_diario: 0,
                aumento_activo: false,
                aumento_semanal: false
            };
        }
    };

    // El botón de consulta no necesita estado visual propio: la ventana del
    // día es la que informa si la tasa ya está firmada. Acá vivía
    // `_actualizarVisibilidadBotonBCV`, que atenuaba el botón y le colgaba un
    // chip "✅ Tasa configurada hoy". Se retiró junto con el modal viejo: era
    // decoración de un flujo que ya no existe, y el dato bueno (¿está firmada
    // hoy?) lo da `estado_revision_tasa()` en el panel de la tasa.

    window.cargarConfiguracionInicial = async function() {
        await window.cargarConfiguracion();
        window.actualizarTasaUI();
        window.recalcularTasaEfectiva();
        window.actualizarMenuTasaBanner();
    };

    window.actualizarTasaUI = function() {
        document.getElementById('tasaBaseInput').value      = window.configGlobal.tasa_cambio || 400;
        document.getElementById('aumentoDiarioInput').value = window.configGlobal.aumento_diario || 0;
        document.getElementById('aumentoActivoToggle').checked = window.configGlobal.aumento_activo || false;
        const semEl = document.getElementById('aumentoSemanalToggle');
        if (semEl) semEl.checked = window.configGlobal.aumento_semanal || false;
        // Se restaura el toggle de "detener" con el valor guardado.
        const detEl = document.getElementById('aumentoDetenidoToggle');
        if (detEl) detEl.checked = window.configGlobal.aumento_detenido === true;
        document.getElementById('tasaEfectivaDisplay').textContent = (window.configGlobal.tasa_efectiva || 400).toFixed(2);

        // Interruptor de descuento al quitar ingredientes. Si la columna no
        // llegó (versión vieja), se muestra encendido: es el comportamiento
        // histórico y el menos sorpresivo.
        var chkDescuento = document.getElementById('descuentoAlQuitar');
        if (chkDescuento) {
            chkDescuento.checked = window.configGlobal.descuento_al_quitar !== false;
        }
        document.getElementById('aumentoAcumuladoDisplay').textContent = (window.configGlobal.aumento_acumulado || 0).toFixed(2) + '%';
        if (window.configGlobal.aumento_desde && document.getElementById('aumentoDesde'))
            document.getElementById('aumentoDesde').value = window.configGlobal.aumento_desde.split('T')[0];
        if (window.configGlobal.aumento_hasta && document.getElementById('aumentoHasta'))
            document.getElementById('aumentoHasta').value = window.configGlobal.aumento_hasta.split('T')[0];
        if (window.configGlobal.aumento_indefinido && document.getElementById('aumentoIndefinido'))
            document.getElementById('aumentoIndefinido').checked = true;
        // Mostrar fechas card si hay aumento activo (diario o semanal) O si está marcado indefinido
        const algunAumentoActivo = (window.configGlobal.aumento_activo || window.configGlobal.aumento_semanal || window.configGlobal.aumento_indefinido);
        document.getElementById('tasaFechasDiv').style.display = algunAumentoActivo ? 'flex' : 'none';
        if (typeof _actualizarLabelAumento === 'function') _actualizarLabelAumento();
    };

    window.actualizarMenuTasaBanner = window.actualizarTasaUI;

    window.recalcularTasaEfectiva = function() {
        const tasaBaseInput = document.getElementById('tasaBaseInput');
        if (tasaBaseInput && window.configGlobal) {
            window.configGlobal.tasa_cambio = parseFloat(tasaBaseInput.value) || 0;
        }
        const tasaBase     = parseFloat(document.getElementById('tasaBaseInput').value) || 0;
        const aumentoPct   = parseFloat(document.getElementById('aumentoDiarioInput').value) || 0;
        const activoDiario  = document.getElementById('aumentoActivoToggle').checked;
        const activoSemanal = document.getElementById('aumentoSemanalToggle') &&
                              document.getElementById('aumentoSemanalToggle').checked;
        const estaActivo   = activoDiario || activoSemanal;
        const detenido     = document.getElementById('aumentoDetenidoToggle') &&
                             document.getElementById('aumentoDetenidoToggle').checked;
        const indefinido   = document.getElementById('aumentoIndefinido') &&
                             document.getElementById('aumentoIndefinido').checked;
        const desdeVal     = document.getElementById('aumentoDesde')?.value || '';
        const hastaVal     = !indefinido ? (document.getElementById('aumentoHasta')?.value || '') : '';

        let periodos = 0;

        // ── El estado "detenido" congela el acumulado ──
        //
        // Si está detenido, el aumento deja de crecer pero lo ya acumulado se
        // sigue cobrando. La forma de lograrlo sin inventar otra columna es
        // congelar el fin del conteo: se cuentan los períodos hasta la fecha en
        // que se detuvo (`fecha_ultimo_aumento`), no hasta hoy. Así el número
        // queda fijo en vez de seguir subiendo día tras día.
        //
        // Ojo con la diferencia: si además se apagan los dos toggles de
        // "activo", `estaActivo` es false, periodos queda en 0 y la efectiva
        // vuelve a la base. Eso es "desactivar el recargo", que es otra cosa.
        // ── ¿Hay recargo vigente? ──
        //
        // Tres estados, no dos. Esta cuenta decide todo lo demás:
        //   activo   -> `estaActivo` y sube.
        //   detenido -> no sube, pero conserva lo acumulado.
        //   ninguno  -> se cobra la base, sin recargo.
        //
        // Antes el congelado vivía dentro de `if (estaActivo ...)`, así que
        // marcar "Detener" con los dos toggles apagados dejaba periodos en 0 y
        // la efectiva caía a la base, mientras la migración 34 sí lo contaba
        // como recargo. Cliente y servidor decían cosas distintas.
        const hayRecargo   = estaActivo || detenido;

        const finCongelado = detenido && window.configGlobal && window.configGlobal.fecha_ultimo_aumento
            ? new Date(String(window.configGlobal.fecha_ultimo_aumento).split('T')[0] + 'T00:00:00')
            : null;

        if (hayRecargo && desdeVal) {
            const hoy        = new Date(); hoy.setHours(0,0,0,0);
            const desdeDate  = new Date(desdeVal + 'T00:00:00');
            const hastaDate  = hastaVal ? new Date(hastaVal + 'T00:00:00') : null;

            if (desdeDate <= hoy) {
                // Si está detenido, el conteo se corta donde se detuvo.
                let finEfectivo = hastaDate && hastaDate < hoy ? hastaDate : hoy;
                if (finCongelado && finCongelado < finEfectivo) finEfectivo = finCongelado;
                const msDay      = 24 * 60 * 60 * 1000;
                const msPeriodo  = activoSemanal ? 7 * msDay : msDay;
                const diffMs     = finEfectivo - desdeDate;
                periodos = Math.max(0, Math.floor(diffMs / msPeriodo) + 1);
            }
        }

        const aumentoAcumulado = periodos * aumentoPct;
        const tasaEfectiva     = tasaBase * (1 + aumentoAcumulado / 100);

        console.group('%c🔄 Saki Sushi — Cálculo de Tasa', 'color:#FF9800;font-weight:700');
        console.log('Modo activo:', estaActivo ? (activoSemanal ? 'SEMANAL' : 'DIARIO') : (detenido ? 'DETENIDO' : 'DESACTIVADO'));
        console.log('Detenido (congela acumulado):', detenido ? 'SÍ' : 'no');
        if (finCongelado) console.log('Aumento congelado al:', finCongelado.toISOString().split('T')[0]);
        console.log('Fecha inicio (Desde):', desdeVal || '—');
        console.log('Fecha fin   (Hasta): ', hastaVal || (indefinido ? 'Indefinido' : '—'));
        if (hayRecargo && desdeVal) {
            const _hoyLog = new Date(); _hoyLog.setHours(0,0,0,0);
            const _desdeLog = new Date(desdeVal + 'T00:00:00');
            const _msD = 24*60*60*1000;
            const _mpLog = activoSemanal ? 7*_msD : _msD;
            const _diffDias = Math.floor((_hoyLog - _desdeLog) / _msD);
            console.log('Días transcurridos desde "Desde":', _diffDias);
            console.log('Períodos ' + (activoSemanal ? 'semanales' : 'diarios') + ' completados:', periodos);
        }
        console.log('Porcentaje por período:', aumentoPct + '%');
        console.log('Períodos aplicados:', periodos);
        console.log('Acumulado total:', aumentoAcumulado.toFixed(2) + '%');
        console.log('Tasa Base:', tasaBase);
        console.log('Tasa Efectiva 💵 Bs', tasaEfectiva.toFixed(2));
        console.groupEnd();

        document.getElementById('tasaEfectivaDisplay').textContent = tasaEfectiva.toFixed(2);
        document.getElementById('aumentoAcumuladoDisplay').textContent = aumentoAcumulado.toFixed(2) + '%';
        if (document.getElementById('tasaEfectivaCard'))
            document.getElementById('tasaEfectivaCard').textContent = 'Bs. ' + tasaEfectiva.toFixed(2);

        window.configGlobal.tasa_cambio       = tasaBase;
        window.configGlobal.aumento_diario    = aumentoPct;
        window.configGlobal.aumento_activo    = activoDiario;
        window.configGlobal.aumento_semanal   = activoSemanal;
        window.configGlobal.aumento_detenido  = detenido;
        window.configGlobal.aumento_acumulado = aumentoAcumulado;
        window.configGlobal.tasa_efectiva     = tasaEfectiva;
    };

    window.guardarConfiguracion = async function() {
        try {
            const tasaBase = parseFloat(document.getElementById('tasaBaseInput').value) || 0;
            const aumentoPct = parseFloat(document.getElementById('aumentoDiarioInput').value) || 0;
            const activoDiario = document.getElementById('aumentoActivoToggle').checked;
            const activoSemanal = document.getElementById('aumentoSemanalToggle')?.checked || false;
            const indefinido = document.getElementById('aumentoIndefinido')?.checked || false;

            // ── Guardas antes de escribir ──
            // Este es el único punto donde el aumento entra a la base, así que
            // es donde tiene que doler si el valor no tiene sentido. Un dedazo
            // acá descuadra TODOS los precios del restaurante.
            if (!(tasaBase > 0)) {
                window.mostrarToast('❌ La tasa base debe ser mayor que 0', 'error');
                return;
            }
            if (aumentoPct < 0) {
                window.mostrarToast('❌ El aumento no puede ser negativo', 'error');
                return;
            }
            if (aumentoPct > 100) {
                window.mostrarToast('❌ Un aumento de ' + aumentoPct + '% por periodo es imposible. Revisá el valor.', 'error');
                return;
            }
            // Aviso, no bloqueo: un aumento alto puede ser legítimo en una
            // emergencia cambiaria, pero el admin tiene que confirmarlo sabiendo.
            if (aumentoPct > 5) {
                const sigue = confirm(
                    'Vas a guardar un aumento de ' + aumentoPct + '% por periodo.\n\n' +
                    'Para referencia, el ajuste pensado para compensar inflación es del orden de 0.01%.\n\n' +
                    '¿Confirmás que es intencional?'
                );
                if (!sigue) return;
            }

            window.configGlobal.tasa_cambio = tasaBase;
            window.configGlobal.aumento_diario = aumentoPct;
            window.configGlobal.aumento_activo = activoDiario;
            window.configGlobal.aumento_semanal = activoSemanal;
            
            window.recalcularTasaEfectiva();
            
            await window.supabaseClient.from('config').update({
                tasa_cambio:       window.configGlobal.tasa_cambio,
                aumento_diario:    window.configGlobal.aumento_diario,
                aumento_activo:    window.configGlobal.aumento_activo,
                aumento_semanal:   window.configGlobal.aumento_semanal || false,
                aumento_detenido:  window.configGlobal.aumento_detenido === true,
                aumento_acumulado: window.configGlobal.aumento_acumulado,
                tasa_efectiva:     window.configGlobal.tasa_efectiva,
                aumento_desde:     (document.getElementById('aumentoDesde') && document.getElementById('aumentoDesde').value) || null,
                aumento_hasta:     (!document.getElementById('aumentoIndefinido')?.checked && document.getElementById('aumentoHasta')?.value) || null,
                aumento_indefinido: document.getElementById('aumentoIndefinido')?.checked || false,
                // Decisión de negocio: ¿quitar un ingrediente abarata el plato?
                descuento_al_quitar: document.getElementById('descuentoAlQuitar')?.checked ?? true,
                ultima_actualizacion: new Date().toISOString()
            }).eq('id', 1);

            // ── DEJAR RASTRO DE LA TASA ──
            //
            // Este botón escribe la configuración completa (aumento, fechas,
            // descuento) y sigue siendo el único lugar que calcula la tasa
            // efectiva con el aumento acumulado. Eso está bien: es la función
            // de negocio que pidió el dueño.
            //
            // Lo que le faltaba era el registro. Si el admin fija la tasa desde
            // acá, el sistema no guardaba de dónde salió ni dejaba constancia de
            // que hoy alguien la confirmó. Con la tasa siendo bloqueante, eso
            // dejaba el día sin firma.
            //
            // Se llama a las dos funciones de auditoría sin tocar el valor ya
            // escrito: `registrar_tasa_bcv` anota la captura, y
            // `confirmar_revision_tasa` firma el día.
            try {
                await window.supabaseClient.rpc('registrar_tasa_bcv', {
                    p_valor:        tasaBase,
                    p_fecha_valor:  new Date().toLocaleDateString('en-CA', { timeZone: 'America/Caracas' }),
                    p_fuente:       'manual_admin',
                    p_es_principal: false
                });
                await window.supabaseClient.rpc('confirmar_revision_tasa', {
                    p_accion: 'aplicar_otra',
                    p_nota:   'Tasa fijada desde el panel de configuración'
                });
            } catch (e) {
                // Si falla el registro no se aborta el guardado: el valor ya
                // quedó escrito y el admin tiene que poder trabajar.
                console.warn('[tasa] no se pudo registrar la firma del día:', e.message);
            }

            window.renderizarMenu(document.getElementById('menuBuscador')?.value || '');
            await window._actualizarVentasHoyNeto();
            await window._actualizarDeliverysHoy();
            
            window.configGlobal.descuento_al_quitar =
                document.getElementById('descuentoAlQuitar')?.checked ?? true;

            const tasaDisplay = document.getElementById('tasaEfectivaDisplay');
            if (tasaDisplay) {
                tasaDisplay.textContent = (window.configGlobal.tasa_efectiva || 0).toFixed(2);
            }
            
            window.mostrarToast(`💱 Configuración guardada. Nueva tasa efectiva: Bs ${(window.configGlobal.tasa_efectiva || 0).toFixed(2)} por USD`, 'success');
            
        } catch (e) { 
            console.error('Error guardando configuración:', e); 
            window.mostrarToast('❌ Error al guardar la configuración', 'error'); 
        }
    };

    // ── Consulta del BCV (sin modal, sin escribir nada) ──
    //
    // Acá vivía un modal propio que ofrecía "Usar esta tasa" y escribía con
    // `guardarConfiguracion()`. Era un segundo camino para fijar la tasa, y el
    // peor: no dejaba firma en `tasa_revision_diaria`, no sabía de la fecha
    // valor y no pasaba por `aplicar_tasa_elegida`. Como además la ventana
    // buena ya lo hace todo, al elegir "Conservar" aparecían DOS modales
    // seguidos pidiendo lo mismo.
    //
    // Se retira el modal y queda solo la consulta, que es lo único que otro
    // módulo (`admin-tasa-aviso.js`) necesitaba. Es la misma limpieza que se
    // hizo con la ventana vieja "Tasa de Hoy" del cajero.
    window.obtenerTasaBCV = async function() {
        try {
            const detalle = await window.obtenerTasaBCVDetalle({ forzar: true });
            if (!detalle || !(detalle.valor > 0)) return null;
            return detalle.valor;
        } catch (e) {
            console.warn('No se pudo consultar el BCV:', e.message);
            return null;
        }
    };


    // ── Elegir la tasa del BCV ──────────────────────────────────────────────
    //
    // Antes el botón traía una sola tasa y la escribía en el campo sin
    // preguntar. El problema es que hay dos tasas publicadas a la vez: la
    // vigente y la de la fecha próxima, que el BCV adelanta la noche anterior.
    // Escribir una u otra sin que el admin elija es decidir por él.
    //
    // Ahora abre una ventana con las dos y aplica la elegida. Sigue sin escribir
    // en la base: llena el campo y el admin revisa y guarda. El camino que deja
    // firma es la ventana bloqueante, no este botón.

    function _fechaBCV(iso) {
        if (!iso) return '—';
        var d = new Date(String(iso) + 'T12:00:00');
        if (isNaN(d)) return iso;
        var dias = ['domingo', 'lunes', 'martes', 'miércoles', 'jueves', 'viernes', 'sábado'];
        var dd = String(d.getDate()).padStart(2, '0');
        var mm = String(d.getMonth() + 1).padStart(2, '0');
        return dias[d.getDay()] + ' ' + dd + '/' + mm;
    }

    function _cuandoBCV(dias) {
        var n = Number(dias);
        if (isNaN(n)) return '';
        if (n === 0) return 'de hoy';
        if (n < 0) return n === -1 ? 'mañana' : 'en ' + Math.abs(n) + ' días';
        if (n === 1) return 'de ayer';
        return 'hace ' + n + ' días';
    }

    // Una tarjeta elegible por tasa. devuelve el HTML; data-valor lo lee el clic.
    function _opcionBCV(titulo, dato, valorActual) {
        if (!dato) return '';
        var valor = Number(dato.valor);
        var esActual = Math.abs(valor - Number(valorActual || 0)) < 0.005;
        // dias_para cuenta hacia ADELANTE (la próxima) y dias_atras hacia ATRÁS.
        // Se normaliza a un solo eje con signo: negativo = futuro.
        var cuando = dato.dias_para !== undefined
            ? _cuandoBCV(-Math.abs(Number(dato.dias_para)))
            : _cuandoBCV(dato.dias_atras);
        return '' +
            '<button type="button" class="bcv-opcion" data-valor="' + valor + '">' +
                '<span class="bcv-opcion-top">' +
                    '<span class="bcv-opcion-titulo">' + titulo + '</span>' +
                    (esActual ? '<span class="bcv-opcion-chip">la que usás</span>' : '') +
                '</span>' +
                '<span class="bcv-opcion-valor">' + valor.toFixed(2) + '</span>' +
                '<span class="bcv-opcion-fecha">Fecha valor: ' + _fechaBCV(dato.fecha_valor) +
                    (cuando ? ' (' + cuando + ')' : '') + '</span>' +
                (dato.fuente ? '<span class="bcv-opcion-fuente">' + dato.fuente + '</span>' : '') +
            '</button>';
    }

    window.cerrarModalBCV = function () {
        var m = document.getElementById('bcvModal');
        if (m) m.classList.remove('active');
    };

    window.abrirModalBCV = async function (btn) {
        var cont = document.getElementById('bcvOpciones');
        var modal = document.getElementById('bcvModal');
        if (!cont || !modal) return;

        cont.innerHTML = '<p style="text-align:center;opacity:.6;font-size:.85rem;padding:1rem">' +
            '<i class="fas fa-spinner fa-spin"></i> Consultando…</p>';
        modal.classList.add('active');

        try {
            if (!window.supabaseClient) throw new Error('sin conexión');
            var r = await window.supabaseClient.rpc('tasa_panel');
            if (r.error) throw new Error(r.error.message);

            var d = r.data || {};
            var actual = Number((d.aplicada || {}).tasa_cambio || 0);
            var html = _opcionBCV('Vigente', d.bcv, actual) +
                       _opcionBCV('Próxima', d.proxima, actual);

            if (!html) {
                // Desde la migración 37 la ventana solo ofrece lo que publicó
                // una fuente. Si el admin cargó un número a mano y todavía no
                // hay captura del BCV, el mensaje tiene que decir eso y no
                // dejar creer que el sistema está roto.
                var manual = Number(actual || 0);
                cont.innerHTML =
                    '<p style="text-align:center;opacity:.75;font-size:.85rem;padding:.5rem 1rem;line-height:1.45">' +
                        'El BCV todavía no tiene ninguna tasa capturada.' +
                        (manual > 0
                            ? '<br><br>Estás cobrando con <strong>' + manual.toFixed(2) +
                              '</strong>, que se cargó a mano. Esa cifra no la publicó el BCV, ' +
                              'así que no aparece acá.'
                            : '') +
                    '</p>';
                return;
            }
            cont.innerHTML = html;

            Array.prototype.forEach.call(cont.querySelectorAll('.bcv-opcion'), function (op) {
                op.addEventListener('click', function () {
                    var v = Number(op.getAttribute('data-valor'));
                    if (!(v > 0)) return;
                    var input = document.getElementById('tasaBaseInput');
                    if (input) {
                        input.value = v.toFixed(2);
                        // recalcularTasaEfectiva es lo que mantiene coherente la
                        // tarjeta de al lado; sin esto el campo cambia y el
                        // número grande se queda con el valor viejo.
                        if (window.recalcularTasaEfectiva) window.recalcularTasaEfectiva();
                        input.focus();
                        input.select();
                    }
                    window.cerrarModalBCV();
                    window.mostrarToast('📝 Tasa aplicada: ' + v.toFixed(2) +
                        '. Revisala y guardá si corresponde.', 'info');
                });
            });
        } catch (e) {
            console.error('Error consultando el BCV:', e);
            cont.innerHTML = '<p style="text-align:center;opacity:.8;font-size:.85rem;padding:1rem;color:var(--danger)">' +
                'No se pudieron leer las tasas del BCV. Probá de nuevo en un momento.</p>';
        }
    };

    // Agregar el botón "Consultar el BCV" al lado del botón Guardar.
    (function _agregarBotonBCV() {
        const saveWrap = document.querySelector('.tcb-save-wrap');
        if (!saveWrap) return;
        const btn = document.createElement('button');
        btn.id = 'btnObtenerTasaBCV';
        btn.className = 'btn-secondary tcb-save-btn';
        btn.style.marginLeft = '8px';
        // Dos líneas: en un teléfono "Consultar el BCV" no entra en una sola y
        // desbordaba al lado del botón Guardar.
        btn.innerHTML = '<i class="fas fa-satellite-dish"></i> Consultar<br>el BCV';
        btn.onclick = function () { window.abrirModalBCV(btn); };
        saveWrap.appendChild(btn);
    })();
})();
