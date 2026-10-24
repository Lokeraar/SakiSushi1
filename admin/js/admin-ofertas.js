// admin-ofertas.js — Ofertas con fecha y hora
//
// CÓMO LO USA EL ADMIN
//
// Abre un platillo, y en el bloque naranja "Oferta" carga tres datos:
//   - precio de oferta
//   - desde cuándo
//   - hasta cuándo
//
// El PORCENTAJE no lo carga nadie: lo calcula la base. Así nunca queda un
// cartel que diga "-20%" cuando en realidad es -15%.
//
// SE APAGA SOLA
//
// No hay nada que el admin tenga que desactivar. La base decide si la oferta
// está vigente comparando la hora actual con "desde" y "hasta". Si el admin
// nunca abre el panel, la oferta igual vence.
//
// SE GUARDA LA OFERTA VENCIDA
//
// Una oferta de Halloween que terminó queda en la base, apagada. El año que
// viene se abre el platillo, se cambian las fechas y vuelve a funcionar. No se
// pierde el trabajo.

(function () {
    'use strict';

    // ============================================================
    // Formato de fechas
    // ============================================================

    /** De ISO (lo que viene de la base) a lo que espera un input datetime-local. */
    function isoAInput(iso) {
        if (!iso) return '';
        var d = new Date(iso);
        if (isNaN(d.getTime())) return '';
        // Hay que restar el desfase para que el input muestre la hora LOCAL.
        // Sin esto, una oferta cargada para las 20:00 aparecería a las 00:00
        // del día siguiente según la zona del navegador.
        var local = new Date(d.getTime() - d.getTimezoneOffset() * 60000);
        return local.toISOString().slice(0, 16);
    }

    /** De input datetime-local a ISO para la base. */
    function inputAIso(valor) {
        if (!valor) return null;
        var d = new Date(valor);
        if (isNaN(d.getTime())) return null;
        return d.toISOString();
    }

    // ============================================================
    // Cargar los datos de oferta al abrir un platillo
    // ============================================================

    window.cargarOfertaEnModal = function (platillo) {
        var precioEl = document.getElementById('platilloPrecioOferta');
        var desdeEl  = document.getElementById('platilloOfertaDesde');
        var hastaEl  = document.getElementById('platilloOfertaHasta');
        var btnQuitar = document.getElementById('quitarOfertaBtn');
        if (!precioEl) return;

        var tieneOferta = platillo && platillo.precio_oferta != null;

        precioEl.value = tieneOferta ? platillo.precio_oferta : '';
        if (desdeEl) desdeEl.value = tieneOferta ? isoAInput(platillo.oferta_desde) : '';
        if (hastaEl) hastaEl.value = tieneOferta ? isoAInput(platillo.oferta_hasta) : '';

        // El botón de quitar solo tiene sentido si hay algo que quitar.
        if (btnQuitar) btnQuitar.style.display = tieneOferta ? 'inline-flex' : 'none';

        window._previewOferta();
    };

    // ============================================================
    // Vista previa
    // ============================================================

    window._previewOferta = function () {
        var cont = document.getElementById('ofertaPreview');
        if (!cont) return;

        var oferta = parseFloat(document.getElementById('platilloPrecioOferta')?.value);
        var normal = parseFloat(document.getElementById('platilloPrecio')?.value);
        var desde  = document.getElementById('platilloOfertaDesde')?.value;
        var hasta  = document.getElementById('platilloOfertaHasta')?.value;

        if (isNaN(oferta) || oferta <= 0) {
            cont.innerHTML = 'Sin oferta: el plato se muestra a su precio normal.';
            cont.style.color = 'var(--text-muted)';
            return;
        }

        if (!isNaN(normal) && oferta >= normal) {
            cont.innerHTML = '⚠️ El precio de oferta tiene que ser menor que el normal (' +
                normal.toFixed(2) + ')';
            cont.style.color = '#ef4444';
            return;
        }

        if (desde && hasta && new Date(hasta) <= new Date(desde)) {
            cont.innerHTML = '⚠️ La fecha de fin tiene que ser posterior a la de inicio';
            cont.style.color = '#ef4444';
            return;
        }

        // El porcentaje se redondea a entero: -30, no -30,0000.
        var pct = (!isNaN(normal) && normal > 0)
            ? Math.round((1 - (oferta / normal)) * 100)
            : 0;

        var ahora = new Date();
        var estado, color;
        if (desde && new Date(desde) > ahora) {
            estado = 'programada, empieza el ' + new Date(desde).toLocaleString('es-VE');
            color = '#3b82f6';
        } else if (hasta && new Date(hasta) <= ahora) {
            estado = 'ya vencida, el plato se muestra a precio normal';
            color = '#ef4444';
        } else {
            estado = 'activa ahora';
            color = '#4ade80';
        }

        cont.innerHTML = '<strong style="color:' + color + '">-' + pct + '%</strong>' +
            ' · ' + normal.toFixed(2) + ' → ' + oferta.toFixed(2) + ' USD' +
            ' · <span style="color:' + color + '">' + estado + '</span>';
        cont.style.color = 'var(--text-muted)';
    };

    // ============================================================
    // Quitar la oferta
    // ============================================================

    window._quitarOfertaPlatillo = function () {
        document.getElementById('platilloPrecioOferta').value = '';
        document.getElementById('platilloOfertaDesde').value = '';
        document.getElementById('platilloOfertaHasta').value = '';
        var btn = document.getElementById('quitarOfertaBtn');
        if (btn) btn.style.display = 'none';
        window._previewOferta();
        if (window.mostrarToast) {
            window.mostrarToast('Oferta quitada. Guardá el platillo para aplicarlo.', 'info');
        }
    };

    // ============================================================
    // Guardar (lo llama el guardado del platillo)
    // ============================================================

    /**
     * Guarda la oferta del platillo que se está editando.
     *
     * Se llama DESPUÉS de guardar el platillo, porque necesita que el platillo
     * ya exista. Devuelve true si hay oferta guardada.
     */
    window.guardarOfertaDelPlatillo = async function (platilloId) {
        if (!platilloId || !window.supabaseClient) return false;

        var ofertaEl = document.getElementById('platilloPrecioOferta');
        var desdeEl  = document.getElementById('platilloOfertaDesde');
        var hastaEl  = document.getElementById('platilloOfertaHasta');
        if (!ofertaEl) return false;

        var oferta = parseFloat(ofertaEl.value);
        var sinOferta = isNaN(oferta) || oferta <= 0;

        try {
            var { data, error } = await window.supabaseClient.rpc('guardar_oferta_platillo', {
                p_platillo_id:   platilloId,
                p_precio_oferta: sinOferta ? null : oferta,
                p_desde:         desdeEl && desdeEl.value ? inputAIso(desdeEl.value) : null,
                p_hasta:         hastaEl && hastaEl.value ? inputAIso(hastaEl.value) : null
            });
            if (error) throw error;

            if (data && data.success === false) {
                window.mostrarToast('⚠️ Oferta: ' + data.error, 'warning');
                return false;
            }

            if (data && data.success && data.oferta_activa) {
                window.mostrarToast('🏷️ Oferta activa: -' + data.descuento_pct + '%', 'success');
            }
            return !!(data && data.success);
        } catch (e) {
            window.mostrarToast('⚠️ No se pudo guardar la oferta: ' + (e.message || e), 'warning');
            return false;
        }
    };

    // ============================================================
    // Panel de ofertas: ver todas de un vistazo
    // ============================================================

    window.cargarOfertasAdmin = async function () {
        if (!window.supabaseClient) return [];
        try {
            var { data, error } = await window.supabaseClient
                .from('ofertas_admin')
                .select('*')
                .order('oferta_desde', { ascending: false });
            if (error) throw error;
            window._ofertasAdmin = data || [];
            window.renderizarOfertasAdmin();
            return window._ofertasAdmin;
        } catch (e) {
            console.warn('[ofertas] no se pudieron cargar:', e.message);
            return [];
        }
    };

    window.renderizarOfertasAdmin = function () {
        var cont = document.getElementById('adminOfertasLista');
        if (!cont) return;

        var lista = window._ofertasAdmin || [];
        if (!lista.length) {
            cont.innerHTML = '<p style="opacity:.6;font-size:.82rem;margin:0">' +
                'No hay ofertas cargadas. Abrí un platillo y cargá una en el bloque naranja.</p>';
            return;
        }

        var colores = {
            activa:      { c: '#4ade80', t: 'Activa' },
            programada:  { c: '#3b82f6', t: 'Programada' },
            vencida:     { c: '#ef4444', t: 'Vencida' }
        };

        cont.innerHTML = lista.map(function (o) {
            var e = colores[o.estado] || { c: '#9ca3af', t: o.estado };
            var fechas = [];
            if (o.oferta_desde) fechas.push('desde ' + new Date(o.oferta_desde).toLocaleString('es-VE'));
            if (o.oferta_hasta) fechas.push('hasta ' + new Date(o.oferta_hasta).toLocaleString('es-VE'));
            if (!fechas.length) fechas.push('sin vencimiento');

            return '<div style="display:flex;align-items:center;gap:.5rem;padding:.5rem .6rem;' +
              'border:1px solid rgba(255,255,255,.1);border-radius:8px;margin-bottom:.35rem;font-size:.84rem">' +
              '<span style="width:8px;height:8px;border-radius:50%;background:' + e.c + ';flex-shrink:0"></span>' +
              '<span style="flex:1;min-width:0">' + esc(o.nombre) + '</span>' +
              '<span style="font-size:.75rem;opacity:.7">' + o.precio_normal + ' → ' + o.precio_oferta + '</span>' +
              '<span style="font-size:.75rem;font-weight:700;color:#FF9800">-' + o.descuento_pct + '%</span>' +
              '<span style="font-size:.7rem;opacity:.6;min-width:0;overflow:hidden;text-overflow:ellipsis;white-space:nowrap">' +
                fechas.join(' · ') + '</span>' +
              '<span style="font-size:.7rem;font-weight:700;color:' + e.c + '">' + e.t + '</span>' +
              '</div>';
        }).join('');
    };

    function esc(s) {
        return String(s == null ? '' : s)
            .replace(/&/g, '&amp;').replace(/</g, '&lt;')
            .replace(/>/g, '&gt;').replace(/"/g, '&quot;');
    }
})();
