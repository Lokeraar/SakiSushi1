// admin-auth.js - Autenticación con selección de administrador (corregido)
(function() {
    let selectedAdmin = null;

    window.cargarListaAdminsRecientes = async function() {
        const container = document.getElementById('loginAdminsList');
        if (!container) return;
        
        // Mostrar spinner de carga
        container.innerHTML = '<div class="loading-spinner" style="margin:0 auto;"></div>';
        
        try {
            // Esperar a que supabaseClient esté listo (puede tardar un momento)
            let intentos = 0;
            while (!window.supabaseClient && intentos < 20) {
                await new Promise(r => setTimeout(r, 100));
                intentos++;
            }
            
            const recent = window.obtenerAdminsRecientes();
            let admins = [];
            
            if (recent.length) {
                // Usar los recientes (ya tienen foto o null)
                admins = recent;
            } else {
                // Obtener todos los admins activos de la BD
                const { data, error } = await window.supabaseClient.from('usuarios').select('*').eq('rol', 'admin').eq('activo', true);
                if (error) throw error;
                admins = data || [];
            }
            
            if (!admins.length) {
                container.innerHTML = '<p style="color:var(--text-muted);text-align:center">No hay administradores registrados</p>';
                return;
            }
            
            container.innerHTML = admins.map(admin => {
                const fotoUrl = admin.foto || window.getPlaceholderImage(admin.nombre);
                return `
                    <div class="admin-card" data-id="${admin.id}" data-username="${admin.username}" data-nombre="${admin.nombre}" data-foto="${admin.foto || ''}">
                        <img class="admin-foto" src="${fotoUrl}" onerror="this.src='${window.getPlaceholderImage(admin.nombre)}'">
                        <div class="admin-info">
                            <div class="admin-nombre">${admin.nombre}</div>
                            <div class="admin-username">@${admin.username}</div>
                        </div>
                    </div>
                `;
            }).join('');
            
            // Agregar evento click a cada tarjeta
            document.querySelectorAll('.admin-card').forEach(card => {
                card.addEventListener('click', async (e) => {
                    const id = card.dataset.id;
                    const username = card.dataset.username;
                    const nombre = card.dataset.nombre;
                    const foto = card.dataset.foto;
                    selectedAdmin = { id, username, nombre, foto };
                    // Mostrar panel de contraseña
                    document.getElementById('loginSelectorPanel').classList.add('hide');
                    document.getElementById('loginPasswordPanel').classList.add('show');
                    document.getElementById('selectedAdminFoto').src = foto || window.getPlaceholderImage(nombre);
                    document.getElementById('selectedAdminNombre').textContent = nombre;
                    // Limpiar campo contraseña
                    document.getElementById('adminPassword').value = '';
                    document.getElementById('adminPassword').focus();
                });
            });
        } catch (error) {
            console.error('Error cargando administradores:', error);
            container.innerHTML = '<p style="color:var(--danger);text-align:center">Error al cargar administradores. Recarga la página.</p>';
        }
    };

    window.hacerLogin = async function() {
        if (!selectedAdmin) {
            window.mostrarToast('Selecciona un administrador primero', 'error');
            return;
        }
        const password = document.getElementById('adminPassword').value;
        if (!password) { window.mostrarToast('Ingresa la contraseña', 'error'); return; }
        
        const loginBtn = document.querySelector('#loginForm button[type="submit"]');
        if (loginBtn) { loginBtn.disabled = true; loginBtn.innerHTML = '<i class="fas fa-spinner fa-spin"></i> Conectando...'; }
        
        try {
            // NOTA: La apikey se envía como parámetro URL Y header para mayor compatibilidad con Supabase Edge Functions
            const loginUrl = `https://iqwwoihiiyrtypyqzhgy.supabase.co/functions/v1/login?apikey=${encodeURIComponent(window.SUPABASE_ANON_KEY)}`;
            
            const response = await fetch(loginUrl, {
                method: 'POST',
                headers: { 
                    'Content-Type': 'application/json',
                    'Authorization': `Bearer ${window.SUPABASE_ANON_KEY}`,
                    'apikey': window.SUPABASE_ANON_KEY
                },
                body: JSON.stringify({ username: selectedAdmin.username, password: password })
            });
            const data = await response.json();
            if (!response.ok) throw new Error(data.error || `Error ${response.status}`);
            if (!data.success) { window.mostrarToast('❌ Contraseña incorrecta', 'error'); return; }
            if (data.user.rol !== 'admin') { window.mostrarToast('Acceso denegado. Se requiere rol de administrador.', 'error'); return; }
            
            // Verificar sesión duplicada
            const existingToken = sessionStorage.getItem('admin_jwt_token');
            if (existingToken && existingToken !== data.token) {
                const confirmForce = confirm('Ya hay una sesión de administrador activa en otro dispositivo. ¿Deseas cerrarla y continuar con esta?');
                if (!confirmForce) return;
                sessionStorage.removeItem('admin_authenticated');
                sessionStorage.removeItem('admin_jwt_token');
                sessionStorage.removeItem('admin_user');
            }
            
            window.isAdminAuthenticated = true;
            window.jwtToken = data.token;
            sessionStorage.setItem('admin_authenticated', 'true');
            sessionStorage.setItem('admin_jwt_token', window.jwtToken);
            sessionStorage.setItem('admin_user', JSON.stringify(data.user));
            
            // Guardar usuario actual en variable global
            window.usuarioActual = data.user;
            
            // Guardar este admin en recientes (con foto actualizada si la tiene)
            const adminUser = data.user;
            if (adminUser.foto === undefined && selectedAdmin.foto) adminUser.foto = selectedAdmin.foto;
            window.guardarAdminReciente(adminUser);
            
            window.supabaseClient = window.inicializarSupabaseCliente(window.jwtToken);
            
            document.getElementById('loginContainer').style.display = 'none';
            document.getElementById('panelContainer').classList.add('active');
            
            // Eliminar cualquier toast o mensaje de bienvenida previo para evitar bloqueos fantasma
            const existingToast = document.getElementById('toast');
            if (existingToast) {
                existingToast.classList.remove('show');
                setTimeout(() => {
                    if (existingToast.parentNode) existingToast.remove();
                }, 300);
            }
            
            // Mostrar mensaje de bienvenida con desvanecimiento y eliminación segura del DOM
            const welcomeDiv = document.createElement('div');
            welcomeDiv.id = 'welcomeMessage';
            welcomeDiv.style.cssText = 'position:fixed;top:20px;left:50%;transform:translateX(-50%);background:linear-gradient(135deg, var(--danger), #d32f2f);color:#fff;padding:1rem 2rem;border-radius:12px;box-shadow:0 8px 24px rgba(211,47,47,.4);z-index:9999;font-size:.95rem;font-weight:600;opacity:0;transition:opacity .4s ease;pointer-events:none';
            welcomeDiv.innerHTML = '<i class=\"fas fa-check-circle\" style=\"margin-right:.5rem\"></i>Bienvenido, <strong>' + (adminUser.nombre || 'Administrador') + '</strong>';
            document.body.appendChild(welcomeDiv);
            
            // Fade in
            setTimeout(() => { welcomeDiv.style.opacity = '1'; }, 50);
            
            // Fade out y eliminación del DOM después de 3.5 segundos
            setTimeout(() => {
                welcomeDiv.style.opacity = '0';
                setTimeout(() => {
                    if (welcomeDiv.parentNode) welcomeDiv.remove();
                }, 400); // Esperar a que termine la transición
            }, 3500);
            
            // Actualizar header con nombre del usuario en línea 1 (desktop) y línea 2 (móvil)
            const headerUsuarioNombreDesktop = document.getElementById('headerUsuarioNombreDesktop');
            const headerUsuarioNombreMobile = document.getElementById('headerUsuarioNombreMobile');
            if (adminUser.nombre) {
                if (headerUsuarioNombreDesktop) headerUsuarioNombreDesktop.textContent = adminUser.nombre;
                if (headerUsuarioNombreMobile) headerUsuarioNombreMobile.textContent = adminUser.nombre;
            }
            
            setTimeout(async () => {
                try {
                    // Sincronizar imágenes faltantes en ventas_detalle desde menu
                    await window.sincronizarImagenesVentasDetalle();
                    
                    // Cargar platillo estrella después de sincronizar imágenes
                    if (typeof window.cargarPlatilloEstrella === 'function') {
                        await window.cargarPlatilloEstrella();
                    }
                    
                    await window.cargarConfiguracionInicial();
                    await window.cargarMenu();
                    await window.cargarInventario();
                    await window.cargarUsuarios();
                    await window.cargarQRs();
                    await window.cargarReportes();
                    await window.cargarPedidosRecientes();
                    if (typeof window.cargarMesoneros === 'function') await window.cargarMesoneros();
                    if (typeof window.cargarDeliverys  === 'function') await window.cargarDeliverys();
                    if (typeof window.cargarPropinas   === 'function') await window.cargarPropinas();
                    window.setupEventListeners();
                    window.setupRealtimeSubscriptions();
                    window.setupStockRealtime();
                    window.restaurarWifiPersistente();
                    window._registrarPushAdmin();
                    window.agregarTarjetaDiferenciaTasa();
                    window._verificarTasaDeHoy((tasa) => {
                        const tasaInput = document.getElementById('tasaBaseInput');
                        if (tasaInput) tasaInput.value = tasa;
                        window.configGlobal.tasa_cambio = tasa;
                        window.recalcularTasaEfectiva();
                        // Actualizar tarjeta de diferencia de tasa después de cargar tasas
                        setTimeout(() => {
                            if (typeof window.actualizarTarjetaDiferenciaTasa === 'function') {
                                window.actualizarTarjetaDiferenciaTasa();
                            }
                        }, 500);
                        window._verificarAvisoLunes();
                    });
                    await window._actualizarVentasHoyNeto();
                    await window._actualizarDeliverysHoy();
                    setInterval(async () => { 
                        await window._actualizarVentasHoyNeto();
                        await window._actualizarDeliverysHoy();
                        window.actualizarTarjetaDiferenciaTasa();
                    }, 60000);
                } catch (e) { console.error('Error cargando datos:', e); window.mostrarToast('Error cargando datos: ' + e.message, 'error'); }
            }, 100);
        } catch (error) {
            console.error('❌ Error:', error);
            window.mostrarToast('❌ Error: ' + error.message, 'error');
        } finally {
            if (loginBtn) { loginBtn.disabled = false; loginBtn.innerHTML = 'Ingresar'; }
        }
    };

    window.restaurarSesionAdmin = async function() {
        const token = sessionStorage.getItem('admin_jwt_token');
        const userData = sessionStorage.getItem('admin_user');
        if (!token || !userData) return false;
        try {
            const user = JSON.parse(userData);
            if (user.rol !== 'admin') return false;
            
            // PRIMERO: Inicializar el cliente de Supabase con el token JWT antes de cualquier consulta
            window.jwtToken = token;
            window.isAdminAuthenticated = true;
            window.supabaseClient = window.inicializarSupabaseCliente(window.jwtToken);
            
            // SEGUNDO: Verificar token con Supabase usando el cliente ya inicializado con JWT
            const { error } = await window.supabaseClient.from('config').select('id').limit(1).maybeSingle();
            if (error && (error.message.includes('JWT') || error.code === 'PGRST301' || error.status === 401)) {
                console.warn('Token expirado o inválido, cerrando sesión');
                window.cerrarSesion();
                return false;
            }
            
            // TERCERO: Actualizar el nombre del usuario en el header
            const headerUsuarioNombreDesktop = document.getElementById('headerUsuarioNombreDesktop');
            const headerUsuarioNombreMobile = document.getElementById('headerUsuarioNombreMobile');
            if (user.nombre) {
                if (headerUsuarioNombreDesktop) headerUsuarioNombreDesktop.textContent = user.nombre;
                if (headerUsuarioNombreMobile) headerUsuarioNombreMobile.textContent = user.nombre;
            }
            
            // CUARTO: Cargar configuración inicial para obtener tasa de cambio y actualizar tarjeta de diferencia
            try {
                await window.cargarConfiguracionInicial();
                window._verificarTasaDeHoy((tasa) => {
                    const tasaInput = document.getElementById('tasaBaseInput');
                    if (tasaInput) tasaInput.value = tasa;
                    window.configGlobal.tasa_cambio = tasa;
                    window.recalcularTasaEfectiva();
                    // Actualizar tarjeta de diferencia de tasa después de cargar tasas
                    setTimeout(() => {
                        if (typeof window.actualizarTarjetaDiferenciaTasa === 'function') {
                            window.actualizarTarjetaDiferenciaTasa();
                        }
                    }, 500);
                });
            } catch (e) {
                console.error('Error cargando configuración al restaurar sesión:', e);
            }
            
            return true;
        } catch (e) {
            console.error('Error restaurando sesión:', e);
            window.cerrarSesion();
            return false;
        }
    };

    window.cerrarSesion = function() {
        sessionStorage.removeItem('admin_authenticated');
        sessionStorage.removeItem('admin_jwt_token');
        sessionStorage.removeItem('admin_user');
        window.isAdminAuthenticated = false;
        window.jwtToken = null;
        selectedAdmin = null;
        // Limpiar campo contraseña
        const pwdInput = document.getElementById('adminPassword');
        if (pwdInput) pwdInput.value = '';
        // Volver al selector de admins
        const selectorPanel = document.getElementById('loginSelectorPanel');
        const passwordPanel = document.getElementById('loginPasswordPanel');
        if (selectorPanel) {
            selectorPanel.classList.remove('hide');
            selectorPanel.style.display = 'block';
        }
        if (passwordPanel) {
            passwordPanel.classList.remove('show');
            passwordPanel.style.display = 'none';
        }
        window.mostrarLogin();
        window.mostrarToast('🔓 Sesión cerrada', 'info');
        window.supabaseClient = window.inicializarSupabaseCliente();
        // Recargar la lista de admins (por si cambió)
        setTimeout(() => window.cargarListaAdminsRecientes(), 500);
    };

    // Botón volver
    const backBtn = document.getElementById('backToSelectorBtn');
    if (backBtn) {
        backBtn.addEventListener('click', () => {
            document.getElementById('loginSelectorPanel').classList.remove('hide');
            document.getElementById('loginPasswordPanel').classList.remove('show');
            document.getElementById('loginPasswordPanel').style.display = 'none';
            document.getElementById('loginSelectorPanel').style.display = 'block';
            selectedAdmin = null;
        });
    }

    // Botón recuperar contraseña - ahora redirige con el usuario seleccionado
    const recoveryBtn = document.getElementById('recoveryLinkBtn');
    if (recoveryBtn) {
        recoveryBtn.addEventListener('click', () => {
            if (!selectedAdmin || !selectedAdmin.username) {
                window.mostrarToast('Primero selecciona un administrador', 'warning');
                return;
            }
            // Redirigir a la página de recuperación con el parámetro usuario
            window.location.href = `../recuperar-password.html?usuario=${encodeURIComponent(selectedAdmin.username)}`;
        });
    }

    // Botón limpiar historial
    const clearBtn = document.getElementById('clearRecentAdminsBtn');
    if (clearBtn) {
        clearBtn.addEventListener('click', () => {
            if (confirm('¿Borrar el historial de administradores recientes?')) {
                window.limpiarAdminsRecientes();
                window.cargarListaAdminsRecientes();
            }
        });
    }

    // Inicializar la lista al cargar la página (se llama desde DOMContentLoaded)
    window.iniciarLoginUI = async function() {
        // Esperar un poco para que supabaseClient se inicialice
        await new Promise(r => setTimeout(r, 300));
        await window.cargarListaAdminsRecientes();
    };
})();
