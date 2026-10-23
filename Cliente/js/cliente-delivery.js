// cliente-delivery.js - Delivery, reserva, timer 20 min, pago móvil
(function() {
    window.Saki = window.Saki || {};
    window.Saki.modules = window.Saki.modules || {};
    window.Saki.modules.delivery = {};
    var S = window.Saki;

    var timersActivos = {};
    var intervalosTimer = {};
    var deliveryFormData = { parroquia: '', direccion: '', telefono: '', referencia: '', comprobante: null };
    var reservaFormData = { fecha: '', nombre: '', referencia: '', comprobante: null };
    var isUploading = false;
    var uploadComplete = false;

    var _preciosPorParroquia = {"Altagracia":3,"Antímano":7,"Candelaria":2,"Caricuao":7,"Caucagüita":7,"Catedral":3,"Chacao":5,"Coche":5,"El Cafetal":6,"El Junquito":7,"El Paraíso":4,"El Recreo":4,"El Valle":5,"Fila de Mariches":6,"La Dolorita":6,"La Pastora":3,"La Vega":4,"Las Minas":5,"Leoncio Martínez":6,"Macarao":7,"Nuestra Señora del Rosario":7,"Petare":6,"San Agustín":2,"San Bernardino":2,"San José":2,"San Juan":3,"San Pedro":4,"Santa Rosalía":3,"Santa Rosalía de Palermo":3,"Santa Teresa":3,"Sucre":7,"23 de Enero":4};

    // Store for the delivery flow
    S.state._preciosPorParroquia = _preciosPorParroquia;
    S.state.deliveryFormData = deliveryFormData;
    S.state.reservaFormData = reservaFormData;

    function iniciarProcesoDelivery() {
        var modal = document.getElementById('deliveryModal');
        if (!modal) return;
        // Build summary
        var summary = document.getElementById('resumenPedidoDelivery');
        if (summary) {
            var html = '<div style="font-weight:600;color:var(--accent);margin-bottom:.5rem"><i class="fas fa-shopping-bag"></i> Resumen del pedido</div>';
            var total = 0;
            S.state.carrito.forEach(function(item) {
                total += (item.precio || 0) * (item.cantidad || 1);
                html += '<div style="display:flex;justify-content:space-between;font-size:.85rem;padding:.2rem 0">' +
                    '<span style="color:var(--text-primary)">' + (item.cantidad || 1) + 'x ' + item.nombre + '</span>' +
                    '<span style="color:var(--accent)">' + S.utils.formatBs((item.precio || 0) * (item.cantidad || 1)) + '</span></div>';
            });
            html += '<div style="border-top:1px solid rgba(255,255,255,.1);margin-top:.5rem;padding-top:.5rem;display:flex;justify-content:space-between;font-weight:700">' +
                '<span style="color:var(--text-primary)">Subtotal</span><span style="color:var(--accent)">' + S.utils.formatBs(total) + '</span></div>';
            summary.innerHTML = html;
        }

        // Start 20-minute timer
        iniciarTimerFrontend('delivery', 20);
        restaurarDatosFormulario();
        modal.classList.add('active');
    }
    window.iniciarProcesoDelivery = iniciarProcesoDelivery;
    S.modules.delivery.iniciarProcesoDelivery = iniciarProcesoDelivery;

    function iniciarProcesoReserva() {
        document.getElementById('reservaModal').classList.add('active');
        iniciarTimerFrontend('reserva', 20);
        restaurarDatosFormulario();
    }
    window.iniciarProcesoReserva = iniciarProcesoReserva;
    S.modules.delivery.iniciarProcesoReserva = iniciarProcesoReserva;

    function iniciarTimerFrontend(tipo, minutos) {
        detenerTimer(tipo);
        var totalSegundos = minutos * 60;
        timersActivos[tipo] = totalSegundos;
        var display = document.getElementById(tipo + 'TimerDisplay');
        if (display) {
            var m = Math.floor(totalSegundos / 60).toString().padStart(2, '0');
            var s = (totalSegundos % 60).toString().padStart(2, '0');
            display.textContent = m + ':' + s;
        }
        intervalosTimer[tipo] = setInterval(function() {
            timersActivos[tipo]--;
            var remaining = timersActivos[tipo];
            var m = Math.floor(remaining / 60).toString().padStart(2, '0');
            var s = (remaining % 60).toString().padStart(2, '0');
            if (display) display.textContent = m + ':' + s;
            if (remaining <= 0) {
                detenerTimer(tipo);
                document.getElementById(tipo + 'Modal').classList.remove('active');
                if (window.mostrarToast) window.mostrarToast('⏰ Tiempo de pago agotado. Pedido cancelado.', 'warning');

                // ── Avisar a la base, no solo a la pantalla ──
                // Antes esto terminaba acá: el modal se cerraba y el mensaje
                // decía "cancelado", pero el pedido seguía 'pendiente' en la
                // base con sus ingredientes reservados. La reserva quedaba
                // tomada para siempre.
                //
                // Ahora se intenta cancelar de verdad. El barrido de pg_cron
                // es la red de seguridad para cuando el cliente cerró la
                // pestaña; esto es el caso normal, con la pestaña abierta.
                if (window.cancelarPedidoPorVencimiento) {
                    window.cancelarPedidoPorVencimiento(S.state.pedidoPendienteId)
                        .catch(function(e) { console.warn('No se pudo cancelar el pedido vencido:', e.message); });
                }
                // Limpiar el carrito local: el pedido ya no existe para el cliente
                if (S.state) S.state.carrito = [];
                if (window.guardarCarrito) window.guardarCarrito();
                if (window.actualizarCarritoUI) window.actualizarCarritoUI();
            }
        }, 1000);
    }
    window.iniciarTimerFrontend = iniciarTimerFrontend;
    S.modules.delivery.iniciarTimerFrontend = iniciarTimerFrontend;

    function detenerTimer(tipo) {
        if (intervalosTimer[tipo]) {
            clearInterval(intervalosTimer[tipo]);
            delete intervalosTimer[tipo];
        }
        delete timersActivos[tipo];
    }
    window.detenerTimer = detenerTimer;
    S.modules.delivery.detenerTimer = detenerTimer;

    // ==================== PARROQUIA SELECTOR ====================

    function irAParroquia() {
        var selector = document.getElementById('parroquiaSelectorDiv');
        if (selector) {
            selector.scrollIntoView({ behavior: 'smooth', block: 'center' });
            selector.classList.add('parroquia-highlight');
            setTimeout(function() { selector.classList.remove('parroquia-highlight'); }, 1600);
        }
        toggleParroquiaSelect();
    }
    window.irAParroquia = irAParroquia;
    S.modules.delivery.irAParroquia = irAParroquia;

    function toggleParroquiaSelect() {
        var select = document.getElementById('parroquiaSelect');
        var search = document.getElementById('parroquiaSearch');
        var chevron = document.getElementById('parroquiaChevron');
        if (!select) return;
        var isOpen = select.style.display === 'block';
        select.style.display = isOpen ? 'none' : 'block';
        if (search) search.style.display = isOpen ? 'none' : 'block';
        if (chevron) chevron.className = isOpen ? 'fas fa-chevron-down' : 'fas fa-chevron-up';
        if (!isOpen && search) { search.value = ''; search.focus(); filtrarParroquias(); }
    }
    window.toggleParroquiaSelect = toggleParroquiaSelect;
    S.modules.delivery.toggleParroquiaSelect = toggleParroquiaSelect;

    function seleccionarParroquia(select) {
        var text = document.getElementById('selectedParroquiaText');
        var value = select.value;
        if (value) {
            text.textContent = value;
            deliveryFormData.parroquia = value;
            toggleParroquiaSelect();
            actualizarTotalDelivery();
        }
    }
    window.seleccionarParroquia = seleccionarParroquia;
    S.modules.delivery.seleccionarParroquia = seleccionarParroquia;

    function filtrarParroquias() {
        var search = document.getElementById('parroquiaSearch');
        var select = document.getElementById('parroquiaSelect');
        if (!search || !select) return;
        var term = search.value.toLowerCase();
        var options = select.querySelectorAll('option');
        options.forEach(function(opt) {
            if (opt.value === '') return;
            opt.style.display = opt.textContent.toLowerCase().includes(term) ? 'block' : 'none';
        });
    }
    window.filtrarParroquias = filtrarParroquias;
    S.modules.delivery.filtrarParroquias = filtrarParroquias;

    function actualizarContadorDireccion() {
        var input = document.getElementById('direccion');
        var counter = document.getElementById('direccionCounter');
        if (input && counter) {
            counter.textContent = input.value.length + '/20 caracteres';
        }
    }
    window.actualizarContadorDireccion = actualizarContadorDireccion;
    S.modules.delivery.actualizarContadorDireccion = actualizarContadorDireccion;

    function moverSiguiente(input, type, index) {
        if (input.value.length >= 1) {
            var next = input.nextElementSibling;
            if (next && next.classList.contains('ref-digit')) {
                next.focus();
            }
        }
    }
    window.moverSiguiente = moverSiguiente;
    S.modules.delivery.moverSiguiente = moverSiguiente;

    function actualizarTotalDelivery() {
        if (!deliveryFormData.parroquia) {
            document.getElementById('deliveryTotal').textContent = 'Primero seleccione parroquia a enviar';
            return;
        }
        var costoEnvio = _preciosPorParroquia[deliveryFormData.parroquia] || 0;
        var subtotal = 0;
        S.state.carrito.forEach(function(i) { subtotal += (i.precio || 0) * (i.cantidad || 1); });
        var total = subtotal + costoEnvio;

        document.getElementById('deliveryPriceDisplay').textContent = 'Costo de envío: ' + S.utils.formatBs(costoEnvio);
        document.getElementById('deliveryTotal').textContent = S.utils.formatBs(total);
        document.getElementById('montoPago').textContent = S.utils.formatBs(total);
        document.getElementById('btnCopyMontoPago').style.display = 'inline-block';

        // Actualizar monto en datos de pago
        var montoEl = document.getElementById('montoPago');
        if (montoEl) {
            montoEl.textContent = S.utils.formatBs(total);
            montoEl.classList.remove('valor-placeholder');
        }
    }
    window.actualizarTotalDelivery = actualizarTotalDelivery;
    S.modules.delivery.actualizarTotalDelivery = actualizarTotalDelivery;

    function getReferencia(type) {
        var prefix = type === 'delivery' ? '' : 'ref_';
        var refs = document.querySelectorAll('.ref-digit[data-type="' + type + '"]');
        var val = '';
        refs.forEach(function(r) { val += r.value; });
        return val.length === 6 ? val : '';
    }
    window.getReferencia = getReferencia;
    S.modules.delivery.getReferencia = getReferencia;

    function validarFormularioDelivery() {
        var ok = true;
        // Direccion
        var dir = document.getElementById('direccion');
        if (dir && dir.value.length < 20) ok = false;
        // Telefono
        var tel = document.getElementById('telefono');
        if (tel && tel.value.replace(/[^0-9]/g, '').length < 11) ok = false;
        // Referencia
        var ref = getReferencia('delivery');
        if (ref.length !== 6) ok = false;
        // Comprobante
        if (!uploadComplete) ok = false;
        // Parroquia
        if (!deliveryFormData.parroquia) ok = false;

        var btn = document.getElementById('confirmDeliveryOrder');
        if (btn) btn.disabled = !ok;
        return ok;
    }
    window.validarFormularioDelivery = validarFormularioDelivery;
    S.modules.delivery.validarFormularioDelivery = validarFormularioDelivery;

    function validarFormularioReserva() {
        var ok = true;
        var fecha = document.getElementById('reservaFecha');
        if (fecha && !fecha.value) ok = false;
        var nombre = document.getElementById('reservaNombre');
        if (nombre && nombre.value.trim().length < 3) ok = false;
        var ref = getReferencia('reserva');
        if (ref.length !== 6) ok = false;
        if (!uploadComplete) ok = false;

        var btn = document.getElementById('confirmReservaOrder');
        if (btn) btn.disabled = !ok;
        return ok;
    }
    window.validarFormularioReserva = validarFormularioReserva;
    S.modules.delivery.validarFormularioReserva = validarFormularioReserva;

    function confirmarPedidoDelivery() {
        if (!validarFormularioDelivery()) return;
        if (!S.state.carrito || S.state.carrito.length === 0) return;

        var btn = document.getElementById('confirmDeliveryOrder');
        if (btn) { btn.disabled = true; btn.innerHTML = '<i class="fas fa-spinner fa-spin"></i> Enviando...'; }

        var costoEnvio = _preciosPorParroquia[deliveryFormData.parroquia] || 0;
        var items = S.state.carrito.map(function(i) {
            return {
                // El id real de `menu` es TEXT con forma `plat_<uuid>_<n>`.
                // `parseInt` sobre eso devuelve NaN, y NaN se serializa a JSON
                // como null: la RPC recibía platillo_id null y rechazaba el
                // pedido. Se envía el id tal cual viene del menú.
                platillo_id: i.platilloId,
                nombre: i.nombre,
                cantidad: i.cantidad || 1,
                precio: i.precio || 0,
                personalizacion: i.personalizacion,
                ingredientes_quitados: i.ingredientesQuitados || []
            };
        });
        var total = S.state.carrito.reduce(function(sum, i) { return sum + (i.precio || 0) * (i.cantidad || 1); }, 0) + costoEnvio;
        var totalUSD = S.state.carrito.reduce(function(sum, i) {
            var menuItem = (S.state.menuItems || []).find(function(m) { return m.id == i.platilloId; });
            return sum + (menuItem ? parseFloat(menuItem.precio || 0) : 0) * (i.cantidad || 1);
        }, 0);

        var pedido = {
            id: S.utils.generarId('ped_'),
            tipo: 'delivery',
            items: items,
            total: total,
            total_usd: totalUSD,
            direccion: deliveryFormData.direccion,
            telefono: deliveryFormData.telefono,
            parroquia: deliveryFormData.parroquia,
            costo_envio: costoEnvio,
            referencia: deliveryFormData.referencia,
            fecha: new Date().toISOString()
        };

        if (!window.supabaseClient) return;
        window.supabaseClient.rpc('crear_pedido_con_reserva', {
            p_items: pedido.items,
            p_tipo: 'delivery',
            p_total: pedido.total,
            p_total_usd: pedido.total_usd,
            p_mesa_id: null,
            p_cliente_nombre: '',
            p_notas: 'Delivery - ' + deliveryFormData.parroquia + ' - Ref: ' + deliveryFormData.referencia
        }).then(function(resp) {
            if (resp.error) throw resp.error;
            if (window.agregarPedidoAHistorial) window.agregarPedidoAHistorial(pedido);
            S.state.carrito = [];
            if (window.guardarCarrito) window.guardarCarrito();
            if (window.actualizarCarritoUI) window.actualizarCarritoUI();
            if (window.actualizarCarritoBadge) window.actualizarCarritoBadge();
            // Recordar el pedido real (la RPC genera el id) para poder cancelarlo
            // si el pago no llega antes de que venza el plazo.
            if (resp.data && resp.data.pedido_id) {
                S.state.pedidoPendienteId = resp.data.pedido_id;
                if (window.guardarPedidoPendiente) window.guardarPedidoPendiente(resp.data.pedido_id, 'delivery');
            }
            detenerTimer('delivery');
            limpiarDatosFormulario();
            document.getElementById('deliveryModal').classList.remove('active');
            if (window.mostrarToast) window.mostrarToast('✅ Pedido delivery registrado', 'success');
        }).catch(function(err) {
            if (window.mostrarToast) window.mostrarToast('❌ Error: ' + (err.message || err), 'error');
        }).finally(function() {
            if (btn) { btn.disabled = false; btn.innerHTML = '<i class="fas fa-check"></i> Confirmar Pedido'; }
        });
    }
    window.confirmarPedidoDelivery = confirmarPedidoDelivery;
    S.modules.delivery.confirmarPedidoDelivery = confirmarPedidoDelivery;

    function confirmarPedidoReserva() {
        if (!validarFormularioReserva()) return;
        // Similar to delivery but for reserva
        var btn = document.getElementById('confirmReservaOrder');
        if (btn) { btn.disabled = true; btn.innerHTML = '<i class="fas fa-spinner fa-spin"></i> Enviando...'; }

        detenerTimer('reserva');
        limpiarDatosFormulario();
        document.getElementById('reservaModal').classList.remove('active');
        if (window.mostrarToast) window.mostrarToast('✅ Reserva registrada', 'success');
        if (btn) { btn.disabled = false; btn.innerHTML = '<i class="fas fa-check"></i> Confirmar'; }
    }
    window.confirmarPedidoReserva = confirmarPedidoReserva;
    S.modules.delivery.confirmarPedidoReserva = confirmarPedidoReserva;

    function guardarDatosDelivery() {
        try { sessionStorage.setItem('saki_delivery_data', JSON.stringify(deliveryFormData)); } catch(e) {}
    }
    window.guardarDatosDelivery = guardarDatosDelivery;
    S.modules.delivery.guardarDatosDelivery = guardarDatosDelivery;

    function guardarDatosReserva() {
        try { sessionStorage.setItem('saki_reserva_data', JSON.stringify(reservaFormData)); } catch(e) {}
    }
    window.guardarDatosReserva = guardarDatosReserva;
    S.modules.delivery.guardarDatosReserva = guardarDatosReserva;

    function limpiarDatosFormulario() {
        deliveryFormData = { parroquia: '', direccion: '', telefono: '', referencia: '', comprobante: null };
        reservaFormData = { fecha: '', nombre: '', referencia: '', comprobante: null };
        isUploading = false;
        uploadComplete = false;
        try {
            sessionStorage.removeItem('saki_delivery_data');
            sessionStorage.removeItem('saki_reserva_data');
        } catch(e) {}
    }
    window.limpiarDatosFormulario = limpiarDatosFormulario;
    S.modules.delivery.limpiarDatosFormulario = limpiarDatosFormulario;

    function limpiarCampoComprobante(tipo) {
        var el = document.getElementById('comprobante');
        if (el) el.value = '';
        isUploading = false;
        uploadComplete = false;
        var label = document.getElementById('comprobanteLabel');
        if (label) {
            label.classList.remove('has-file');
            label.innerHTML = '<i class="fas fa-cloud-upload-alt"></i><span>Haz clic para seleccionar una imagen</span><small>JPG, PNG, GIF (max. 5MB)</small>';
        }
    }
    window.limpiarCampoComprobante = limpiarCampoComprobante;
    S.modules.delivery.limpiarCampoComprobante = limpiarCampoComprobante;

    function limpiarReferencias(type) {
        document.querySelectorAll('.ref-digit[data-type="' + type + '"]').forEach(function(r) { r.value = ''; });
    }
    window.limpiarReferencias = limpiarReferencias;
    S.modules.delivery.limpiarReferencias = limpiarReferencias;

    function handleComprobanteSelect(input) {
        if (!input.files || !input.files[0]) return;
        var file = input.files[0];
        if (file.size > 5 * 1024 * 1024) {
            if (window.mostrarToast) window.mostrarToast('❌ La imagen no debe superar 5MB', 'error');
            return;
        }
        isUploading = true;
        uploadComplete = false;

        var label = document.getElementById('comprobanteLabel');
        if (label) {
            label.innerHTML = '<i class="fas fa-spinner fa-spin"></i><span>Subiendo comprobante...</span><small>' + file.name + '</small>';
            label.classList.add('has-file');
        }
        document.getElementById('uploadProgress').style.display = 'block';

        // Upload to Supabase Storage
        if (window.subirComprobante) {
            window.subirComprobante(file, function(progreso) {
                document.getElementById('uploadProgressBar').style.width = progreso + '%';
            }).then(function(url) {
                isUploading = false;
                uploadComplete = true;
                deliveryFormData.comprobante = url;
                document.getElementById('uploadProgressBar').style.width = '100%';
                setTimeout(function() { document.getElementById('uploadProgress').style.display = 'none'; }, 500);
                if (label) {
                    label.innerHTML = '<i class="fas fa-check-circle" style="color:var(--success)"></i><span style="color:var(--success)">Comprobante subido</span><small>' + file.name + '</small>';
                }
                validarFormularioDelivery();
            }).catch(function(err) {
                isUploading = false;
                if (window.mostrarToast) window.mostrarToast('❌ Error al subir: ' + (err.message || err), 'error');
                limpiarCampoComprobante('delivery');
            });
        } else {
            // Fallback: simulate upload
            setTimeout(function() {
                isUploading = false;
                uploadComplete = true;
                deliveryFormData.comprobante = 'uploaded';
                document.getElementById('uploadProgress').style.display = 'none';
                validarFormularioDelivery();
            }, 1000);
        }
    }
    window.handleComprobanteSelect = handleComprobanteSelect;
    S.modules.delivery.handleComprobanteSelect = handleComprobanteSelect;

    function handleComprobanteReservaSelect(input) {
        if (!input.files || !input.files[0]) return;
        var file = input.files[0];
        if (file.size > 5 * 1024 * 1024) {
            if (window.mostrarToast) window.mostrarToast('❌ La imagen no debe superar 5MB', 'error');
            return;
        }
        reservaFormData.comprobante = file.name;
        uploadComplete = true;
        validarFormularioReserva();
    }
    window.handleComprobanteReservaSelect = handleComprobanteReservaSelect;
    S.modules.delivery.handleComprobanteReservaSelect = handleComprobanteReservaSelect;

    function restaurarDatosFormulario() {
        try {
            var saved = sessionStorage.getItem('saki_delivery_data');
            if (saved) {
                var data = JSON.parse(saved);
                if (data.parroquia) deliveryFormData.parroquia = data.parroquia;
                if (data.direccion) { document.getElementById('direccion').value = data.direccion; actualizarContadorDireccion(); }
                if (data.telefono) document.getElementById('telefono').value = data.telefono;
            }
        } catch(e) {}
    }
    window.restaurarDatosFormulario = restaurarDatosFormulario;
    S.modules.delivery.restaurarDatosFormulario = restaurarDatosFormulario;

    function mostrarDialogoContinuar() {
        if (S.state.carrito && S.state.carrito.length > 0) {
            setTimeout(function() {
                if (window.mostrarToast) window.mostrarToast('🛒 Tienes ' + S.state.carrito.length + ' items en tu carrito', 'info');
            }, 1500);
        }
    }
    window.mostrarDialogoContinuar = mostrarDialogoContinuar;
    S.modules.delivery.mostrarDialogoContinuar = mostrarDialogoContinuar;

    // Cleanup all timers
    function detenerTodosLosTimers() {
        for (var key in intervalosTimer) {
            if (intervalosTimer.hasOwnProperty(key)) {
                clearInterval(intervalosTimer[key]);
                delete intervalosTimer[key];
            }
        }
        timersActivos = {};
    }
    S.modules.delivery.detenerTodosLosTimers = detenerTodosLosTimers;
})();
