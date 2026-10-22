// admin-core.js - Variables globales y utilidades básicas
(function() {
    window.isAdminAuthenticated = false;
    window.jwtToken = null;
    window.menuItems = [];
    window.inventarioItems = [];
    window.usuarios = [];
    window.qrCodes = [];
    window.charts = {};
    window.platilloEditandoId = null;
    window.mesoneros = [];
    window.deliverys = [];
    window.deliveryEditandoId = null;
    window.deliveryParaPago = null;
    window.propinas = [];
    window.pedidos = [];
    
    // Usuario actual logueado (se inicializa desde sessionStorage al cargar)
    window.usuarioActual = null;
    try {
        const storedUser = sessionStorage.getItem('admin_user');
        if (storedUser) {
            window.usuarioActual = JSON.parse(storedUser);
        }
    } catch(e) {
        console.warn('No se pudo cargar usuarioActual de sessionStorage:', e);
    }
    
    window.wifiSsidPersistente = localStorage.getItem('saki_wifi_ssid') || '';
    window.wifiPasswordPersistente = localStorage.getItem('saki_wifi_pwd') || '';
    window.platillosNotificados = JSON.parse(localStorage.getItem('saki_platillos_notificados') || '{}');
    window.stockUpdateChannel = null;
    
    // ==================== FUNCIONES DE FORMATO Y UTILIDAD ====================
    window.formatBs = function(m) {
        if (m === undefined || m === null) m = 0;
        const valor = typeof m === 'number' ? m : parseFloat(m);
        if (isNaN(valor)) return 'Bs 0,00';
        const entero = Math.floor(Math.abs(valor)).toLocaleString('es-VE');
        const decimal = Math.round((Math.abs(valor) % 1) * 100).toString().padStart(2, '0');
        return (valor < 0 ? '-Bs ' : 'Bs ') + entero + ',' + decimal;
    };
    
    window.formatUSD = function(m) {
        try {
            return new Intl.NumberFormat('en-US', { style: 'currency', currency: 'USD', minimumFractionDigits: 2 }).format(m);
        } catch(e) {
            return '$ ' + (m || 0).toFixed(2);
        }
    };
    
    window.usdToBs = function(u) {
        return u * (window.configGlobal?.tasa_efectiva || 400);
    };
    
    window.generarId = function(prefix = '') {
        return `${prefix}${Date.now()}_${Math.random().toString(36).substring(2, 9)}`;
    };
    
    window.cerrarModal = function(modalId) {
        const modal = document.getElementById(modalId);
        if (modal) modal.classList.remove('active');
        if (modalId === 'ingredienteModal') {
            // La función resetearBloqueoStock fue eliminada, ya no es necesaria
        }
    };
    
    // ==================== TOAST (MENSAJES FLOTANTES) ====================
    window.mostrarToast = function(mensaje, tipo = 'info') {
        // Eliminar toast existente si hay alguno para evitar acumulación
        const existingToast = document.getElementById('toast');
        if (existingToast) {
            existingToast.classList.remove('show');
            // Esperar a que se oculte antes de remover del DOM
            setTimeout(() => {
                if (existingToast.parentNode) existingToast.remove();
            }, 100);
        }
        
        // Crear nuevo elemento toast si no existe
        let toast = document.getElementById('toast');
        if (!toast) {
            toast = document.createElement('div');
            toast.id = 'toast';
            document.body.appendChild(toast);
        }
        
        toast.textContent = mensaje;
        toast.className = `toast show ${tipo}`;
        setTimeout(() => {
            toast.classList.remove('show');
            // Remover completamente del DOM después de la animación
            setTimeout(() => {
                if (toast.parentNode) toast.remove();
            }, 300);
        }, 3000);
    };
    
    // ==================== VALIDACIÓN DE INPUTS ====================
    window.mostrarErrorInput = function(inputId, mensaje) {
        const input = document.getElementById(inputId);
        if (!input) return;
        
        // Remover error previo si existe
        const prevError = input.parentElement.querySelector('.input-error-message');
        if (prevError) prevError.remove();
        
        // Agregar clase de error al input
        input.classList.add('input-error');
        
        // Crear mensaje de error
        const errorDiv = document.createElement('div');
        errorDiv.className = 'input-error-message';
        errorDiv.textContent = mensaje;
        errorDiv.style.color = 'var(--danger)';
        errorDiv.style.fontSize = '0.75rem';
        errorDiv.style.marginTop = '0.25rem';
        
        input.parentElement.appendChild(errorDiv);
        
        // Scroll hacia el input con error
        input.scrollIntoView({ behavior: 'smooth', block: 'center' });
        input.focus();
    };
    
    window.limpiarErroresInput = function() {
        // Remover todas las clases de error
        document.querySelectorAll('.input-error').forEach(el => {
            el.classList.remove('input-error');
        });
        // Remover todos los mensajes de error
        document.querySelectorAll('.input-error-message').forEach(el => {
            el.remove();
        });
    };
    
    // ==================== CONTROL DE PANTALLAS ====================
    window.mostrarLogin = function() {
        const pwdInput = document.getElementById('adminPassword');
        if (pwdInput) pwdInput.value = '';
        document.getElementById('loginContainer').style.display = 'flex';
        document.getElementById('panelContainer').classList.remove('active');
        window.detenerAlarma();
    };
    
    window.mostrarPanel = function() {
        document.getElementById('loginContainer').style.display = 'none';
        document.getElementById('panelContainer').classList.add('active');
    };
    
    window.detenerAlarma = function() {
        if (window.alarmaAudio && window.alarmaActiva) {
            try { window.alarmaAudio.pause(); window.alarmaAudio.currentTime = 0; } catch(e) {}
            window.alarmaActiva = false;
        }
    };
    
    window.configGlobal = window.configGlobal || {};
    
    // ==================== DIFERENCIA DE TASA ====================
    window.calcularDiferenciaTasa = function() {
        // Ganancia extra en Bs = ventas_USD * (tasaEfectiva - tasaBase)
        // Ej: $50 ventas, tasa base 100, efectiva 120 → $50*(120-100) = Bs 1000 extra
        const tasaBase     = window.configGlobal?.tasa_cambio   || 400;
        const tasaEfectiva = window.configGlobal?.tasa_efectiva || 400;
        const diff = tasaEfectiva - tasaBase;
        if (diff <= 0) return 0;
        
        // Obtener fecha desde del selector de tcb-cards
        const aumentoDesdeInput = document.getElementById('aumentoDesde');
        const fechaDesde = aumentoDesdeInput && aumentoDesdeInput.value ? new Date(aumentoDesdeInput.value) : null;
        
        const fuente   = (window._ventasHoyNeto && window._ventasHoyNeto.pedidosData) || window.pedidos || [];
        const cobrados = fuente.filter(function(p) {
            if (!(p.estado==='cobrado' || p.estado==='entregado' ||
                   p.estado==='enviado' || p.estado==='reserva_completada')) {
                return false;
            }
            // Filtrar por fecha desde si está definida
            if (fechaDesde && !isNaN(fechaDesde.getTime())) {
                const fechaPedido = p.fecha ? new Date(p.fecha) : null;
                if (!fechaPedido || isNaN(fechaPedido.getTime())) {
                    return false;
                }
                // Comparar solo la parte de la fecha (día, mes, año)
                const fechaDesdeNormalizada = new Date(fechaDesde.getFullYear(), fechaDesde.getMonth(), fechaDesde.getDate());
                const fechaPedidoNormalizada = new Date(fechaPedido.getFullYear(), fechaPedido.getMonth(), fechaPedido.getDate());
                if (fechaPedidoNormalizada < fechaDesdeNormalizada) {
                    return false;
                }
            }
            return true;
        });
        const totalUSD = cobrados.reduce(function(s,p){ return s+(p.total||0); }, 0);
        return totalUSD * diff;
    };
    
    // ==================== GESTIÓN DE ADMINISTRADORES RECIENTES ====================
    window.obtenerAdminsRecientes = function() {
        const stored = localStorage.getItem('saki_recent_admins');
        if (!stored) return [];
        try {
            const admins = JSON.parse(stored);
            return admins.slice(0, 5);
        } catch(e) { return []; }
    };
    
    window.guardarAdminReciente = function(adminUser) {
        if (!adminUser || adminUser.rol !== 'admin') return;
        let recent = window.obtenerAdminsRecientes();
        recent = recent.filter(a => a.id !== adminUser.id);
        recent.unshift({
            id: adminUser.id,
            nombre: adminUser.nombre,
            username: adminUser.username,
            foto: adminUser.foto || null,
            lastLogin: new Date().toISOString()
        });
        recent = recent.slice(0, 5);
        localStorage.setItem('saki_recent_admins', JSON.stringify(recent));
    };
    
    window.limpiarAdminsRecientes = function() {
        localStorage.removeItem('saki_recent_admins');
    };
    
    // Placeholder para imágenes (SVG Data URI)
    window.getPlaceholderImage = function(text = 'Admin') {
        const initial = text.charAt(0).toUpperCase();
        return `data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' width='48' height='48' viewBox='0 0 48 48'%3E%3Crect width='48' height='48' fill='%23D32F2F'/%3E%3Ctext x='24' y='32' font-size='20' text-anchor='middle' fill='white' font-family='Arial'%3E${initial}%3C/text%3E%3C/svg%3E`;
    };
    
    // ==================== SINCRONIZACIÓN DE IMÁGENES EN VENTAS_DETALLE ====================
    // Esta función sincroniza las imágenes faltantes en ventas_detalle desde la tabla menu
    // Se ejecuta al iniciar sesión para asegurar que todos los registros tengan imagen
    window.sincronizarImagenesVentasDetalle = async function() {
        try {
            // Verificar que el cliente de Supabase tenga token JWT antes de ejecutar RPCs
            if (!window.jwtToken) {
                console.warn('⚠️ No hay token JWT, omitiendo sincronización de imágenes');
                return;
            }
            
            // Primero intentar con la función básica de sincronización
            const { data, error } = await window.supabaseClient.rpc('sincronizar_imagenes_ventas_detalle');
            
            if (error) {
                // Si es error 401 o de permisos, no intentar más RPCs
                if (error.status === 401 || error.code === 'PGRST301') {
                    console.warn('⚠️ Token expirado o sin permisos para RPC de sincronización');
                    return;
                }
                console.log('RPC sincronizar_imagenes_ventas_detalle no disponible:', error.message);
            } else {
                console.log('Sincronización básica completada:', data, 'registros actualizados');
            }
            
            // SIEMPRE ejecutar la sincronización forzada para corregir cualquier inconsistencia
            // Esto asegura que TODAS las imágenes se actualicen aunque ya tengan un valor
            const { data: dataForzada, error: errorForzado } = await window.supabaseClient.rpc('forzar_sincronizacion_imagenes');
            
            if (errorForzado) {
                // Si es error 401 o de permisos, usar método manual
                if (errorForzado.status === 401 || errorForzado.code === 'PGRST301') {
                    console.warn('⚠️ Token expirado o sin permisos para RPC forzado, usando método manual');
                    await window.sincronizarImagenesVentasDetalleManual();
                    return;
                }
                console.log('RPC forzar_sincronizacion_imagenes no disponible:', errorForzado.message);
                // Método alternativo si el RPC no existe
                await window.sincronizarImagenesVentasDetalleManual();
            } else {
                console.log('Sincronización forzada completada:', dataForzada, 'registros actualizados');
            }
        } catch (e) {
            // No mostrar error en consola si es un error 401 o de JWT (ya se manejó arriba)
            if (!(e.status === 401 || e.code === 'PGRST301' || (e.message && e.message.includes('JWT')))) {
                console.error('Error sincronizando imágenes:', e);
            }
            // Fallback al método manual en caso de error
            await window.sincronizarImagenesVentasDetalleManual();
        }
    };
    
    // Método manual de sincronización forzada (fallback)
    window.sincronizarImagenesVentasDetalleManual = async function() {
        try {
            console.log('Ejecutando sincronización manual de imágenes...');
            
            // Obtener todos los registros de ventas_detalle con platillo_id
            const { data: todasVentas, error: errorFetch } = await window.supabaseClient
                .from('ventas_detalle')
                .select('id, platillo_id, imagen')
                .not('platillo_id', 'is', null);
            
            if (errorFetch) throw errorFetch;
            
            if (todasVentas && todasVentas.length > 0) {
                let actualizados = 0;
                
                // Para cada registro, obtener la imagen del menú y actualizar si es diferente o null
                for (const venta of todasVentas) {
                    if (venta.platillo_id) {
                        const { data: menuData } = await window.supabaseClient
                            .from('menu')
                            .select('imagen')
                            .eq('id', venta.platillo_id)
                            .single();
                        
                        if (menuData && menuData.imagen) {
                            // Actualizar si la imagen es null o diferente a la del menú
                            if (!venta.imagen || venta.imagen !== menuData.imagen) {
                                await window.supabaseClient
                                    .from('ventas_detalle')
                                    .update({ imagen: menuData.imagen })
                                    .eq('id', venta.id);
                                actualizados++;
                            }
                        }
                    }
                }
                console.log(`Sincronización manual completada: ${actualizados} registros actualizados`);
            }
        } catch (e) {
            console.error('Error en sincronización manual:', e);
        }
    };
    
    // Alerta moderna y premium para confirmar eliminaciones
    window.mostrarConfirmacionPremium = function(titulo, mensaje, onConfirm) {
        // Crear overlay
        const overlay = document.createElement('div');
        overlay.style.cssText = 'position:fixed;top:0;left:0;right:0;bottom:0;background:rgba(0,0,0,.85);z-index:10001;display:flex;align-items:center;justify-content:center;padding:1rem;backdrop-filter:blur(5px)';
        overlay.innerHTML = `
            <div style="background:linear-gradient(145deg, #1a1a1a 0%, #0d0d0d 100%);border-radius:20px;max-width:420px;width:100%;box-shadow:0 25px 50px rgba(0,0,0,.5),0 0 0 1px rgba(255,255,255,.1);overflow:hidden;border:1px solid rgba(211,47,47,.3)">
                <div style="background:linear-gradient(135deg, #D32F2F 0%, #B71C1C 100%);padding:1.25rem 1.5rem;color:#fff;text-align:center;position:relative">
                    <div style="width:50px;height:50px;background:rgba(255,255,255,.2);border-radius:50%;display:flex;align-items:center;justify-content:center;margin:0 auto .75rem;font-size:1.5rem"><i class="fas fa-exclamation-triangle"></i></div>
                    <h3 style="margin:0;font-size:1.2rem;font-weight:700;text-shadow:0 2px 4px rgba(0,0,0,.3)">${titulo}</h3>
                </div>
                <div style="padding:1.75rem 1.5rem">
                    <p style="color:#e0e0e0;margin-bottom:1.75rem;font-size:.95rem;line-height:1.6;text-align:center">${mensaje}</p>
                    <div style="display:flex;gap:.75rem;justify-content:center">
                        <button type="button" id="confirmPremiumCancel" style="flex:1;max-width:140px;padding:.75rem 1rem;background:transparent;color:#ffffff;border:2px solid #FFB300;border-radius:12px;font-size:.9rem;font-weight:600;font-family:'Montserrat',sans-serif;cursor:pointer;transition:all 0.2s ease-in-out;box-shadow:0 4px 15px rgba(0,0,0,.3)">Cancelar</button>
                        <button type="button" id="confirmPremiumOk" style="flex:1;max-width:140px;padding:.75rem 1rem;background:linear-gradient(135deg, #D32F2F, #B71C1C);color:#ffffff;border:none;border-radius:12px;font-size:.9rem;font-weight:600;font-family:'Montserrat',sans-serif;cursor:pointer;transition:all 0.2s ease-in-out;box-shadow:0 4px 15px rgba(211,47,47,.4)">Confirmar</button>
                    </div>
                </div>
            </div>
        `;
        document.body.appendChild(overlay);
        const cancelBtn = overlay.querySelector('#confirmPremiumCancel');
        const okBtn = overlay.querySelector('#confirmPremiumOk');
        
        // Estilos hover para Cancelar
        cancelBtn.addEventListener('mouseenter', () => {
            cancelBtn.style.background = 'rgba(255, 179, 0, 0.1)';
            cancelBtn.style.transform = 'translateY(-2px) scale(1.02)';
            cancelBtn.style.boxShadow = '0 6px 20px rgba(255, 179, 0, 0.3)';
        });
        cancelBtn.addEventListener('mouseleave', () => {
            cancelBtn.style.background = 'transparent';
            cancelBtn.style.transform = 'translateY(0) scale(1)';
            cancelBtn.style.boxShadow = '0 4px 15px rgba(0,0,0,.3)';
        });
        
        // Estilos hover para Confirmar
        okBtn.addEventListener('mouseenter', () => {
            okBtn.style.transform = 'translateY(-2px) scale(1.02)';
            okBtn.style.boxShadow = '0 6px 20px rgba(211, 47, 47, 0.5)';
        });
        okBtn.addEventListener('mouseleave', () => {
            okBtn.style.transform = 'translateY(0) scale(1)';
            okBtn.style.boxShadow = '0 4px 15px rgba(211,47,47,.4)';
        });
        
        const cleanup = () => overlay.remove();
        cancelBtn.onclick = cleanup;
        okBtn.onclick = () => {
            cleanup();
            if (onConfirm) onConfirm();
        };
    };
})();
