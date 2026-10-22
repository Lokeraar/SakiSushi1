// admin-menu.js - Gestión de platillos (menú)
(function() {
    let currentImagenUrl = '';
    let currentImagenFile = null;

    window.cargarMenu = async function() {
        try {
            const { data, error } = await window.supabaseClient.from('menu').select('*');
            if (error) throw error;
            window.menuItems = data || [];
            window.renderizarMenu();
            window.actualizarProductosActivos();
        } catch (e) { console.error('Error cargando menú:', e); window.mostrarToast('Error cargando menú', 'error'); }
    };

    window.renderizarMenu = function(filtro) {
        const grid = document.getElementById('menuGrid');
        if (!grid) return;
        grid.innerHTML = '';
        const _norm = t => (t || '').normalize('NFD').replace(/[áéíóú]/g, '').toLowerCase();
        const _base = [...window.menuItems].sort((a,b) => a.nombre.localeCompare(b.nombre));
        const items = filtro ? _base.filter(item => _norm(item.nombre).includes(_norm(filtro))) : _base;
        if (!items.length) {
            grid.innerHTML = '<p style="color:var(--text-muted);font-size:.88rem;padding:.5rem">' +
                (filtro ? 'Sin resultados para "' + filtro + '"' : 'No hay platillos registrados.') + '</p>';
            return;
        }
        items.forEach(item => {
            const ingredientesEstado = [];
            let todosDisponibles = true;
            let maxPlatillos = Infinity;
            let hayIngredientes = false;
            
            if (item.ingredientes) {
                for (const [ingId, ingInfo] of Object.entries(item.ingredientes)) {
                    const ing = window.inventarioItems.find(i => i.id === ingId);
                    const disponible = ing && (ing.stock - ing.reservado) >= (ingInfo.cantidad || 0);
                    if (!disponible) todosDisponibles = false;
                    ingredientesEstado.push({ id: ingId, nombre: ingInfo.nombre || ingId, disponible });
                    
                    // Calcular cuántas porciones se pueden preparar con este ingrediente
                    if (ing && ingInfo.cantidad > 0) {
                        hayIngredientes = true;
                        const disponibleIng = (ing.stock || 0) - (ing.reservado || 0);
                        const necesario = window._convertirUnidad(ingInfo.cantidad, ingInfo.unidad || 'unidades', ing.unidad_base || 'unidades');
                        if (necesario > 0) {
                            maxPlatillos = Math.min(maxPlatillos, Math.floor(disponibleIng / necesario));
                        } else {
                            maxPlatillos = 0;
                        }
                    }
                }
            }
            
            // Determinar el stock calculado (porciones disponibles)
            let stockCalculado = 0;
            if (!hayIngredientes) {
                stockCalculado = 0;
            } else if (!isFinite(maxPlatillos) || maxPlatillos < 0) {
                stockCalculado = 0;
            } else {
                stockCalculado = maxPlatillos;
            }
            
            const disponibleFinal = item.disponible && todosDisponibles;
            const imgSrc = item.imagen || '';
            const card = document.createElement('div');
            card.className = 'menu-card-v2' + (item.disponible ? '' : ' no-disponible');
            card.innerHTML = `
                <div class="mc2-header">
                    <div class="mc2-info">
                        <div class="mc2-nombre">${item.nombre}</div>
                        <div class="mc2-cat">${item.categoria || ''}${item.subcategoria ? ' · ' + item.subcategoria : ''}</div>
                        <div class="mc2-precio">${window.formatUSD(item.precio || 0)}
                            <span class="mc2-precio-bs">/ ${window.formatBs(window.usdToBs(item.precio || 0))}</span>
                        </div>
                        <div class="mc2-stock-line">
                            Stock: <span class="mc2-stock-val">${stockCalculado}</span>
                            <span class="mc2-badge ${disponibleFinal ? 'mc2-badge-ok' : 'mc2-badge-off'}">
                                ${disponibleFinal ? 'Disponible' : 'No disponible'}
                            </span>
                        </div>
                    </div>
                    ${imgSrc ? `<div class="mc2-img-wrap"><img src="${imgSrc}" class="mc2-img" alt="${item.nombre}" loading="lazy"></div>` : ''}
                </div>
                ${item.descripcion ? `<div class="mc2-desc">${item.descripcion}</div>` : ''}
                <div class="mc2-tags">${ingredientesEstado.map(ing => `
                    <span class="ing-tag ${ing.disponible ? '' : 'ing-tag-sin-stock'}" data-ingrediente-id="${ing.id}" 
                          title="${ing.disponible ? 'En stock' : 'Sin stock suficiente'}" style="cursor:pointer">
                        ${ing.nombre} <i class="fas fa-${ing.disponible ? 'check' : 'times'}" style="font-size:.55rem;margin-left:2px"></i>
                    </span>
                `).join('') || '<span class="ing-tag" style="opacity:.5">Sin ingredientes</span>'}</div>
                <div class="mc2-actions">
                    <label style="display:flex;align-items:center;gap:.35rem;cursor:pointer;margin-right:.25rem"
                        title="${disponibleFinal ? 'Marcar como no disponible' : 'Marcar como disponible'}">
                        <span style="font-size:.72rem;color:${disponibleFinal ? 'var(--success)' : 'var(--text-muted)'};font-weight:600">
                            ${disponibleFinal ? 'Disponible' : 'No disponible'}
                        </span>
                        <input type="checkbox" ${item.disponible ? 'checked' : ''}
                            style="accent-color:var(--success);cursor:pointer"
                            onchange="window.toggleDisponiblePlatillo('${item.id}', this.checked)">
                    </label>
                    <button class="btn-icon edit" onclick="window.editarPlatillo('${item.id}')" title="Editar platillo">
                        <i class="fas fa-pen"></i>
                    </button>
                    <button class="btn-icon delete" onclick="window.eliminarPlatillo('${item.id}')" title="Eliminar platillo">
                        <i class="fas fa-trash"></i>
                    </button>
                </div>`;
            
            // Evento para expandir imagen al hacer clic
            const imgElement = card.querySelector('.mc2-img');
            if (imgElement) {
                imgElement.style.cursor = 'pointer';
                imgElement.addEventListener('click', (e) => {
                    e.stopPropagation();
                    window.expandirImagen(imgSrc);
                });
            }
            // Evento para ingredientes
            card.querySelectorAll('.ing-tag[data-ingrediente-id]').forEach(tag => {
                tag.addEventListener('click', (e) => {
                    e.stopPropagation();
                    const ingId = tag.dataset.ingredienteId;
                    window._irAIngrediente(ingId);
                });
            });
            grid.appendChild(card);
        });
    };

    window.expandirImagen = function(src) {
        if (!src) return;
        const modal = document.createElement('div');
        modal.style.cssText = 'position:fixed;top:0;left:0;right:0;bottom:0;background:rgba(0,0,0,.9);z-index:10000;display:flex;align-items:center;justify-content:center;cursor:pointer';
        modal.innerHTML = `<img src="${src}" style="max-width:90%;max-height:90%;object-fit:contain;border-radius:8px">`;
        modal.addEventListener('click', () => modal.remove());
        document.body.appendChild(modal);
    };

    window.toggleDisponiblePlatillo = async function(id, disponible) {
        try {
            const { error } = await window.supabaseClient.from('menu')
                .update({ disponible: disponible })
                .eq('id', id);
            if (error) throw error;
            const item = window.menuItems.find(p => p.id === id);
            if (item) item.disponible = disponible;
            window.renderizarMenu(document.getElementById('menuBuscador')?.value || '');
            if (disponible) {
                window.mostrarToast(`✅ Platillo "${item?.nombre}" ahora está DISPONIBLE en el menú del cliente`, 'success');
            } else {
                window.mostrarToast(`⚠️ Platillo "${item?.nombre}" ahora está NO DISPONIBLE (se mostrará como AGOTADO en el menú del cliente)`, 'warning');
            }
        } catch(e) {
            console.error('Error toggle disponible:', e);
            if (e.message && e.message.includes('permission denied')) {
                window.mostrarToast('⚠️ No se pudo cambiar el estado. Contacta al administrador del sistema.', 'error');
            } else {
                window.mostrarToast('❌ Error: ' + (e.message || e), 'error');
            }
        }
    };

    window.limpiarImagenPreview = function() {
        currentImagenFile = null;
        currentImagenUrl = '';
        const fileInput = document.getElementById('platilloImagen');
        const urlInput = document.getElementById('platilloImagenUrl');
        const previewDiv = document.getElementById('imagenPreview');
        const previewImg = document.getElementById('previewImg');
        if (fileInput) fileInput.value = '';
        if (urlInput) {
            urlInput.value = '';
            urlInput.disabled = false;
        }
        if (previewDiv) previewDiv.style.display = 'none';
        if (previewImg) previewImg.src = '';
        // Eliminar el botón de quitar imagen
        const removeBtn = document.querySelector('#imagenPreview .preview-remove-btn');
        if (removeBtn) removeBtn.remove();
    };

    window.actualizarBotonEliminarImagen = function() {
        const previewDiv = document.getElementById('imagenPreview');
        const previewImg = document.getElementById('previewImg');
        const urlInput = document.getElementById('platilloImagenUrl');
        const fileInput = document.getElementById('platilloImagen');
        
        // Eliminar cualquier botón existente para evitar duplicados
        const existingQuitar = document.querySelector('#imagenPreview .preview-remove-btn');
        if (existingQuitar) existingQuitar.remove();
        
        if (previewDiv && previewDiv.style.display === 'flex') {
            const removePreviewBtn = document.createElement('button');
            removePreviewBtn.type = 'button'; // Evitar que actúe como submit
            removePreviewBtn.className = 'preview-remove-btn';
            removePreviewBtn.innerHTML = '<i class="fas fa-times"></i>';
            removePreviewBtn.style.cssText = 'position:absolute;top:4px;right:4px;background:transparent;color:#fff;border:none;border-radius:50%;width:24px;height:24px;cursor:pointer;display:flex;align-items:center;justify-content:center;font-size:.85rem;z-index:10;opacity:0.9;transition:opacity 0.2s;text-shadow:0 1px 3px rgba(0,0,0,0.5)';
            removePreviewBtn.onmouseenter = () => removePreviewBtn.style.opacity = '1';
            removePreviewBtn.onmouseleave = () => removePreviewBtn.style.opacity = '0.9';
            removePreviewBtn.title = 'Eliminar imagen';
            removePreviewBtn.onclick = (e) => {
                e.preventDefault();
                e.stopPropagation();
                // Al eliminar la imagen, habilitar el campo URL y limpiar variables
                currentImagenFile = null;
                currentImagenUrl = '';
                if (fileInput) fileInput.value = '';
                if (urlInput) {
                    urlInput.value = '';
                    urlInput.disabled = false;
                }
                if (previewDiv) previewDiv.style.display = 'none';
                if (previewImg) previewImg.src = '';
                if (removePreviewBtn) removePreviewBtn.remove();
            };
            previewDiv.style.position = 'relative';
            previewDiv.appendChild(removePreviewBtn);
        }
    };

    // Configurar eventos del modal de platillo
    function setupPlatilloModalEvents() {
        const fileInput = document.getElementById('platilloImagen');
        const urlInput = document.getElementById('platilloImagenUrl');
        const previewDiv = document.getElementById('imagenPreview');
        const previewImg = document.getElementById('previewImg');
        
        if (fileInput) {
            // Eliminar listener previo si existe
            const newFileInput = fileInput.cloneNode(true);
            fileInput.parentNode.replaceChild(newFileInput, fileInput);
            
            newFileInput.addEventListener('change', function() {
                if (newFileInput.files && newFileInput.files[0]) {
                    const file = newFileInput.files[0];
                    currentImagenFile = file;
                    currentImagenUrl = '';
                    if (urlInput) {
                        urlInput.value = '';
                        urlInput.disabled = true;
                    }
                    const reader = new FileReader();
                    reader.onload = function(e) {
                        if (previewImg) previewImg.src = e.target.result;
                        if (previewDiv) previewDiv.style.display = 'flex';
                        window.actualizarBotonEliminarImagen();
                    };
                    reader.readAsDataURL(file);
                } else {
                    if (urlInput) urlInput.disabled = false;
                    if (urlInput && urlInput.value.trim()) {
                        if (previewImg) previewImg.src = urlInput.value;
                        if (previewDiv) previewDiv.style.display = 'flex';
                        window.actualizarBotonEliminarImagen();
                        currentImagenUrl = urlInput.value;
                        currentImagenFile = null;
                    } else {
                        if (previewDiv) previewDiv.style.display = 'none';
                        if (previewImg) previewImg.src = '';
                    }
                }
            });
        }
        
        if (urlInput) {
            // Eliminar listener previo si existe
            const newUrlInput = urlInput.cloneNode(true);
            urlInput.parentNode.replaceChild(newUrlInput, urlInput);
            
            newUrlInput.addEventListener('input', function() {
                if (fileInput && fileInput.files && fileInput.files[0]) return;
                const url = newUrlInput.value.trim();
                if (url) {
                    if (previewImg) previewImg.src = url;
                    if (previewDiv) previewDiv.style.display = 'flex';
                    window.actualizarBotonEliminarImagen();
                    currentImagenUrl = url;
                    currentImagenFile = null;
                } else {
                    if (previewDiv) previewDiv.style.display = 'none';
                    if (previewImg) previewImg.src = '';
                }
            });
        }
        
        // Expandir imagen al hacer clic en preview
        if (previewImg) {
            previewImg.style.cursor = 'pointer';
            previewImg.addEventListener('click', (e) => {
                e.stopPropagation();
                if (previewImg.src) window.expandirImagen(previewImg.src);
            });
        }
        
        // Tooltip para ingredientes
        const ingredientesLabel = document.querySelector('#platilloForm .form-group:nth-child(7) label');
        if (ingredientesLabel) {
            ingredientesLabel.innerHTML += `
                <span class="tooltip-wrap" style="position:relative; display:inline-flex; align-items:center; cursor:help; margin-left:.3rem" onmouseenter="this.querySelector('.tooltip-text').style.display='block'" onmouseleave="this.querySelector('.tooltip-text').style.display='none'">
                    <span style="display:inline-flex; align-items:center; justify-content:center; width:16px; height:16px; background:var(--text-muted); color:#fff; border-radius:50%; font-size:.65rem; font-weight:700">?</span>
                    <span class="tooltip-text" style="display:none; position:absolute; bottom:calc(100% + 6px); left:50%; transform:translateX(-50%); background:var(--toast-bg); color:var(--toast-text); padding:.5rem .75rem; border-radius:8px; font-size:.75rem; white-space:normal; width:260px; text-align:center; box-shadow:0 4px 12px rgba(0,0,0,.3); z-index:100; line-height:1.4">
                        ⚠️ La unidad de medida del ingrediente es crítica: "1 aguacate" no equivale a 500 gramos. Asegúrate de seleccionar la unidad correcta (unidades, kilogramos, litros, etc.) según corresponda.
                    </span>
                </span>
            `;
        }
    }

    window.abrirModalNuevoPlatillo = function() {
        document.getElementById('platilloModalTitle').textContent = 'Nuevo Platillo';
        document.getElementById('platilloForm').reset();
        document.getElementById('ingredientesContainer').innerHTML = '';
        window.limpiarImagenPreview();
        window.limpiarErroresInput();
        window.cargarCategoriasSelect();
        window.platilloEditandoId = null;
        
        // Configurar eventos del modal para el nuevo platillo
        setupPlatilloModalEvents();
        
        document.getElementById('platilloModal').classList.add('active');
    };

    window.cargarCategoriasSelect = function() {
        const select = document.getElementById('platilloCategoria');
        select.innerHTML = '<option value="">Seleccionar</option>';
        Object.keys(window.categoriasMenu || {}).forEach(cat => {
            const opt = document.createElement('option');
            opt.value = cat;
            opt.textContent = cat;
            select.appendChild(opt);
        });
        select.addEventListener('change', (e) => { window.cargarSubcategoriasSelect(e.target.value, null); });
    };

    window.cargarSubcategoriasSelect = function(categoria, valorSubcategoria = null) {
        const select = document.getElementById('platilloSubcategoria');
        const wrap = document.getElementById('subcategoriaContainer');
        select.innerHTML = '<option value="">Ninguna</option>';
        if (categoria && window.categoriasMenu && window.categoriasMenu[categoria]) {
            // Hay subcategorías, mantener visible el contenedor
            if (wrap) wrap.style.display = 'block';
            window.categoriasMenu[categoria].forEach(sub => {
                const opt = document.createElement('option');
                opt.value = sub;
                opt.textContent = sub;
                select.appendChild(opt);
            });
            // Restaurar el valor de la subcategoría si se proporcionó
            if (valorSubcategoria !== null) {
                select.value = valorSubcategoria;
            }
        } else {
            // No hay subcategorías, ocultar contenedor
            if (wrap) wrap.style.display = 'none';
        }
    };

    window.agregarIngredienteRow = function(ingredienteId, cantidad, unidad, esPrincipal) {
        ingredienteId = ingredienteId || '';
        cantidad = cantidad || '';
        esPrincipal = esPrincipal || false;
        if (!unidad && ingredienteId) {
            const _invItem = (window.inventarioItems || []).find(i => i.id === ingredienteId);
            unidad = _invItem?.unidad_base || 'unidades';
        }
        unidad = unidad || 'unidades';
        const container = document.getElementById('ingredientesContainer');
        const row = document.createElement('div');
        row.className = 'ingrediente-row';
        row.style.cssText = 'display:grid;grid-template-columns:2fr 1fr 1fr auto;gap:.4rem;align-items:center;margin-bottom:.4rem';

        const select = document.createElement('select');
        select.style.cssText = 'font-family:Montserrat,sans-serif;font-size:.82rem';
        // Opción vacía
        const optBlank = document.createElement('option');
        optBlank.value = ''; optBlank.textContent = 'Seleccionar ingrediente';
        select.appendChild(optBlank);
        // Opción "Otro" PRIMERO
        const optOtro = document.createElement('option');
        optOtro.value = '__otro__'; optOtro.textContent = '➕ Otro (nuevo ingrediente)';
        select.appendChild(optOtro);
        // Resto de ingredientes del inventario
        const sorted = [...(window.inventarioItems || [])].sort((a,b) => a.nombre.localeCompare(b.nombre));
        sorted.forEach(ing => {
            const opt = document.createElement('option');
            opt.value = ing.id;
            opt.textContent = ing.nombre;
            if (ing.id === ingredienteId) opt.selected = true;
            select.appendChild(opt);
        });
        // Input nombre personalizado (visible solo si se elige "Otro")
        const inputNombreOtro = document.createElement('input');
        inputNombreOtro.type = 'text';
        inputNombreOtro.placeholder = 'Nombre del ingrediente';
        inputNombreOtro.className = 'ing-row-nombre-otro';
        inputNombreOtro.style.cssText = 'display:none;font-family:Montserrat,sans-serif;font-size:.82rem;width:100%;padding:.3rem .5rem;border:1px solid var(--border);border-radius:6px;background:var(--input-bg);color:var(--text-dark);box-sizing:border-box;margin-top:.25rem';
        // Reemplazar select por un wrapper que contiene ambos
        const selWrap = document.createElement('div');
        selWrap.style.cssText = 'display:flex;flex-direction:column;min-width:0';
        selWrap.appendChild(select);
        selWrap.appendChild(inputNombreOtro);
        select.addEventListener('change', function() {
            const isOtro = this.value === '__otro__';
            inputNombreOtro.style.display = isOtro ? 'block' : 'none';
            if (!isOtro) {
                const ing = (window.inventarioItems || []).find(i => i.id === this.value);
                if (ing && ing.unidad_base) {
                    const unitSel = row.querySelector('select.ing-row-unidad');
                    if (unitSel) unitSel.value = ing.unidad_base;
                }
            }
            window._recalcularStockPlatillo();
        });

        const inputCantidad = document.createElement('input');
        inputCantidad.type = 'number'; inputCantidad.step = '0.001';
        inputCantidad.placeholder = 'Cant.'; inputCantidad.value = cantidad;
        inputCantidad.style.cssText = 'font-family:Montserrat,sans-serif;font-size:.82rem';
        inputCantidad.addEventListener('input', window._recalcularStockPlatillo);

        const selUnidad = document.createElement('select');
        selUnidad.className = 'ing-row-unidad';
        selUnidad.style.cssText = 'font-family:Montserrat,sans-serif;font-size:.78rem';
        ['unidades','gramos','mililitros','kilogramos','litros'].forEach(u => {
            const o = document.createElement('option');
            o.value = u; o.textContent = u.charAt(0).toUpperCase() + u.slice(1);
            if (u === unidad) o.selected = true;
            selUnidad.appendChild(o);
        });
        selUnidad.addEventListener('change', window._recalcularStockPlatillo);

        const removeBtn = document.createElement('button');
        removeBtn.type = 'button';
        removeBtn.innerHTML = '<i class="fas fa-times"></i>';
        removeBtn.style.cssText = 'background:#ffebee;color:var(--danger);border:none;border-radius:6px;width:28px;height:28px;cursor:pointer;display:flex;align-items:center;justify-content:center;flex-shrink:0';
        removeBtn.onclick = () => { if(row._hideTip) row._hideTip(); row.remove(); window._recalcularStockPlatillo(); };

        // Checkbox "ingrediente principal" con tooltip portal
        const principalWrap = document.createElement('div');
        principalWrap.style.cssText = 'display:flex;align-items:center;justify-content:center;flex-shrink:0;position:relative';
        const chk = document.createElement('input');
        chk.type = 'checkbox'; chk.className = 'ing-principal-chk';
        chk.style.cssText = 'width:16px;height:16px;accent-color:var(--primary);cursor:pointer;display:block';
        if (esPrincipal) chk.checked = true;
        // Tooltip tipo portal — se inserta en body para superar overflow:hidden del modal
        let _tipEl = null;
        const _showTip = function() {
            if (_tipEl) return;
            const rect = chk.getBoundingClientRect();
            _tipEl = document.createElement('div');
            _tipEl.style.cssText = 'position:fixed;background:#1a1a2e;color:#fff;padding:.6rem .9rem;border-radius:9px;font-size:.72rem;width:250px;text-align:center;box-shadow:0 6px 22px rgba(0,0,0,.55);z-index:99999;line-height:1.55;pointer-events:none;font-family:Montserrat,sans-serif';
            _tipEl.innerHTML = '<strong style="display:block;margin-bottom:.3rem;font-size:.76rem">¿Es un ingrediente principal?</strong>Si lo activas, el cliente no podrá deseleccionarlo al personalizar el platillo y requerirá doble confirmación antes de eliminarse del inventario.';
            document.body.appendChild(_tipEl);
            const tw = _tipEl.offsetWidth, th = _tipEl.offsetHeight;
            let left = rect.left + rect.width/2 - tw/2;
            let top  = rect.top - th - 10;
            if (left < 6) left = 6;
            if (left + tw > window.innerWidth - 6) left = window.innerWidth - tw - 6;
            if (top < 6) top = rect.bottom + 10;
            _tipEl.style.left = left + 'px';
            _tipEl.style.top  = top  + 'px';
        };
        const _hideTip = function() { if (_tipEl) { _tipEl.remove(); _tipEl = null; } };
        chk.addEventListener('mouseenter', _showTip);
        chk.addEventListener('mouseleave', _hideTip);
        chk.addEventListener('focus',      _showTip);
        chk.addEventListener('blur',       _hideTip);
        chk.addEventListener('touchstart', function(e){
            e.stopPropagation();
            _tipEl ? _hideTip() : _showTip();
            setTimeout(_hideTip, 2800);
        }, {passive:true});
        principalWrap.appendChild(chk);
        row._hideTip = _hideTip;

        // Grid 5 columnas para acomodar el checkbox
        row.style.cssText = 'display:grid;grid-template-columns:2fr 1fr 1fr auto auto;gap:.4rem;align-items:start;margin-bottom:.4rem;background:var(--card-bg);padding:.3rem .4rem;border-radius:6px;border:1px solid var(--border)';

        row.appendChild(selWrap);
        row.appendChild(inputCantidad);
        row.appendChild(selUnidad);
        row.appendChild(principalWrap);
        row.appendChild(removeBtn);
        container.appendChild(row);
        window._recalcularStockPlatillo();
    };

    window.editarPlatillo = function(id) {
        const platillo = window.menuItems.find(p => p.id === id);
        if (!platillo) return;
        window.platilloEditandoId = id;
        document.getElementById('platilloModalTitle').textContent = 'Editar Platillo';
        // NO limpiar imagen preview aquí, lo haremos después de cargar la imagen existente
        window.limpiarErroresInput();
        // Cargar categorías antes de llenar el formulario
        window.cargarCategoriasSelect();
        document.getElementById('platilloNombre').value = platillo.nombre || '';
        document.getElementById('platilloCategoria').value = platillo.categoria || '';
        // No establecer directamente el valor de subcategoría aquí, se hará en cargarSubcategoriasSelect
        document.getElementById('platilloPrecio').value = platillo.precio || '';
        document.getElementById('platilloDescripcion').value = platillo.descripcion || '';
        document.getElementById('platilloDisponible').value = platillo.disponible ? 'true' : 'false';
        const _chkD = document.getElementById('platilloDisponibleCheck');
        const _lblD = document.getElementById('platilloDisponibleLabel');
        if (_chkD) { _chkD.checked = !!platillo.disponible; }
        if (_lblD) { _lblD.textContent = platillo.disponible ? 'Sí' : 'No'; _lblD.style.color = platillo.disponible ? 'var(--success)' : 'var(--text-muted)'; }
        
        // Cargar imagen existente si hay - SIN limpiar primero para mantener consistencia
        const previewImg = document.getElementById('previewImg');
        const previewDiv = document.getElementById('imagenPreview');
        const urlInput = document.getElementById('platilloImagenUrl');
        const fileInput = document.getElementById('platilloImagen');
        
        if (platillo.imagen) {
            // Establecer variables globales ANTES de mostrar el preview
            currentImagenUrl = platillo.imagen;
            currentImagenFile = null; // No hay archivo, es URL existente
            
            // Mostrar preview
            if (previewImg) previewImg.src = platillo.imagen;
            if (previewDiv) previewDiv.style.display = 'flex';
            
            // Solo establecer el valor del input URL si es una URL externa (no del storage)
            if (urlInput) {
                if (platillo.imagen.includes('imagenes-platillos')) {
                    // Es imagen del storage, no poner en el input para evitar re-subidas accidentales
                    urlInput.value = '';
                    // Bloquear el campo URL cuando hay imagen del storage
                    urlInput.disabled = true;
                } else {
                    // Es URL externa, permitir edición
                    urlInput.value = platillo.imagen;
                    // No bloquear porque es URL externa editable
                    urlInput.disabled = false;
                }
            }
            // Limpiar input de archivo para evitar confusiones
            if (fileInput) fileInput.value = '';
            
            // Configurar eventos del modal y mostrar botón de eliminar después de mostrar el preview
            setupPlatilloModalEvents();
            window.actualizarBotonEliminarImagen();
        } else {
            // No hay imagen, limpiar todo
            window.limpiarImagenPreview();
            // Configurar eventos del modal incluso sin imagen
            setupPlatilloModalEvents();
        }
        
        window.cargarSubcategoriasSelect(platillo.categoria, platillo.subcategoria || null);
        document.getElementById('ingredientesContainer').innerHTML = '';
        if (platillo.ingredientes) {
            Object.entries(platillo.ingredientes).forEach(([ingId, ingInfo]) => {
                window.agregarIngredienteRow(ingId, ingInfo.cantidad, ingInfo.unidad, ingInfo.principal || false);
            });
        }
        
        // Mostrar botón Eliminar en modo edición
        const deleteBtn = document.getElementById('deletePlatilloBtn');
        if (deleteBtn) deleteBtn.style.display = 'inline-flex';
        
        document.getElementById('platilloModal').classList.add('active');
    };

    window.eliminarPlatillo = async function(id) {
        const platillo = window.menuItems.find(p => p.id === id);
        if (!platillo) return;
        window.mostrarConfirmacionPremium(
            'Eliminar Platillo',
            `¿Estás seguro de eliminar "${platillo.nombre}"? Esta acción no se puede deshacer.`,
            async () => {
                try {
                    if (platillo.imagen && platillo.imagen.includes('imagenes-platillos')) {
                        await window.eliminarImagenPlatillo(platillo.imagen);
                    }
                    await window.supabaseClient.from('menu').delete().eq('id', id);
                    await window.cargarMenu();
                    window.mostrarToast('🗑️ Platillo eliminado', 'success');
                } catch (e) {
                    console.error('Error eliminando platillo:', e);
                    window.mostrarToast('❌ Error al eliminar el platillo', 'error');
                }
            }
        );
    };

    window._eliminarPlatilloDesdeModal = async function() {
        const id = window.platilloEditandoId;
        if (!id) return;
        const platillo = window.menuItems.find(p => p.id === id);
        if (!platillo) return;
        
        window.mostrarConfirmacionPremium(
            'Eliminar Platillo',
            `¿Estás seguro de eliminar "${platillo.nombre}"? Esta acción no se puede deshacer.`,
            async () => {
                try {
                    if (platillo.imagen && platillo.imagen.includes('imagenes-platillos')) {
                        await window.eliminarImagenPlatillo(platillo.imagen);
                    }
                    await window.supabaseClient.from('menu').delete().eq('id', id);
                    await window.cargarMenu();
                    window.cerrarModal('platilloModal');
                    window.platilloEditandoId = null;
                    window.limpiarImagenPreview();
                    window.mostrarToast('🗑️ Platillo eliminado', 'success');
                } catch (e) {
                    console.error('Error eliminando platillo:', e);
                    window.mostrarToast('❌ Error al eliminar el platillo', 'error');
                }
            }
        );
    };

    window.actualizarProductosActivos = function() {
        const el = document.getElementById('productosActivos');
        if (el && window.menuItems) {
            const count = window.menuItems.filter(m => m.disponible).length;
            el.textContent = Math.floor(count);
        }
    };

    window._onCategoriaChange = function(forceExpand = false) {
        const cat = document.getElementById('platilloCategoria')?.value;
        const wrap = document.getElementById('subcategoriaContainer');
        const sel  = document.getElementById('platilloSubcategoria');
        if (!wrap || !sel) return;
        const SUBCATEGORIAS = {
            'rolls': [{ id: 'rolls-frios', name: 'Rolls Fríos (10 pzas)' }, { id: 'rolls-tempura', name: 'Rolls Tempura (12 pzas)' }],
            'china': [
                { id: 'arroz-chino', name: 'Arroz Chino' }, { id: 'arroz-cantones', name: 'Arroz Cantones' },
                { id: 'chopsuey', name: 'Chopsuey' }, { id: 'lomey', name: 'Lomey' }, { id: 'chow-mein', name: 'Chow Mein' },
                { id: 'fideos-arroz', name: 'Fideos de Arroz' }, { id: 'tallarines-cantones', name: 'Tallarines Cantones' },
                { id: 'mariscos', name: 'Mariscos' }, { id: 'foo-yung', name: 'Foo Yong' }, { id: 'sopas', name: 'Sopas' },
                { id: 'entremeses', name: 'Entremeses' }
            ],
            'japonesa': [
                { id: 'yakimeshi', name: 'Yakimeshi' }, { id: 'yakisoba', name: 'Yakisoba' },
                { id: 'pasta-udon', name: 'Pasta Udon' }, { id: 'churrasco', name: 'Churrasco' }
            ]
        };
        const subs = SUBCATEGORIAS[cat];
        if (subs && subs.length) {
            wrap.style.display = 'block';
            sel.innerHTML = '<option value="">Sin subcategoría</option>' +
                subs.map(s => `<option value="${s.id}">${s.name}</option>`).join('');
        } else {
            wrap.style.display = 'none';
            sel.innerHTML = '<option value="">Ninguna</option>';
        }
        window._recalcularStockPlatillo();
    };

    window._previewPrecioBs = function() {
        const precio = parseFloat(document.getElementById('platilloPrecio')?.value) || 0;
        const tasa   = (window.configGlobal?.tasa_efectiva) || (window.configGlobal?.tasa_cambio) || 0;
        const el = document.getElementById('platilloPrecioBsPreview');
        if (el) el.textContent = tasa > 0 && precio > 0 ? '💰 ' + window.formatBs(precio * tasa) : '';
    };

    window._previewPlatilloUrl = function(url) {
        if (!url) return;
        const prev = document.getElementById('imagenPreview');
        const img  = document.getElementById('previewImg');
        if (prev && img) { img.src = url; prev.style.display = 'flex'; }
    };

    window._recalcularStockPlatillo = function() {
        const wrap = document.getElementById('stockCalculadoWrap');
        const txt  = document.getElementById('stockCalculadoText');
        if (!wrap || !txt) return;
        const rows = document.querySelectorAll('#ingredientesContainer .ingrediente-row');
        if (!rows.length) { wrap.style.display = 'none'; return; }
        let maxPlatillos = Infinity;
        let hayIngredientes = false;
        rows.forEach(row => {
            const selIng = row.querySelector('select:not(.ing-row-unidad)');
            const selUni = row.querySelector('select.ing-row-unidad');
            const cant   = parseFloat(row.querySelector('input[type="number"]')?.value) || 0;
            if (!selIng?.value || !cant) return;
            hayIngredientes = true;
            const inv = (window.inventarioItems || []).find(i => i.id === selIng.value);
            if (inv) {
                const disponible = (inv.stock || 0) - (inv.reservado || 0);
                const unidadIng  = selUni?.value || 'unidades';
                const necesario  = window._convertirUnidad(cant, unidadIng, inv.unidad_base || 'unidades');
                if (necesario > 0) maxPlatillos = Math.min(maxPlatillos, Math.floor(disponible / necesario));
            } else { maxPlatillos = 0; }
        });
        if (!hayIngredientes) { wrap.style.display = 'none'; return; }
        if (!isFinite(maxPlatillos) || maxPlatillos < 0) maxPlatillos = 0;
        wrap.style.display = 'block';
        wrap.style.background = maxPlatillos > 5 ? '#f0fdf4' : maxPlatillos > 0 ? '#fffbeb' : '#fef2f2';
        wrap.style.borderColor = maxPlatillos > 5 ? '#bbf7d0' : maxPlatillos > 0 ? '#fde68a' : '#fecaca';
        txt.style.color = maxPlatillos > 5 ? '#166534' : maxPlatillos > 0 ? '#92400e' : '#991b1b';
        txt.textContent = maxPlatillos > 0
            ? `Con el stock actual se pueden preparar ${maxPlatillos} porcion${maxPlatillos !== 1 ? 'es' : ''}`
            : '⚠️ Stock insuficiente para preparar este platillo';
    };

    // Inicializar eventos del modal de platillo
    setupPlatilloModalEvents();
    
    // Configurar botones del footer del modal de platillo
    setTimeout(function() {
        const saveBtn = document.getElementById('savePlatilloBtn');
        const cancelBtn = document.getElementById('cancelPlatilloBtn');
        const deleteBtn = document.getElementById('deletePlatilloBtn');
        
        // Botón Guardar - usando .onclick directo para evitar duplicidad en Brave
        if (saveBtn) {
            saveBtn.onclick = function(e) {
                e.preventDefault();
                e.stopPropagation();
                if (e.stopImmediatePropagation) e.stopImmediatePropagation();
                console.log('Botón Guardar Platillo presionado');
                if (typeof window.guardarPlatillo === 'function') {
                    window.guardarPlatillo();
                }
            };
        }
        
        // Botón Cancelar
        if (cancelBtn) {
            cancelBtn.onclick = function(e) {
                e.preventDefault();
                e.stopPropagation();
                console.log('Botón Cancelar Platillo presionado');
                window.cerrarModal('platilloModal');
                window.limpiarImagenPreview();
                window.limpiarErroresInput();
                window.platilloEditandoId = null;
            };
        }
        
        // Botón Eliminar - configurado aquí para evitar duplicidad
        if (deleteBtn) {
            deleteBtn.onclick = function(e) {
                console.log('Botón Eliminar Platillo presionado');
                e.preventDefault();
                e.stopPropagation();
                if (e.stopImmediatePropagation) e.stopImmediatePropagation();
                if (typeof window._eliminarPlatilloDesdeModal === 'function') {
                    window._eliminarPlatilloDesdeModal();
                }
            };
        }
    }, 100);
    
    // Función principal para guardar platillo
    window.guardarPlatillo = async function() {
        // Asegurar que las funciones de core estén disponibles
        if (!window.mostrarErrorInput) {
            console.error('Funciones de core no cargadas aún. Reintentando...');
            await new Promise(resolve => setTimeout(resolve, 100));
            if (!window.mostrarErrorInput) {
                window.mostrarToast('❌ Error interno: Funciones de validación no disponibles', 'error');
                return;
            }
        }
        
        const nombre = document.getElementById('platilloNombre')?.value.trim();
        const categoria = document.getElementById('platilloCategoria')?.value.trim();
        const subcategoria = document.getElementById('platilloSubcategoria')?.value.trim() || '';
        const precio = parseFloat(document.getElementById('platilloPrecio')?.value) || 0;
        const descripcion = document.getElementById('platilloDescripcion')?.value.trim() || '';
        const disponible = document.getElementById('platilloDisponibleCheck')?.checked || false;
        
        // Validaciones
        let hayError = false;
        
        if (!nombre) {
            window.mostrarErrorInput('platilloNombre', 'El nombre es obligatorio');
            hayError = true;
        }
        if (!categoria) {
            window.mostrarErrorInput('platilloCategoria', 'La categoría es obligatoria');
            hayError = true;
        }
        if (precio <= 0) {
            window.mostrarErrorInput('platilloPrecio', 'El precio debe ser mayor a 0');
            hayError = true;
        }
        
        if (hayError) {
            window.mostrarToast('⚠️ Por favor corrige los errores', 'warning');
            return;
        }
        
        // Recolectar ingredientes
        const ingredientes = {};
        const rows = document.querySelectorAll('#ingredientesContainer .ingrediente-row');
        rows.forEach(row => {
            const selIng = row.querySelector('select:not(.ing-row-unidad)');
            const selUni = row.querySelector('select.ing-row-unidad');
            const cantInput = row.querySelector('input[type="number"]');
            const chkPrincipal = row.querySelector('input[type="checkbox"]');
            
            if (selIng && selIng.value && cantInput) {
                const cantidad = parseFloat(cantInput.value) || 0;
                if (cantidad > 0) {
                    ingredientes[selIng.value] = {
                        cantidad: cantidad,
                        unidad: selUni?.value || 'unidades',
                        nombre: selIng.options[selIng.selectedIndex]?.text || '',
                        principal: chkPrincipal?.checked || false
                    };
                }
            }
        });
        
        // Procesar imagen: subir archivo si existe o usar URL
        let imagenUrl = null;
        
        // Si hay un archivo seleccionado, subirlo al storage (prioridad)
        if (currentImagenFile) {
            window.mostrarToast('📤 Subiendo imagen...', 'info');
            const resultado = await window.subirImagenPlatillo(currentImagenFile, 'imagenes-platillos');
            if (resultado.success) {
                imagenUrl = resultado.url;
                currentImagenUrl = resultado.url; // Actualizar para futuras referencias
            } else {
                window.mostrarToast('⚠️ Error al subir imagen: ' + (resultado.error || 'Error desconocido'), 'warning');
                // Continuar sin imagen en caso de error
                imagenUrl = null;
            }
        } else if (currentImagenUrl && currentImagenUrl.trim() !== '') {
            // Si no hay archivo pero sí una URL válida (externa o del storage), usarla directamente
            imagenUrl = currentImagenUrl;
        }
        // Si no hay ni archivo ni URL, imagenUrl queda como null
        
        // Preparar datos con fix de decimales para evitar errores como 14.60000000001
        const platilloData = {
            nombre: nombre,
            categoria: categoria,
            subcategoria: subcategoria,
            precio: parseFloat(parseFloat(precio).toFixed(2)),
            descripcion: descripcion,
            disponible: disponible,
            ingredientes: Object.keys(ingredientes).length > 0 ? ingredientes : null,
            imagen: imagenUrl,
            stock: null // Se calculará automáticamente
        };
        
        // Solo agregar ID si es un nuevo platillo
        if (!window.platilloEditandoId) {
            platilloData.id = 'plat_' + crypto.randomUUID();
        }
        
        try {
            let error;
            if (window.platilloEditandoId) {
                // Actualizar existente
                const { error: updError } = await window.supabaseClient.from('menu')
                    .update(platilloData)
                    .eq('id', window.platilloEditandoId);
                error = updError;
            } else {
                // Crear nuevo
                const { error: insError } = await window.supabaseClient.from('menu')
                    .insert([platilloData]);
                error = insError;
            }
            
            if (error) throw error;
            
            // Éxito - mensaje específico según acción
            window.cerrarModal('platilloModal');
            window.limpiarImagenPreview();
            window.platilloEditandoId = null;
            await window.cargarInventario(); // Recargar inventario primero para actualizar stock
            await window.cargarMenu(); // Luego recargar menú con el nuevo stock calculado
            const mensajeExito = window.platilloEditandoId ? 'Platillo editado con éxito' : 'Platillo creado con éxito';
            window.mostrarToast('✅ ' + mensajeExito, 'success');
            
        } catch (e) {
            console.error('Error guardando platillo:', e);
            window.mostrarToast('❌ Error al guardar: ' + (e.message || e), 'error');
        }
    };
})();
