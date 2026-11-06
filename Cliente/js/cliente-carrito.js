// cliente-carrito.js - Cart CRUD, 3-level grouping, localStorage persistence
(function() {
    window.Saki = window.Saki || {};
    window.Saki.modules = window.Saki.modules || {};
    window.Saki.modules.carrito = {};
    var S = window.Saki;

    var nivel1Activo = null;
    var nivel2Activo = null;
    var _ultimoClickCarrito = {}; // { platilloId: timestamp } for debounce

    function actualizarCarritoBadge() {
        var badge = document.getElementById('cartBadge');
        if (!badge) return;
        var total = 0;
        (S.state.carrito || []).forEach(function(item) {
            total += item.cantidad || 1;
        });
        if (total > 0) {
            badge.textContent = total;
            badge.style.display = 'inline';
        } else {
            badge.style.display = 'none';
            badge.textContent = '0';
        }
    }
    window.actualizarCarritoBadge = actualizarCarritoBadge;
    S.modules.carrito.actualizarCarritoBadge = actualizarCarritoBadge;

    function agregarAlCarrito(platilloId) {
        // Debounce: ignore rapid clicks on same item within 500ms
        var ahora = Date.now();
        var ultimo = _ultimoClickCarrito[platilloId] || 0;
        if (ahora - ultimo < 500) {
            return; // Ignorar click duplicado rápido
        }
        _ultimoClickCarrito[platilloId] = ahora;

        var item = (S.state.menuItems || []).find(function(i) { return i.id == platilloId; });
        if (!item) return;

        // Red de seguridad: aunque la tarjeta no mostrara el bloqueo, un platillo sin
        // ingredientes suficientes no entra al carrito. El stock real se calcula como
        // min(stock - reservado) entre los ingredientes de la receta.
        // Red de seguridad PRIMERO: si la regla principal/secundario dice
        // bloqueado, no entra aunque el número de stock diera positivo.
        // Un faltante principal no es cuestión de cantidades: no se puede
        // preparar el plato.
        var disp = window._disponibilidad && window._disponibilidad[platilloId];
        if (disp && disp.bloqueado) {
            var faltan = (disp.faltanPrincipales || []).join(', ');
            if (S.utils && S.utils.mostrarToast) {
                S.utils.mostrarToast('🚫 ' + item.nombre + ' no se puede preparar' +
                    (faltan ? ': falta ' + faltan : ''), 'error');
            }
            return;
        }

        var stockDisp = (window._stockPrecalculado && window._stockPrecalculado[platilloId]);
        if (stockDisp === undefined) stockDisp = 0;
        if (stockDisp <= 0 || item.disponible === false) {
            if (S.utils && S.utils.mostrarToast) {
                S.utils.mostrarToast('🚫 ' + item.nombre + ' no está disponible', 'error');
            }
            return;
        }

        var precioFinal = S.utils.usdToBs(item.precio);
        var instancia = {
            id: S.utils.generarId('cart_'),
            platilloId: platilloId,
            nombre: item.nombre,
            imagen: item.imagen,
            precio: precioFinal,
            cantidad: 1,
            personalizacion: null,
            ingredientesQuitados: [],
            tipo: 'completo',
            ts: Date.now()
        };
        S.state.carrito.push(instancia);
        guardarCarrito();
        actualizarCarritoBadge();
        actualizarCarritoUI();
        if (window.mostrarToast) window.mostrarToast('✅ ' + item.nombre + ' agregado al carrito', 'success');
        if (window.precalcularStockMenu) window.precalcularStockMenu();
        if (window.actualizarStockTarjetas) window.actualizarStockTarjetas();
        // Scroll to cart item
        if (window.iniciarSeguimientoScroll) window.iniciarSeguimientoScroll();
        if (window._enfocarUltimoItemCarrito) window._enfocarUltimoItemCarrito(instancia);
    }
    window.agregarAlCarrito = agregarAlCarrito;
    S.modules.carrito.agregarAlCarrito = agregarAlCarrito;

    /**
     * Guarda el carrito en el teléfono del cliente.
     *
     * ANTES: el `catch` estaba vacío. Si el guardado fallaba, el carrito
     * seguía andando pero NO sobrevivía a cerrar el navegador. El cliente se
     * enteraba en el peor momento: volvía y estaba vacío.
     *
     * AHORA: tres cosas, sin molestar al cliente.
     *
     *   1. REINTENTO. Muchos fallos son momentáneos (el teléfono estaba
     *      ocupado con otra cosa). Un segundo intento resuelve la mayoría.
     *
     *   2. DISTINGUIR LA CAUSA. No es lo mismo que el espacio esté lleno
     *      (se puede limpiar) que estar en modo privado (no hay arreglo). Se
     *      intenta liberar espacio y reintentar solo en el primer caso.
     *
     *   3. NO AVISAR. Decisión del dueño: no ser intrusivo. El reintento y la
     *      limpieza resuelven el problema en silencio. Solo si TODO falla se
     *      deja una marca en `window._carritoNoGuardado` para que otra parte
     *      de la app decida si conviene decir algo.
     */
    function guardarCarrito() {
        var data = { items: S.state.carrito, timestamp: Date.now() };
        var json;
        try {
            json = JSON.stringify(data);
        } catch (e) {
            // Esto no es falta de espacio: es un dato que no se puede
            // serializar. No hay reintento que lo arregle.
            window._carritoNoGuardado = { motivo: 'serializacion', detalle: e.message };
            return;
        }

        var guardado = _intentarGuardar(json);
        if (guardado.ok) {
            window._carritoNoGuardado = null;
        } else {
            // ---- Reintento 1: puede ser momentáneo ----
            guardado = _intentarGuardar(json);
        }

        if (!guardado.ok) {
            // ---- ¿Es falta de espacio? Entonces se limpia lo viejo ----
            if (_pareceFaltaDeEspacio(guardado.err)) {
                _liberarEspacioViejo();
                guardado = _intentarGuardar(json);
            }
        }

        if (!guardado.ok) {
            window._carritoNoGuardado = {
                motivo: _pareceFaltaDeEspacio(guardado.err) ? 'espacio' : 'no-disponible',
                detalle: guardado.err && guardado.err.message
            };
            console.warn('[carrito] no se pudo guardar:', window._carritoNoGuardado);
        }

        // ---- Copia de la cuenta ----
        // Mientras hay sesión abierta, el carrito se guarda TAMBIÉN bajo la
        // cuenta. Sin esto, la copia se quedaría congelada en el momento del
        // último inicio de sesión y, al recargar, se restauraría una versión
        // vieja encima de la buena.
        if (guardado.ok) {
            var idCuenta = _idCuentaActual();
            if (idCuenta) _guardarCrudoEnClave(claveDeCuenta(idCuenta), json);
        }

        // Fase 1: cada cambio del carrito REINICIA el plazo de 20 minutos.
        // Si el carrito queda vacío, se deja de vigilar.
        if (window.reiniciarContadorCarrito) {
            if (S.state.carrito && S.state.carrito.length > 0) {
                window.reiniciarContadorCarrito();
            } else if (window.detenerVigilanciaCarrito) {
                window.detenerVigilanciaCarrito();
            }
        }
    }

    /** Un intento de escritura. Devuelve {ok, err} en vez de lanzar. */
    function _intentarGuardar(json) {
        try {
            localStorage.setItem('saki_carrito', json);
            return { ok: true };
        } catch (e) {
            return { ok: false, err: e };
        }
    }

    /**
     * ¿El error es por falta de espacio?
     *
     * Los navegadores no coinciden en el nombre: Chrome usa
     * QuotaExceededError con código 22, Firefox 1014, Safari 22 o 1014.
     * Se mira el nombre y el código, no el mensaje (que cambia con el idioma).
     */
    function _pareceFaltaDeEspacio(err) {
        if (!err) return false;
        return err.name === 'QuotaExceededError' ||
               err.name === 'NS_ERROR_DOM_QUOTA_REACHED' ||
               err.code === 22 || err.code === 1014;
    }

    /**
     * Borra del teléfono lo que ya no sirve para hacer lugar.
     *
     * Solo toca claves propias del carrito y datos viejos del menú. NUNCA
     * toca la sesión del mesonero ni la del admin: borrar eso sacaría a la
     * gente de su cuenta sin avisar.
     */
    function _liberarEspacioViejo() {
        var borrables = [
            'saki_carrito_timer',      // contador de la fase 1: se recalcula
            'saki_reserva_data',       // formulario de reserva a medio llenar
            'saki_delivery_data',      // formulario de delivery a medio llenar
            'saki_ultima_categoria'    // última sección mirada: es cosmético
        ];
        borrables.forEach(function (k) {
            try { localStorage.removeItem(k); } catch (e) {}
        });
    }
    window.guardarCarrito = guardarCarrito;
    S.modules.carrito.guardarCarrito = guardarCarrito;

    function restaurarCarrito() {
        try {
            var saved = localStorage.getItem('saki_carrito');
            if (!saved) return false;
            var data = JSON.parse(saved);
            if (!data || !data.items || !data.timestamp) return false;
            // El TTL de 1 hora se quitó: ahora lo maneja cliente-carrito-timer.js
            // con 20 minutos REINICIABLES desde la última acción, que es lo que
            // definió el dueño. Aquí solo se restaura; el vencimiento real lo
            // decide revisarCarritoAlCargar().
            S.state.carrito = data.items;
            return true;
        } catch(e) {
            return false;
        }
    }
    window.restaurarCarrito = restaurarCarrito;
    S.modules.carrito.restaurarCarrito = restaurarCarrito;

    // ==================== CARRITO POR CUENTA ====================
    //
    // POR QUÉ EXISTE ESTO
    //
    // El carrito vive en `localStorage`, que es del teléfono, no de la
    // persona. Sin separación por cuenta, quien entraba veía el pedido que
    // había armado la cuenta anterior: mismo aparato, misma pestaña, y para el
    // navegador no hay ninguna diferencia.
    //
    // CÓMO QUEDA
    //
    //   · Invitado arma un pedido y ENTRA: el pedido sigue. Es la misma
    //     persona física, ahora con nombre. No se pierde nada.
    //   · Hay cuenta abierta y CIERRA SESIÓN: el carrito se vacía y queda como
    //     un invitado recién llegado. Antes de vaciarlo, su contenido se guarda
    //     bajo la cuenta.
    //   · Esa misma cuenta vuelve a entrar: su carrito reaparece tal como estaba.
    //
    // La copia de la cuenta vive en `saki_carrito_cuenta_<id>`. NUNCA se mezcla
    // con la del invitado (`saki_carrito`).

    function claveDeCuenta(usuarioId) {
        return 'saki_carrito_cuenta_' + String(usuarioId || '');
    }

    /** Id de la cuenta a la que pertenece lo guardado ahora mismo, o null. */
    var _cuentaActiva = null;

    /** El id de la cuenta abierta ahora mismo, o null si es invitado. */
    function _idCuentaActual() {
        // Manda el último aviso explícito de identidad (`alEntrarACuenta`).
        // Si se preguntara solo a `SakiCliente`, una carrera de orden de carga
        // haría que el carrito no se guardara bajo la cuenta.
        if (_cuentaActiva) return _cuentaActiva;
        try {
            if (window.SakiCliente && window.SakiCliente.usuario) {
                var u = window.SakiCliente.usuario();
                return (u && u.id) ? u.id : null;
            }
        } catch (e) { /* sin sesión */ }
        return null;
    }

    function _guardarCrudoEnClave(clave, json) {
        try {
            localStorage.setItem(clave, json);
            return true;
        } catch (e) {
            return false;
        }
    }

    /**
     * Foto del carrito, en el tamaño que se ve y en WebP.
     *
     * La miniatura mide 40x40 px, pero antes se pedía `item.imagen` tal
     * cual: la dirección ORIGINAL del platillo. En las fotos de Unsplash
     * eso son 5,4 MB por una miniatura de 40 px, y el carrito la pedía
     * DOS veces por cada plato.
     *
     * Se reusa `optimizarUrlImagen` —la misma función que ya usa la
     * carta— en vez de escribir otra regla de optimización aquí. Una
     * sola fuente de verdad para cómo se piden las fotos.
     *
     * Una sola consulta por espacio de nombres: las dos ramas del
     * carrito (personalizado y simple) llaman a esta misma función.
     */
    function _fotoMiniatura(item) {
        var original = item && item.imagen;
        if (!original) return 'https://via.placeholder.com/40';
        if (window.optimizarUrlImagen) {
            // 120 px alcanza para un cuadro de 40 (3x en pantalla densa).
            return window.optimizarUrlImagen(original).replace(/([?&])w=\d+/, '$1w=120');
        }
        return original;
    }

    /** Devuelve los artículos guardados bajo una clave, o [] si no hay nada. */
    function _itemsDeClave(clave) {
        try {
            var crudo = localStorage.getItem(clave);
            if (!crudo) return [];
            var d = JSON.parse(crudo);
            if (d && Array.isArray(d.items)) return d.items;
            if (Array.isArray(d)) return d;   // formato viejo: array pelado
            return [];
        } catch (e) {
            return [];
        }
    }

    /**
     * Se llama al ENTRAR a una cuenta (contraseña, registro o Google).
     *
     * Si la persona ya traía un pedido armado como invitado, ese pedido manda:
     * es continuidad, y es lo que el dueño definió. Solo si el invitado NO
     * tenía nada se recupera el carrito que esa cuenta dejó guardado.
     *
     * OJO CON EL ORDEN AL VOLVER DE GOOGLE. Cuando se vuelve de Google la
     * página se recarga: la sesión se detecta ANTES de que el carrito se lea
     * de disco, así que la memoria (`S.state.carrito`) todavía está vacía. Por
     * eso se miran los dos lados, memoria y disco. Mirar solo la memoria haría
     * creer que el invitado no tenía nada y se perdería su pedido.
     */
    function alEntrarACuenta(usuarioId) {
        if (!usuarioId) return;

        // A partir de aquí, lo que se guarde pertenece a esta cuenta.
        _cuentaActiva = usuarioId;

        var enMemoria = (S.state.carrito && S.state.carrito.length > 0);
        var enDisco = _itemsDeClave('saki_carrito');
        var invitadoTraeAlgo = enMemoria || enDisco.length > 0;

        // ---- Carrito ----
        if (invitadoTraeAlgo) {
            // Continuidad: lo que armó como invitado pasa a ser de la cuenta.
            // Si estaba solo en disco (vuelta de Google), se sube a memoria
            // antes de guardar para no dejarlo escrito a medias.
            if (!enMemoria && enDisco.length > 0) {
                S.state.carrito = enDisco;
                if (window.actualizarCarritoUI) window.actualizarCarritoUI();
                if (window.actualizarCarritoBadge) window.actualizarCarritoBadge();
            }
            guardarCarrito();
        } else {
            var recuperado = _itemsDeClave(claveDeCuenta(usuarioId));
            if (recuperado.length > 0) {
                S.state.carrito = recuperado;
                guardarCarrito();
                if (window.actualizarCarritoUI) window.actualizarCarritoUI();
                if (window.actualizarCarritoBadge) window.actualizarCarritoBadge();
                if (window.reiniciarContadorCarrito) window.reiniciarContadorCarrito();
            }
        }

        // ---- Historial y favoritos ----
        // Solo si el invitado no traía los suyos. Si traía, son suyos y se
        // quedan: es la misma persona física, igual que con el carrito.
        _restaurarListaDeCuenta(usuarioId, '_historial', 'saki_historial',
            'historialPedidos', window.actualizarBotonHistorial);

        _restaurarListaDeCuenta(usuarioId, '_favoritos', 'saki_favoritos',
            'favoritos', function () {
                if (window.renderizarMenuPaginado) {
                    try { window.renderizarMenuPaginado(); } catch (e) { /* no crítico */ }
                }
            });

        if (window.precalcularStockMenu) window.precalcularStockMenu();
    }

    /**
     * Devuelve una lista guardada bajo la cuenta, si el invitado no tiene nada.
     *
     * Se usa para el historial y los favoritos, que siguen la misma regla que
     * el carrito: lo que el invitado ya traía manda; si no traía nada, se
     * recupera lo de la cuenta.
     */
    function _restaurarListaDeCuenta(usuarioId, sufijo, claveInvitado, campoEstado, alTerminar) {
        var yaTiene = false;
        try {
            var actual = S.state[campoEstado];
            yaTiene = Array.isArray(actual) && actual.length > 0;
        } catch (e) { /* sin estado */ }

        if (!yaTiene) {
            var enDisco = _itemsDeClave(claveInvitado);
            yaTiene = enDisco.length > 0;
        }
        if (yaTiene) return;

        var guardada;
        try {
            var crudo = localStorage.getItem(claveDeCuenta(usuarioId) + sufijo);
            guardada = crudo ? JSON.parse(crudo) : null;
        } catch (e) { guardada = null; }

        if (!Array.isArray(guardada) || guardada.length === 0) return;

        S.state[campoEstado] = guardada;
        try {
            localStorage.setItem(claveInvitado, JSON.stringify(guardada));
        } catch (e) { /* modo privado */ }

        if (typeof alTerminar === 'function') {
            try { alTerminar(); } catch (e) { /* no crítico */ }
        }
    }
    window.alEntrarACuenta = alEntrarACuenta;
    S.modules.carrito.alEntrarACuenta = alEntrarACuenta;

    /**
     * Se llama al CERRAR sesión.
     *
     * Guarda lo que había bajo la cuenta, y deja la pantalla como un invitado
     * recién llegado: carrito vacío, contador detenido, insignia en cero.
     *
     * También se lleva el historial de pedidos y los favoritos, que viven en el
     * mismo sitio y tienen el mismo problema: son del TELÉFONO, no de la
     * persona. El historial es el más delicado de los tres, porque muestra qué
     * pidió y cuánto gastó. Se guardan bajo la cuenta antes de borrarlos, igual
     * que el carrito, para devolverlos cuando esa cuenta vuelva.
     */
    function alSalirDeCuenta(usuarioId) {
        // Sin id de cuenta no hay a quién devolverle nada: es un invitado y su
        // carrito no se toca. Sin esta salida temprana, un cierre de sesión sin
        // sesión real borraría el pedido del invitado.
        if (!usuarioId) return;

        _cuentaActiva = null;

        _guardarCrudoEnClave(
            claveDeCuenta(usuarioId),
            JSON.stringify({ items: S.state.carrito || [], timestamp: Date.now() })
        );
        _guardarCrudoEnClave(claveDeCuenta(usuarioId) + '_historial',
            JSON.stringify(S.state.historialPedidos || []));
        _guardarCrudoEnClave(claveDeCuenta(usuarioId) + '_favoritos',
            JSON.stringify(S.state.favoritos || []));

        S.state.carrito = [];
        try {
            localStorage.removeItem('saki_carrito');
            localStorage.removeItem('saki_carrito_inicio');
            localStorage.removeItem('saki_historial');
            localStorage.removeItem('saki_favoritos');
        } catch (e) { /* modo privado */ }

        // Las copias en memoria también se vacían. Si solo se borrara el
        // almacenamiento, la pantalla seguiría mostrando los pedidos de la
        // cuenta que acaba de salir hasta recargar la página.
        S.state.historialPedidos = [];
        S.state.favoritos = [];

        if (window.detenerVigilanciaCarrito) window.detenerVigilanciaCarrito();
        if (window.actualizarCarritoUI) window.actualizarCarritoUI();
        if (window.actualizarCarritoBadge) window.actualizarCarritoBadge();
        if (window.actualizarBotonHistorial) window.actualizarBotonHistorial();
        if (window.renderizarMenuPaginado) {
            try { window.renderizarMenuPaginado(); } catch (e) { /* no crítico */ }
        }
        if (window.precalcularStockMenu) window.precalcularStockMenu();
    }
    window.alSalirDeCuenta = alSalirDeCuenta;
    S.modules.carrito.alSalirDeCuenta = alSalirDeCuenta;

    function eliminarInstancia(instanciaId) {
        S.state.carrito = S.state.carrito.filter(function(i) { return i.id !== instanciaId; });
        guardarCarrito();
        actualizarCarritoUI();
        actualizarCarritoBadge();
        if (S.state.carrito.length === 0) {
            if (window.detenerSeguimientoScroll) window.detenerSeguimientoScroll();
        }
        if (window.precalcularStockMenu) window.precalcularStockMenu();
        if (window.actualizarStockTarjetas) window.actualizarStockTarjetas();
    }
    window.eliminarInstancia = eliminarInstancia;
    S.modules.carrito.eliminarInstancia = eliminarInstancia;

    function toggleNivel1(grupoId) {
        nivel1Activo = nivel1Activo === grupoId ? null : grupoId;
        nivel2Activo = null;
        actualizarCarritoUI();
    }
    window.toggleNivel1 = toggleNivel1;
    S.modules.carrito.toggleNivel1 = toggleNivel1;

    function toggleNivel2(subgrupoId, grupoPadreId) {
        if (nivel1Activo !== grupoPadreId) {
            nivel1Activo = grupoPadreId;
        }
        nivel2Activo = nivel2Activo === subgrupoId ? null : subgrupoId;
        actualizarCarritoUI();
    }
    window.toggleNivel2 = toggleNivel2;
    S.modules.carrito.toggleNivel2 = toggleNivel2;

    function borrarGrupoNivel1(grupoId) {
        S.state.carrito = S.state.carrito.filter(function(i) { return i.platilloId != grupoId; });
        guardarCarrito();
        actualizarCarritoUI();
        actualizarCarritoBadge();
        if (window.precalcularStockMenu) window.precalcularStockMenu();
        if (window.actualizarStockTarjetas) window.actualizarStockTarjetas();
    }
    window.borrarGrupoNivel1 = borrarGrupoNivel1;
    S.modules.carrito.borrarGrupoNivel1 = borrarGrupoNivel1;

    function borrarGrupoNivel2(subgrupoId) {
        S.state.carrito = S.state.carrito.filter(function(i) { return i.id !== subgrupoId && i.personalizacion !== subgrupoId; });
        guardarCarrito();
        actualizarCarritoUI();
        actualizarCarritoBadge();
        if (window.precalcularStockMenu) window.precalcularStockMenu();
        if (window.actualizarStockTarjetas) window.actualizarStockTarjetas();
    }
    window.borrarGrupoNivel2 = borrarGrupoNivel2;
    S.modules.carrito.borrarGrupoNivel2 = borrarGrupoNivel2;

    /**
     * Etiqueta CORTA para la fila del carrito.
     *
     * Antes decía siempre "Personalizado", así que dos platos distintos se
     * veían igual y había que abrirlos para distinguirlos. Ahora dice qué
     * cambió: "Sin cebolla · Sin aguacate" o "Con arroz extra".
     */
    function _etiquetaCorta(item) {
        var sin = (item.ingredientesQuitados || []).length;
        var con = (item.ingredientesAgregados || []).length;
        if (sin === 0 && con === 0) return null;   // plato completo

        var partes = [];
        if (sin > 0) partes.push('Sin ' + item.ingredientesQuitados.join(', '));
        if (con > 0) partes.push('Con ' + item.ingredientesAgregados.map(function (a) {
            return a.nombre || a;
        }).join(', '));
        return partes.join(' · ');
    }

    /**
     * Detalle COMPLETO, que se abre al tocar el nombre del plato.
     *
     * Muestra el plato entero marcando qué se queda y qué no, para que el
     * cliente no tenga que recordar qué traía originalmente. Es la opción
     * que eligió el dueño: "✓ Arroz · ✗ Cebolla · ✓ Cangrejo".
     */
    function _detalleCompleto(item, nombrePlato) {
        var quitados = item.ingredientesQuitados || [];
        var agregados = (item.ingredientesAgregados || []).map(function (a) { return a.nombre || a; });

        // La receta real del plato, si el estado global la tiene a mano.
        var plato = (S.state.menuItems || []).find(function (m) { return m.id === item.platilloId; });
        var receta = [];
        if (plato && plato.ingredientes) {
            Object.keys(plato.ingredientes).forEach(function (k) {
                receta.push(plato.ingredientes[k].nombre);
            });
        }

        if (!receta.length && !quitados.length && !agregados.length) {
            return '<div style="font-size:.78rem;opacity:.7">' + (nombrePlato || 'Completo') + '</div>';
        }

        var lineas = receta.map(function (n) {
            var fuera = quitados.indexOf(n) !== -1;
            return '<div style="font-size:.75rem;display:flex;gap:.35rem;align-items:center;' +
                (fuera ? 'opacity:.5;text-decoration:line-through' : '') + '">' +
                '<span style="color:' + (fuera ? '#ef4444' : '#4ade80') + '">' +
                (fuera ? '✗' : '✓') + '</span><span>' + n + '</span></div>';
        }).join('');

        var extras = agregados.map(function (n) {
            return '<div style="font-size:.75rem;display:flex;gap:.35rem;align-items:center;color:#4ade80">' +
                '<span>+</span><span>' + n + '</span></div>';
        }).join('');

        return lineas + extras;
    }

    function agruparItemsJerarquicamente() {
        var grupos = {};
        (S.state.carrito || []).forEach(function(item) {
            var key = item.platilloId;
            if (!grupos[key]) {
                grupos[key] = { platilloId: key, nombre: item.nombre, precio: item.precio, items: [] };
            }
            grupos[key].items.push(item);
        });
        var resultado = [];
        for (var key in grupos) {
            var grupo = grupos[key];
            var subgrupos = {};
            grupo.items.forEach(function(item) {
                var subKey = item.personalizacion || 'default_' + item.id;
                if (!subgrupos[subKey]) {
                    subgrupos[subKey] = { id: subKey, personalizacion: item.personalizacion, items: [] };
                }
                subgrupos[subKey].items.push(item);
            });
            grupo.subgrupos = subgrupos;
            resultado.push(grupo);
        }
        return resultado;
    }
    S.modules.carrito.agruparItemsJerarquicamente = agruparItemsJerarquicamente;

    function actualizarCarritoUI() {
        var cartItems = document.getElementById('cartItems');
        var cartFooter = document.getElementById('cartFooter');
        if (!cartItems) return;

        if (!S.state.carrito || S.state.carrito.length === 0) {
            cartItems.innerHTML = '<div class="cart-items-inner">' +
                '<div class="cart-empty"><i class="fas fa-shopping-basket"></i><p>Tu carrito está vacío</p><small>¡Agrega algunos platillos!</small></div></div>';
            if (cartFooter) cartFooter.style.display = 'none';
            actualizarCarritoBadge();
            return;
        }

        var grupos = agruparItemsJerarquicamente();
        var html = '<div class="cart-items-inner">';

        grupos.forEach(function(grupo, gi) {
            var grupoId = grupo.platilloId;
            var isOpen = nivel1Activo == grupoId;
            var totalGrupo = 0;
            var itemsCount = 0;
            grupo.items.forEach(function(i) { totalGrupo += i.precio * i.cantidad; itemsCount += i.cantidad; });

            html += '<div class="nivel1-group">' +
                '<div class="nivel1-header" data-grupo-id="' + grupoId + '">' +
                '<div class="header-row">' +
                '<div class="nombre"><i class="fas fa-chevron-right' + (isOpen ? ' rotated' : '') + '"></i> ' + grupo.nombre + '</div>' +
                '<button class="btn-borrar-grupo" data-nivel1="' + grupoId + '" title="Eliminar todos"><i class="fas fa-trash-alt"></i></button>' +
                '</div>' +
                '<div class="header-details">' +
                '<span><i class="fas fa-sort-amount-up"></i> ' + itemsCount + ' uds</span>' +
                '<span><i class="fas fa-dollar-sign"></i> ' + S.utils.formatBs(totalGrupo) + '</span>' +
                '</div></div>';

            html += '<div class="nivel2-container' + (isOpen ? ' expanded' : '') + '">';
            for (var subKey in grupo.subgrupos) {
                var sub = grupo.subgrupos[subKey];
                var subOpen = nivel2Activo == sub.id;
                var totalSub = 0;
                sub.items.forEach(function(i) { totalSub += i.precio * i.cantidad; });

                if (sub.personalizacion) {
                    html += '<div class="nivel2-group">' +
                        '<div class="nivel2-header" data-subgrupo-id="' + sub.id + '" data-grupo-padre="' + grupoId + '">' +
                        '<div class="header-row">' +
                        '<div class="nombre"><i class="fas fa-chevron-right' + (subOpen ? ' rotated' : '') + '"></i> Personalizado</div>' +
                        '<button class="btn-borrar-grupo" data-nivel2="' + sub.id + '" title="Eliminar personalizados"><i class="fas fa-trash-alt"></i></button>' +
                        '</div>' +
                        '<div class="header-details"><span><i class="fas fa-dollar-sign"></i> ' + S.utils.formatBs(totalSub) + '</span></div></div>' +
                        '<div class="nivel3-container' + (subOpen ? ' expanded' : '') + '">';
                    sub.items.forEach(function(item, ii) {
                        // Etiqueta corta: dice QUÉ cambió, no la palabra fija
                        // "Personalizado". Dos platos distintos se distinguen
                        // sin abrirlos.
                        var corta = _etiquetaCorta(item);
                        var detalleId = 'det_' + item.id;
                        html += '<div class="nivel3-item">' +
                            '<div class="item-image" style="background-image:url(\'' + _fotoMiniatura(item) + '\')"></div>' +
                            '<div class="item-info">' +
                            // El nombre es tocable: abre el detalle completo
                            // (la receta marcada ✓/✗) sin salir del carrito.
                            '<div><span class="item-number">#' + (ii + 1) + '</span>' +
                            '<span class="item-name item-name-tocable" role="button" tabindex="0" ' +
                            'style="cursor:pointer;text-decoration:underline dotted;text-underline-offset:3px" ' +
                            'onclick="window._toggleDetalleItem(\'' + detalleId + '\')">' +
                            (item.personalizacion || grupo.nombre) + '</span></div>' +
                            (corta
                              ? '<div class="personalizacion"><i class="fas fa-cog"></i> ' + corta + '</div>'
                              : '<div class="personalizacion"><i class="fas fa-check"></i> Completo</div>') +
                            '<div id="' + detalleId + '" style="display:none;margin-top:.3rem;' +
                            'border-left:2px solid rgba(255,255,255,.15);padding-left:.5rem">' +
                            _detalleCompleto(item, grupo.nombre) + '</div>' +
                            '</div>' +
                            '<div class="item-precio">' + S.utils.formatBs(item.precio * item.cantidad) + '</div>' +
                            '<button class="btn-remove-item" data-id="' + item.id + '"><i class="fas fa-times"></i></button></div>';
                    });
                    html += '</div></div>';
                } else {
                    // Default group (no personalization) — show items directly
                    sub.items.forEach(function(item, ii) {
                        html += '<div class="nivel3-item">' +
                            '<div class="item-image" style="background-image:url(\'' + _fotoMiniatura(item) + '\')"></div>' +
                            '<div class="item-info"><span class="item-number">#' + (ii + 1) + '</span><span class="item-name">' + grupo.nombre + '</span></div>' +
                            '<div class="item-precio">' + S.utils.formatBs(item.precio * item.cantidad) + '</div>' +
                            '<button class="btn-remove-item" data-id="' + item.id + '"><i class="fas fa-times"></i></button></div>';
                    });
                }
            }
            html += '</div></div>';
        });

        // Nivel 1 del borrado: vaciar el carrito ENTERO.
        //
        // Faltaba. Había un "borrar grupo" por plato, pero ninguno para
        // vaciar todo: el cliente que se arrepiente de todo tenía que borrar
        // plato por plato.
        html += '<div class="cart-vaciar-wrap" style="padding:.5rem .8rem 0">' +
            '<button id="btnVaciarCarrito" class="btn-vaciar-carrito" ' +
            'style="width:100%;background:rgba(239,68,68,.12);color:#ff6b6b;' +
            'border:1px solid rgba(239,68,68,.35);border-radius:8px;padding:.5rem;' +
            'font-size:.82rem;font-weight:600;cursor:pointer;display:flex;' +
            'align-items:center;justify-content:center;gap:.4rem">' +
            '<i class="fas fa-trash-alt"></i> Vaciar carrito</button></div>';

        // Scroll indicator cascade (flechas para bajar a botones de acción)
        html += '<div class="scroll-indicator-cascade" onclick="window.irABotonesAccion()">' +
            '<i class="fas fa-chevron-down cascade-arrow"></i>' +
            '<i class="fas fa-chevron-down cascade-arrow"></i>' +
            '<i class="fas fa-chevron-down cascade-arrow"></i>' +
            '<div class="cascade-text"><i class="fas fa-arrow-down"></i> Ir a opciones</div></div>' +
            '</div>'; // close cart-items-inner
        cartItems.innerHTML = html;

        // Vaciar todo: pide confirmación porque no se puede deshacer.
        var btnVaciar = document.getElementById('btnVaciarCarrito');
        if (btnVaciar) {
            btnVaciar.addEventListener('click', function () {
                var unidades = (S.state.carrito || []).reduce(function (a, i) {
                    return a + (i.cantidad || 1);
                }, 0);
                var platos = (S.state.carrito || []).length;

                _confirmarVaciar(platos, unidades);
            });
        }

        // Cart footer
        if (cartFooter) {
            cartFooter.style.display = 'block';
            var total = 0;
            S.state.carrito.forEach(function(i) { total += i.precio * i.cantidad; });
            var totalEl = document.getElementById('cartTotal');
            if (totalEl) totalEl.textContent = S.utils.formatBs(total);

            var cartButtons = document.getElementById('cartButtons');
            if (cartButtons) {
                // Si hay mesaId en URL → interfaz para comer en el local
                // Si no → interfaz online (Delivery + Reserva)
                var esMesa = !!S.state.mesaId;
                if (esMesa) {
                    cartButtons.innerHTML =
                        '<button class="btn-primary" id="mesaOrderBtn"><i class="fas fa-store"></i> Pedir a Mesa</button>';
                    document.getElementById('mesaOrderBtn').addEventListener('click', function() {
                        if (window.abrirConfirmacionMesa) window.abrirConfirmacionMesa();
                    });
                } else {
                    cartButtons.innerHTML =
                        '<button class="btn-primary" id="deliveryOrderBtn"><i class="fas fa-motorcycle"></i> Delivery</button>' +
                        '<button class="btn-secondary" id="reservaOrderBtn"><i class="fas fa-calendar-alt"></i> Reserva</button>';
                    document.getElementById('deliveryOrderBtn').addEventListener('click', function() {
                        if (window.iniciarProcesoDelivery) window.iniciarProcesoDelivery();
                    });
                    document.getElementById('reservaOrderBtn').addEventListener('click', function() {
                        if (window.iniciarProcesoReserva) window.iniciarProcesoReserva();
                    });
                }
            }
        }

        actualizarCarritoBadge();
    }
    window.actualizarCarritoUI = actualizarCarritoUI;
    S.modules.carrito.actualizarCarritoUI = actualizarCarritoUI;

    /**
     * Confirmación para vaciar, hecha a mano.
     *
     * `mostrarConfirmacionPremium` existe en el admin pero NO en el Cliente:
     * llamarla desde acá habría fallado en silencio y el botón no haría nada.
     * Se arma un diálogo propio con las mismas clases que ya usa la app.
     */
    function _confirmarVaciar(platos, unidades) {
        var overlay = document.createElement('div');
        overlay.className = 'modal-overlay active';
        overlay.id = 'confirmVaciarOverlay';
        overlay.innerHTML =
            '<div class="confirm-dialog" style="max-width:330px">' +
              '<div style="font-size:2rem;line-height:1">🗑️</div>' +
              '<h3>Vaciar carrito</h3>' +
              '<p style="font-size:.85rem;opacity:.8;margin-bottom:1rem">' +
                'Se quitan ' + platos + ' plato' + (platos === 1 ? '' : 's') +
                ' (' + unidades + ' unidad' + (unidades === 1 ? '' : 'es') + ').' +
                '<br>Esto no se puede deshacer.' +
              '</p>' +
              '<div class="confirm-dialog-buttons">' +
                '<button class="btn-cancel" id="vaciarCancelar">Cancelar</button>' +
                '<button class="btn-confirm" id="vaciarConfirmar">Vaciar</button>' +
              '</div>' +
            '</div>';
        document.body.appendChild(overlay);

        document.getElementById('vaciarCancelar').addEventListener('click', function () {
            overlay.remove();
        });

        document.getElementById('vaciarConfirmar').addEventListener('click', function () {
            overlay.remove();
            if (window.vaciarCarrito) window.vaciarCarrito();
            if (window.mostrarToast) window.mostrarToast('🗑️ Carrito vaciado', 'success');
            if (window.detenerSeguimientoScroll) window.detenerSeguimientoScroll();
        });
    }

    /** Abre o cierra el detalle de un ítem al tocar su nombre. */
    window._toggleDetalleItem = function _toggleDetalleItem (id) {
        var el = document.getElementById(id);
        if (!el) return;
        el.style.display = (el.style.display === 'none' || !el.style.display) ? 'block' : 'none';
    };

    function getCarrito() {
        return S.state.carrito || [];
    }
    window.getCarrito = getCarrito;
    S.modules.carrito.getCarrito = getCarrito;

    function vaciarCarrito() {
        S.state.carrito = [];
        guardarCarrito();
        actualizarCarritoUI();
        actualizarCarritoBadge();
    }
    window.vaciarCarrito = vaciarCarrito;
    S.modules.carrito.vaciarCarrito = vaciarCarrito;

    // Expose state references for other modules
    S.modules.carrito.nivel1Activo = function(v) {
        if (v !== undefined) nivel1Activo = v;
        return nivel1Activo;
    };
    S.modules.carrito.nivel2Activo = function(v) {
        if (v !== undefined) nivel2Activo = v;
        return nivel2Activo;
    };
})();
