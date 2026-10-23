// admin-secciones.js — Administración de las secciones de la carta
//
// QUÉ RESUELVE
//
// Antes la lista de secciones vivía escrita dentro del código del cliente y
// no había forma de cambiarla sin tocar código. Ahora vive en la tabla
// `secciones` (migración 13) y esta pantalla la administra.
//
// REGLAS QUE IMPUSO EL DUEÑO
//
//  1. Renombrar una sección MUEVE sus platillos con ella, y es TODO O NADA.
//     Un renombre a medias dejaría unos platos con el nombre nuevo y otros
//     con el viejo: los viejos desaparecerían de la carta.
//
//  2. Borrar una sección SÍ deja platillos huérfanos, a propósito. Pero el
//     huérfano tiene que gritar en el admin, arriba junto a las alertas de
//     inventario bajo, y en la lista de platillos.
//
// La lógica vive en funciones del servidor (migración 14) que exigen rol de
// admin. Esta pantalla solo las llama.

(function () {
    'use strict';

    // ============================================================
    // Carga
    // ============================================================

    window.cargarSeccionesAdmin = async function () {
        if (!window.supabaseClient) return;
        try {
            const { data, error } = await window.supabaseClient
                .from('secciones')
                .select('id, nombre, madre_id, orden, icono, visible, hora_desde, hora_hasta, nota_horario')
                .order('orden');
            if (error) throw error;

            window._secciones = data || [];
            window.renderizarSeccionesAdmin();
            if (window.actualizarOpcionesMadre) window.actualizarOpcionesMadre();
            await window.cargarHuerfanos();
        } catch (e) {
            console.warn('[secciones] no se pudieron cargar:', e.message);
        }
    };

    // ============================================================
    // Huérfanos: platillos sin sección
    //
    // El dueño pidió que el admin NO pueda pasar esto por alto. Se muestra
    // en el tablero (arriba, junto a las alertas de stock) y en la lista de
    // platillos con una marca al costado.
    // ============================================================

    window.cargarHuerfanos = async function () {
        if (!window.supabaseClient) return [];
        try {
            const { data, error } = await window.supabaseClient
                .from('platillos_huerfanos')
                .select('id, nombre, categoria, subcategoria, motivo');
            if (error) throw error;

            window._huerfanos = data || [];
            window.pintarAlertaHuerfanos(window._huerfanos);
            window.renderizarHuerfanosResolubles();
            return window._huerfanos;
        } catch (e) {
            console.warn('[secciones] no se pudieron cargar los huérfanos:', e.message);
            return [];
        }
    };

    /** Pinta el aviso en el tablero. No hace nada si no hay huérfanos. */
    window.pintarAlertaHuerfanos = function (lista) {
        const previo = document.getElementById('alertaHuerfanos');
        if (previo) previo.remove();

        if (!lista || !lista.length) return;

        const pane = document.getElementById('dashboardPane');
        if (!pane) return;

        const card = document.createElement('div');
        card.id = 'alertaHuerfanos';
        card.style.cssText =
            'background:rgba(239,68,68,.12);border:1px solid rgba(239,68,68,.45);' +
            'border-left:4px solid #ef4444;border-radius:10px;padding:.9rem 1rem;' +
            'margin-bottom:1rem;cursor:pointer';
        card.title = 'Ver los platillos sin sección';
        card.innerHTML =
            '<div style="display:flex;align-items:center;gap:.6rem;margin-bottom:.3rem">' +
              '<i class="fas fa-unlink" style="color:#ef4444"></i>' +
              '<strong style="font-size:.95rem">' + lista.length +
                ' platillo' + (lista.length > 1 ? 's' : '') + ' sin sección</strong>' +
            '</div>' +
            '<div style="font-size:.8rem;opacity:.85;line-height:1.4">' +
              'No aparecen en la carta del cliente porque su sección ya no existe. ' +
              'Tocalos para asignarles una.' +
            '</div>' +
            '<div style="font-size:.78rem;margin-top:.5rem;opacity:.7">' +
              lista.slice(0, 4).map(function (h) { return escap(h.nombre); }).join(' · ') +
              (lista.length > 4 ? ' y ' + (lista.length - 4) + ' más' : '') +
            '</div>';

        card.addEventListener('click', function () {
            // Lleva a la pestaña de platillos y los resalta
            const tab = document.querySelector('.tab[data-tab="menu"]');
            if (tab) tab.click();
            setTimeout(window.resaltarHuerfanosEnLista, 400);
        });

        // Va arriba del todo, antes de las tarjetas de números
        const grid = pane.querySelector('.dashboard-grid');
        if (grid && grid.parentNode) grid.parentNode.insertBefore(card, grid);
        else pane.insertBefore(card, pane.firstChild);
    };

    /** Marca visualmente cada platillo huérfano en la lista del menú. */
    window.resaltarHuerfanosEnLista = function () {
        const ids = (window._huerfanos || []).map(function (h) { return h.id; });
        if (!ids.length) return;

        document.querySelectorAll('#menuGrid .menu-card, #menuGrid [data-id]').forEach(function (el) {
            const id = el.dataset.id;
            if (!ids.includes(id)) return;

            el.style.outline = '2px solid #ef4444';
            el.style.outlineOffset = '2px';
            if (el.querySelector('.marca-huerfano')) return;

            const marca = document.createElement('div');
            marca.className = 'marca-huerfano';
            marca.style.cssText =
                'position:absolute;top:6px;left:6px;z-index:5;background:#ef4444;color:#fff;' +
                'font-size:.65rem;font-weight:700;padding:.15rem .4rem;border-radius:6px;' +
                'display:flex;align-items:center;gap:.25rem';
            marca.innerHTML = '<i class="fas fa-unlink"></i> SIN SECCIÓN';
            if (getComputedStyle(el).position === 'static') el.style.position = 'relative';
            el.appendChild(marca);
        });
    };

    // ============================================================
    // Pintar la lista de secciones
    // ============================================================

    window.renderizarSeccionesAdmin = function () {
        const cont = document.getElementById('adminSeccionesLista');
        if (!cont) return;

        const todas = window._secciones || [];
        const madres = todas.filter(function (s) { return !s.madre_id; });
        const conteo = window._conteoSecciones || {};

        if (!madres.length) {
            cont.innerHTML = '<p style="opacity:.6;font-size:.85rem">No hay secciones cargadas.</p>';
            return;
        }

        cont.innerHTML = madres.map(function (s) {
            const hijas = todas
                .filter(function (h) { return h.madre_id === s.id; })
                .sort(function (a, b) { return a.orden - b.orden; });

            const nPlatos = conteo[s.nombre] || 0;
            const horario = (s.hora_desde && s.hora_hasta)
                ? ' · ' + s.hora_desde.slice(0, 5) + ' a ' + s.hora_hasta.slice(0, 5)
                : '';

            return '' +
              '<div class="seccion-fila" data-id="' + s.id + '" style="border:1px solid rgba(255,255,255,.1);' +
                  'border-radius:10px;padding:.7rem .8rem;margin-bottom:.5rem">' +
                '<div style="display:flex;align-items:center;gap:.5rem">' +
                  '<i class="fas fa-' + escap(s.icono || 'utensils') + '" style="opacity:.6"></i>' +
                  '<strong style="flex:1">' + escap(s.nombre) + '</strong>' +
                  '<span style="font-size:.75rem;opacity:.6">' +
                    nPlatos + ' plato' + (nPlatos === 1 ? '' : 's') + horario +
                  '</span>' +
                  '<button class="btn-icon" title="Renombrar" onclick="window.abrirRenombrarSeccion(\'' + s.id + '\')">' +
                    '<i class="fas fa-pen"></i></button>' +
                  '<button class="btn-icon" title="Reordenar" onclick="window.moverSeccion(\'' + s.id + '\', -1)">' +
                    '<i class="fas fa-arrow-up"></i></button>' +
                  '<button class="btn-icon" title="Reordenar" onclick="window.moverSeccion(\'' + s.id + '\', 1)">' +
                    '<i class="fas fa-arrow-down"></i></button>' +
                  '<button class="btn-icon delete" title="Eliminar" onclick="window.abrirEliminarSeccion(\'' + s.id + '\')">' +
                    '<i class="fas fa-trash"></i></button>' +
                '</div>' +
                (hijas.length
                  ? '<div style="margin:.5rem 0 0 1.6rem;font-size:.78rem;opacity:.7">' +
                      hijas.map(function (h) { return escap(h.nombre); }).join(' · ') +
                    '</div>'
                  : '') +
              '</div>';
        }).join('');

        // Las marcas de huérfano se repintan si la lista de menú está visible
        setTimeout(window.resaltarHuerfanosEnLista, 200);
    };

    // ============================================================
    // Renombrar: avisa primero, confirma después
    // ============================================================

    window.abrirRenombrarSeccion = async function (id) {
        const sec = (window._secciones || []).find(function (s) { return s.id === id; });
        if (!sec) return;

        const nuevo = prompt(
            'Nuevo nombre para "' + sec.nombre + '"\n\n' +
            'Los platillos se mueven con la sección: no quedan huérfanos.',
            sec.nombre
        );
        if (nuevo === null || nuevo.trim() === '' || nuevo.trim() === sec.nombre) return;

        try {
            // Primera llamada SIN confirmar: el servidor responde cuántos
            // platillos se moverían. Así el admin ve el número ANTES de
            // aceptar, que es lo que pidió.
            const { data: previo, error } = await window.supabaseClient
                .rpc('renombrar_seccion', { p_id: id, p_nuevo: nuevo.trim(), p_confirmar: false });
            if (error) throw error;

            if (previo && previo.success === false && previo.requiere_confirmacion) {
                const n = previo.afectados;
                const mensaje = n > 0
                    ? 'Esto mueve ' + n + ' platillo' + (n === 1 ? '' : 's') +
                      ' de "' + previo.nombre_viejo + '" a "' + previo.nombre_nuevo + '".\n\n' +
                      'Se mueven todos o ninguno. ¿Confirmás?'
                    : 'Renombrar "' + previo.nombre_viejo + '" a "' + previo.nombre_nuevo + '".\n\n' +
                      'Esta sección no tiene platillos. ¿Confirmás?';

                if (!confirm(mensaje)) return;
            } else if (previo && previo.success === false && previo.error) {
                window.mostrarToast('❌ ' + previo.error, 'error');
                return;
            }

            const { data: hecho, error: e2 } = await window.supabaseClient
                .rpc('renombrar_seccion', { p_id: id, p_nuevo: nuevo.trim(), p_confirmar: true });
            if (e2) throw e2;

            if (hecho && hecho.success) {
                window.mostrarToast(
                    '✅ Renombrada. ' + (hecho.afectados || 0) + ' platillo(s) movidos.',
                    'success'
                );
                await window.cargarSeccionesAdmin();
                if (window.cargarMenu) window.cargarMenu();
            } else {
                window.mostrarToast('❌ ' + ((hecho && hecho.error) || 'No se pudo renombrar'), 'error');
            }
        } catch (e) {
            window.mostrarToast('❌ ' + (e.message || e), 'error');
        }
    };

    // ============================================================
    // Eliminar: avisa qué queda huérfano
    // ============================================================

    window.abrirEliminarSeccion = async function (id) {
        const sec = (window._secciones || []).find(function (s) { return s.id === id; });
        if (!sec) return;

        try {
            const { data, error } = await window.supabaseClient
                .rpc('detalle_borrado_seccion', { p_id: id });
            if (error) throw error;
            if (!data || data.success !== true) {
                window.mostrarToast('❌ ' + ((data && data.error) || 'No se pudo consultar'), 'error');
                return;
            }

            let mensaje = 'Eliminar la sección "' + data.nombre + '".';
            if (data.subsecciones > 0) {
                mensaje += '\n\nSe van también sus ' + data.subsecciones + ' subsecciones.';
            }
            if (data.platos > 0) {
                mensaje += '\n\n⚠️ ' + data.platos + ' platillo' + (data.platos === 1 ? '' : 's') +
                    ' quedarán SIN SECCIÓN y no se verán en la carta hasta que les asignes una:\n' +
                    data.nombres_platos.slice(0, 6).map(function (n) { return '· ' + n; }).join('\n') +
                    (data.nombres_platos.length > 6 ? '\n· y ' + (data.nombres_platos.length - 6) + ' más' : '');
            }
            mensaje += '\n\n¿Eliminar?';

            if (!confirm(mensaje)) return;

            const { data: hecho, error: e2 } = await window.supabaseClient
                .rpc('eliminar_seccion', { p_id: id, p_confirmar: true });
            if (e2) throw e2;

            if (hecho && hecho.success) {
                const h = hecho.detalle || {};
                window.mostrarToast(
                    '🗑️ Sección eliminada.' +
                    (h.platos > 0 ? ' ' + h.platos + ' platillo(s) quedaron sin sección.' : ''),
                    'success'
                );
                await window.cargarSeccionesAdmin();
                if (window.cargarMenu) window.cargarMenu();
            } else {
                window.mostrarToast('❌ ' + ((hecho && hecho.error) || 'No se pudo eliminar'), 'error');
            }
        } catch (e) {
            window.mostrarToast('❌ ' + (e.message || e), 'error');
        }
    };

    // ============================================================
    // Reordenar
    // ============================================================

    window.moverSeccion = async function (id, direccion) {
        const todas = window._secciones || [];
        const madres = todas.filter(function (s) { return !s.madre_id; })
                           .sort(function (a, b) { return a.orden - b.orden; });
        const i = madres.findIndex(function (s) { return s.id === id; });
        if (i < 0) return;

        const j = i + direccion;
        if (j < 0 || j >= madres.length) return;

        // Intercambiar posiciones
        const orden = madres.map(function (s, k) {
            let nuevo = k + 1;
            if (k === i) nuevo = j + 1;
            if (k === j) nuevo = i + 1;
            return { id: s.id, orden: nuevo };
        });

        try {
            const { data, error } = await window.supabaseClient
                .rpc('reordenar_secciones', { p_orden: orden });
            if (error) throw error;
            await window.cargarSeccionesAdmin();
        } catch (e) {
            window.mostrarToast('❌ ' + (e.message || e), 'error');
        }
    };

    // ============================================================
    // Crear
    // ============================================================

    window.crearSeccionAdmin = async function () {
        const nombreEl = document.getElementById('nuevaSeccionNombre');
        const madreEl = document.getElementById('nuevaSeccionMadre');
        if (!nombreEl) return;

        const nombre = (nombreEl.value || '').trim();
        if (!nombre) {
            window.mostrarToast('Escribí un nombre para la sección', 'error');
            return;
        }

        const madre = madreEl && madreEl.value ? madreEl.value : null;

        try {
            const { data, error } = await window.supabaseClient
                .rpc('crear_seccion', { p_nombre: nombre, p_madre_id: madre, p_icono: null });
            if (error) throw error;

            if (data && data.success) {
                window.mostrarToast('✅ Sección creada', 'success');
                nombreEl.value = '';
                await window.cargarSeccionesAdmin();
            } else {
                window.mostrarToast('❌ ' + ((data && data.error) || 'No se pudo crear'), 'error');
            }
        } catch (e) {
            window.mostrarToast('❌ ' + (e.message || e), 'error');
        }
    };

    /** Llena el desplegable de "madre" con las secciones principales. */
    window.actualizarOpcionesMadre = function () {
        const sel = document.getElementById('nuevaSeccionMadre');
        if (!sel) return;

        const madres = (window._secciones || [])
            .filter(function (s) { return !s.madre_id; })
            .sort(function (a, b) { return a.orden - b.orden; });

        sel.innerHTML = '<option value="">Sin madre (sección principal)</option>' +
            madres.map(function (m) {
                return '<option value="' + escap(m.id) + '">' + escap(m.nombre) + '</option>';
            }).join('');
    };

    // ============================================================
    // Resolver huérfanos: asignarle sección a un platillo
    // ============================================================

    window.abrirAsignarSeccion = async function (platilloId, nombrePlatillo) {
        const madres = (window._secciones || [])
            .filter(function (s) { return !s.madre_id; })
            .sort(function (a, b) { return a.orden - b.orden; });

        if (!madres.length) {
            window.mostrarToast('❌ No hay secciones cargadas', 'error');
            return;
        }

        // Desplegable armado a mano para no depender de librerías de diálogo.
        const overlay = document.createElement('div');
        overlay.className = 'modal-overlay active';
        overlay.id = 'modalAsignarSeccion';
        overlay.innerHTML =
            '<div class="confirm-dialog" style="max-width:380px">' +
              '<h3 style="margin-bottom:.3rem"><i class="fas fa-unlink"></i> Sin sección</h3>' +
              '<p style="font-size:.85rem;opacity:.8;margin-bottom:1rem">' +
                'Asignale una sección a <strong>' + escap(nombrePlatillo) + '</strong> para que ' +
                'vuelva a aparecer en la carta del cliente.' +
              '</p>' +
              '<label style="display:block;font-size:.78rem;opacity:.7;margin-bottom:.3rem">Sección</label>' +
              '<select id="asignarCategoria" style="width:100%;padding:.55rem .7rem;border-radius:8px;' +
                'border:1px solid rgba(255,255,255,.15);background:rgba(0,0,0,.25);color:inherit;margin-bottom:.7rem">' +
                madres.map(function (m) {
                    return '<option value="' + escap(m.nombre) + '">' + escap(m.nombre) + '</option>';
                }).join('') +
              '</select>' +
              '<label style="display:block;font-size:.78rem;opacity:.7;margin-bottom:.3rem">' +
                'Subsección (opcional)' +
              '</label>' +
              '<select id="asignarSubcategoria" style="width:100%;padding:.55rem .7rem;border-radius:8px;' +
                'border:1px solid rgba(255,255,255,.15);background:rgba(0,0,0,.25);color:inherit;margin-bottom:1rem">' +
                '<option value="">Sin subsección</option>' +
              '</select>' +
              '<div class="confirm-dialog-buttons">' +
                '<button class="btn-cancel" onclick="document.getElementById(\'modalAsignarSeccion\').remove()">Cancelar</button>' +
                '<button class="btn-confirm" id="asignarConfirmar">Asignar</button>' +
              '</div>' +
            '</div>';

        document.body.appendChild(overlay);

        const selCat = document.getElementById('asignarCategoria');
        const selSub = document.getElementById('asignarSubcategoria');

        function refrescarSubs() {
            const cat = selCat.value;
            const madre = madres.find(function (m) { return m.nombre === cat; });
            const hijas = madre
                ? (window._secciones || []).filter(function (h) { return h.madre_id === madre.id; })
                                           .sort(function (a, b) { return a.orden - b.orden; })
                : [];
            selSub.innerHTML = '<option value="">Sin subsección</option>' +
                hijas.map(function (h) {
                    return '<option value="' + escap(h.nombre) + '">' + escap(h.nombre) + '</option>';
                }).join('');
        }

        selCat.addEventListener('change', refrescarSubs);
        refrescarSubs();

        document.getElementById('asignarConfirmar').addEventListener('click', async function () {
            const btn = this;
            btn.disabled = true;
            btn.textContent = 'Asignando...';

            try {
                const { data, error } = await window.supabaseClient.rpc('asignar_seccion_a_platillo', {
                    p_platillo_id: platilloId,
                    p_categoria: selCat.value,
                    p_subcategoria: selSub.value || null
                });
                if (error) throw error;

                if (data && data.success) {
                    overlay.remove();
                    const quedan = data.huerfanos_restantes;
                    window.mostrarToast(
                        '✅ Asignado a "' + data.categoria + '".' +
                        (quedan > 0 ? ' Quedan ' + quedan + ' sin sección.' : ' Ya no hay platillos sin sección.'),
                        'success'
                    );
                    await window.cargarSeccionesAdmin();
                    if (window.cargarMenu) await window.cargarMenu();
                    window.resaltarHuerfanosEnLista();
                } else {
                    window.mostrarToast('❌ ' + ((data && data.error) || 'No se pudo asignar'), 'error');
                    btn.disabled = false;
                    btn.textContent = 'Asignar';
                }
            } catch (e) {
                window.mostrarToast('❌ ' + (e.message || e), 'error');
                btn.disabled = false;
                btn.textContent = 'Asignar';
            }
        });
    };

    /** Lista de huérfanos con un botón para resolver cada uno. */
    window.renderizarHuerfanosResolubles = function () {
        const cont = document.getElementById('adminHuerfanosLista');
        if (!cont) return;

        const lista = window._huerfanos || [];
        if (!lista.length) {
            cont.innerHTML = '<p style="opacity:.6;font-size:.82rem;margin:0">' +
                'No hay platillos sin sección.</p>';
            return;
        }

        cont.innerHTML = lista.map(function (h) {
            return '<div style="display:flex;align-items:center;gap:.5rem;padding:.45rem .6rem;' +
              'border:1px solid rgba(239,68,68,.35);border-radius:8px;margin-bottom:.35rem;font-size:.85rem">' +
              '<i class="fas fa-unlink" style="color:#ef4444;font-size:.8rem"></i>' +
              '<span style="flex:1">' + escap(h.nombre) + '</span>' +
              '<span style="font-size:.72rem;opacity:.6">' + escap(h.categoria || '—') + '</span>' +
              '<button class="btn-primary" style="padding:.2rem .5rem;font-size:.75rem" ' +
                'onclick="window.abrirAsignarSeccion(\'' + escap(h.id) + '\', \'' +
                escap(h.nombre).replace(/'/g, "\\'") + '\')">Asignar</button>' +
              '</div>';
        }).join('');
    };

    // ---------- util ----------
    function escap(s) {
        return String(s == null ? '' : s)
            .replace(/&/g, '&amp;').replace(/</g, '&lt;')
            .replace(/>/g, '&gt;').replace(/"/g, '&quot;').replace(/'/g, '&#39;');
    }
})();
