// admin-ui.js - UI genérica: tabs, modales, eventos, helpers visuales
(function() {
    window.irADeliverys = function() {
        var tabs = document.querySelectorAll('.tab');
        var panes = document.querySelectorAll('.tab-pane');
        tabs.forEach(function(t){ t.classList.remove('active'); });
        panes.forEach(function(p){ p.classList.remove('active'); });
        var t = document.querySelector('.tab[data-tab="deliverys"]');
        var p = document.getElementById('deliverysPane');
        if (t) t.classList.add('active');
        if (p) { p.classList.add('active'); p.scrollIntoView({behavior:'smooth',block:'start'}); }
    };
    window.irAMenu = function() {
        var tabs = document.querySelectorAll('.tab');
        var panes = document.querySelectorAll('.tab-pane');
        tabs.forEach(function(t){ t.classList.remove('active'); });
        panes.forEach(function(p){ p.classList.remove('active'); });
        var t = document.querySelector('.tab[data-tab="menu"]');
        var p = document.getElementById('menuPane');
        if (t) t.classList.add('active');
        if (p) { p.classList.add('active'); p.scrollIntoView({behavior:'smooth',block:'start'}); }
    };
    window.irAStockCritico = function() {
        var tabs = document.querySelectorAll('.tab');
        var panes = document.querySelectorAll('.tab-pane');
        tabs.forEach(function(t){ t.classList.remove('active'); });
        panes.forEach(function(p){ p.classList.remove('active'); });
        var t = document.querySelector('.tab[data-tab="dashboard"]');
        var p = document.getElementById('dashboardPane');
        if (t) t.classList.add('active');
        if (p) p.classList.add('active');
        setTimeout(function(){
            var el = document.getElementById('stockCritico'); if (!el) return;
            el.scrollIntoView({behavior:'smooth',block:'center'});
            var par = el.closest('.lower-stock') || el.parentElement;
            if (par) {
                var n = 0;
                var iv = setInterval(function(){
                    n++;
                    par.style.boxShadow = n%2===0 ? '0 0 0 3px #FFC107,0 0 20px rgba(255,193,7,.4)' : 'none';
                    par.style.borderColor = n%2===0 ? '#FFC107' : '';
                    if (n >= 6) { clearInterval(iv); par.style.boxShadow=''; par.style.borderColor=''; }
                }, 300);
            }
        }, 150);
    };
    window._irAMesoneros = function() {
        var tabs = document.querySelectorAll('.tab');
        var panes = document.querySelectorAll('.tab-pane');
        tabs.forEach(function(t){ t.classList.remove('active'); });
        panes.forEach(function(p){ p.classList.remove('active'); });
        var t = document.querySelector('.tab[data-tab="mesoneros"]');
        var p = document.getElementById('mesonerosPane');
        if (t) t.classList.add('active');
        if (p) { p.classList.add('active'); p.scrollIntoView({behavior:'smooth',block:'start'}); }
    };
        window.setupEventListeners = function() {
        // Funciones de scroll para tabs con doble chevron
        window._scrollTabs = function(dir) {
            const c = document.getElementById('tabsContainer');
            if (!c) return;
            c.scrollBy({ left: dir * 180, behavior: 'smooth' });
            setTimeout(window._updateTabChevrons, 200);
        };
        window._updateTabChevrons = function() {
            const c = document.getElementById('tabsContainer');
            const lBtn = document.getElementById('tabsChevronLeft');
            const rBtn = document.getElementById('tabsChevronRight');
            if (!c || !lBtn || !rBtn) return;
            lBtn.style.opacity = c.scrollLeft > 4 ? '1' : '0.3';
            lBtn.style.pointerEvents = c.scrollLeft > 4 ? 'auto' : 'none';
            const atEnd = c.scrollLeft + c.clientWidth >= c.scrollWidth - 4;
            rBtn.style.opacity = atEnd ? '0.3' : '1';
            rBtn.style.pointerEvents = atEnd ? 'none' : 'auto';
        };
        document.getElementById('tabsContainer')?.addEventListener('scroll', window._updateTabChevrons);
        window._updateTabChevrons();

        // Checkbox de disponible en modal platillo
        document.getElementById('platilloDisponibleCheck')?.addEventListener('change', function() {
            const lbl = document.getElementById('platilloDisponibleLabel');
            const sel = document.getElementById('platilloDisponible');
            if (lbl) { lbl.textContent = this.checked ? 'Sí' : 'No'; lbl.style.color = this.checked ? 'var(--success)' : 'var(--text-muted)'; }
            if (sel) sel.value = this.checked ? 'true' : 'false';
        });

        // Navegación por tabs
        document.querySelectorAll('.tab').forEach(tab => {
            tab.addEventListener('click', () => {
                const target = tab.dataset.tab;
                document.querySelectorAll('.tab').forEach(t => t.classList.remove('active'));
                tab.classList.add('active');
                document.querySelectorAll('.tab-pane').forEach(pane => pane.classList.remove('active'));
                const pane = document.getElementById(target + 'Pane');
                if (pane) pane.classList.add('active');
                if (target !== 'qr') {
                    const el = document.getElementById('qrNombreMesa');
                    if (el) el.value = '';
                }
            });
        });

        // Cerrar modales al hacer clic fuera
        document.querySelectorAll('.modal').forEach(modal => {
            modal.addEventListener('click', function(e) {
                if (e.target === this) {
                    window.cerrarModal(this.id);
                }
            });
        });

        // Guardar configuración de tasa
        document.getElementById('saveAllButton').addEventListener('click', async () => { await window.guardarConfiguracion(); });
        document.getElementById('tasaBaseInput').addEventListener('change', window.recalcularTasaEfectiva);
        document.getElementById('aumentoDiarioInput').addEventListener('change', window.recalcularTasaEfectiva);
        
        function _mostrarFechasAumento(visible) {
            document.getElementById('tasaFechasDiv').style.display = visible ? 'flex' : 'none';
        }
        function _actualizarLabelAumento() {
            const diario   = document.getElementById('aumentoActivoToggle').checked;
            const semanal  = document.getElementById('aumentoSemanalToggle').checked;
            const alguno   = diario || semanal;
            const label = document.getElementById('labelAumentoPct');
            if (label) label.textContent = semanal ? 'Aumento Semanal %:' : 'Aumento Diario %:';
            const inputPct = document.getElementById('aumentoDiarioInput');
            if (inputPct) {
                inputPct.disabled = !alguno;
                inputPct.style.opacity = alguno ? '1' : '0.4';
                inputPct.style.cursor  = alguno ? '' : 'not-allowed';
            }
            _mostrarFechasAumento(alguno);
            if (alguno && !document.getElementById('aumentoDesde').value) {
                document.getElementById('aumentoDesde').value = new Date().toISOString().split('T')[0];
            }
        }
        document.getElementById('aumentoActivoToggle').addEventListener('change', function() {
            if (this.checked) document.getElementById('aumentoSemanalToggle').checked = false;
            window.configGlobal.aumento_detenido = !this.checked;
            _actualizarLabelAumento();
            window.recalcularTasaEfectiva();
        });
        document.getElementById('aumentoSemanalToggle').addEventListener('change', function() {
            if (this.checked) document.getElementById('aumentoActivoToggle').checked = false;
            window.configGlobal.aumento_detenido = !this.checked;
            _actualizarLabelAumento();
            window.recalcularTasaEfectiva();
        });
        document.getElementById('aumentoIndefinido').addEventListener('change', function() {
            document.getElementById('aumentoHasta').disabled = this.checked;
            if (this.checked) document.getElementById('aumentoHasta').value = '';
        });
        // Actualizar tarjeta de diferencia de tasa cuando cambie la fecha "Desde"
        const aumentoDesdeInput = document.getElementById('aumentoDesde');
        if (aumentoDesdeInput) {
            aumentoDesdeInput.addEventListener('change', function() {
                window.actualizarTarjetaDiferenciaTasa();
            });
        }

        // Modales QR
        const _closeQrBtn  = document.getElementById('closeQrAmpliado');
        const _closeQrX    = document.getElementById('closeQrAmpliadoModal');
        const _qrModal     = document.getElementById('qrAmpliadoModal');
        if (_closeQrBtn) _closeQrBtn.addEventListener('click', () => window.cerrarModal('qrAmpliadoModal'));
        if (_closeQrX)   _closeQrX.addEventListener('click',   () => window.cerrarModal('qrAmpliadoModal'));
        if (_qrModal) _qrModal.addEventListener('click', function(e) {
            if (e.target === this) window.cerrarModal('qrAmpliadoModal');
        });

        // Botón logout (desktop y móvil) - con aviso de confirmación
        const btnDesktop = document.getElementById('logoutButtonDesktop');
        const btnMobile = document.getElementById('logoutButtonMobile');
        const salidaAviso = document.getElementById('_salidaAviso');
        const salidaNo = document.getElementById('_salidaNo');
        const salidaSi = document.getElementById('_salidaSi');
        
        const mostrarAvisoSalida = () => {
            if (salidaAviso) salidaAviso.style.display = 'flex';
        };
        
        const ocultarAvisoSalida = () => {
            if (salidaAviso) salidaAviso.style.display = 'none';
        };
        
        const ejecutarCerrarSesion = () => {
            if (typeof window.cerrarSesion === 'function') window.cerrarSesion();
            else { sessionStorage.clear(); window.location.reload(); }
        };
        
        if (btnDesktop) btnDesktop.addEventListener('click', mostrarAvisoSalida);
        if (btnMobile) btnMobile.addEventListener('click', mostrarAvisoSalida);
        if (salidaNo) salidaNo.addEventListener('click', ocultarAvisoSalida);
        if (salidaSi) salidaSi.addEventListener('click', () => {
            ocultarAvisoSalida();
            ejecutarCerrarSesion();
        });
    };

    // ==================== INICIALIZACIÓN AL CARGAR LA PÁGINA ====================
    document.addEventListener('DOMContentLoaded', async () => {
        // Inicializar UI de login (cargar lista de administradores)
		window.iniciarLoginUI();
        
        // Inicializar tema antes de mostrar cualquier cosa
        window.initTheme();
        
        if (await window.restaurarSesionAdmin()) {
            window.mostrarPanel();
            // Actualizar header con nombre de usuario (ya se hace en setupHeaderUsuario)
            setTimeout(async () => {
                try {
                    // Sincronizar imágenes faltantes en ventas_detalle desde menu
                    await window.sincronizarImagenesVentasDetalle();
                    
                    // Cargar platillo estrella después de sincronizar imágenes
                    if (typeof window.cargarPlatilloEstrella === 'function') {
                        await window.cargarPlatilloEstrella();
                    }
                    
                    // La configuración y tasas ya se cargaron en restaurarSesionAdmin
                    
                    await window.cargarMenu();
                    await window.cargarInventario();
                    await window.cargarUsuarios();
                    await window.cargarQRs();
                    await window.cargarReportes();
                    await window.cargarPedidosRecientes();
                    await window.cargarMesoneros();
                    await window.cargarDeliverys();
                    await window.cargarPropinas();
                    window.setupEventListeners();
                    window.setupRealtimeSubscriptions();
                    window.setupStockRealtime();
                    window.restaurarWifiPersistente();
                    window._registrarPushAdmin();
                    
                    // Agregar tarjeta de diferencia de tasa al dashboard
                    window.agregarTarjetaDiferenciaTasa();
                    
                    window._verificarAvisoLunes();
                    
                    await window._actualizarVentasHoyNeto();
                    await window._actualizarDeliverysHoy();
                    window.actualizarTarjetaDiferenciaTasa();
                    setInterval(async () => { 
                        await window._actualizarVentasHoyNeto();
                        await window._actualizarDeliverysHoy();
                        window.actualizarTarjetaDiferenciaTasa();
                    }, 60000);
                } catch (e) { 
                    console.error('Error cargando datos:', e); 
                    window.mostrarToast('Error cargando datos: ' + e.message, 'error'); 
                }
            }, 100);
        } else {
            window.mostrarLogin();
        }
    });

    // Función para agregar tarjeta de diferencia de tasa al dashboard
    window.agregarTarjetaDiferenciaTasa = function() {
        const dashboardGrid = document.querySelector('.dashboard-grid');
        if (!dashboardGrid) return;
        // Verificar si ya existe
        if (document.getElementById('diferenciaTasaCard')) return;
        const card = document.createElement('div');
        card.className = 'dashboard-card';
        card.id = 'diferenciaTasaCard';
        card.style.cursor = 'pointer';
        card.onclick = () => window.mostrarToast('Diferencia acumulada a favor del restaurante por aumento de tasa', 'info');
        card.innerHTML = `
            <div class="card-title">
                Acumulado Dif. Tasa Base y Efectiva 
                <span class="tooltip-wrap" style="position:relative; display:inline-flex; cursor:help; margin-left:.3rem" onmouseenter="this.querySelector('.tooltip-text').style.display='block'" onmouseleave="this.querySelector('.tooltip-text').style.display='none'">
                    <span style="display:inline-flex; align-items:center; justify-content:center; width:16px; height:16px; background:#aaa; color:#fff; border-radius:50%; font-size:.65rem; font-weight:700">?</span>
                    <span class="tooltip-text" style="display:none; position:absolute; bottom:calc(100% + 6px); left:50%; transform:translateX(-50%); background:var(--toast-bg); color:var(--toast-text); padding:.5rem .75rem; border-radius:8px; font-size:.75rem; white-space:normal; width:250px; text-align:center; box-shadow:0 4px 12px rgba(0,0,0,.3); z-index:100; line-height:1.4">
                        Es la ganancia extra generada por la diferencia entre la tasa base y la tasa efectiva aplicada a los pedidos cobrados. Esta diferencia queda a favor del restaurante.
                    </span>
                </span>
            </div>
            <div class="card-value" id="diferenciaTasaValor">Bs 0,00</div>
        `;
        // Insertar como cuarta tarjeta (después de Deliverys Hoy)
        const deliverysCard = document.getElementById('deliverysHoyCard');
        if (deliverysCard && deliverysCard.parentNode) {
            deliverysCard.parentNode.insertBefore(card, deliverysCard.nextSibling);
        } else {
            dashboardGrid.appendChild(card);
        }
        window.actualizarTarjetaDiferenciaTasa();
    };

    window.actualizarTarjetaDiferenciaTasa = function() {
        const diff = window.calcularDiferenciaTasa();
        const valorEl = document.getElementById('diferenciaTasaValor');
        if (valorEl) valorEl.textContent = 'Bs ' + diff.toFixed(2);
    };

    // ==================== SISTEMA DE TEMAS PREMIUM ====================
    
    // Inicializar tema al cargar
    window.initTheme = function() {
        const savedTheme = localStorage.getItem('sakiSushiTheme');
        const prefersDark = window.matchMedia('(prefers-color-scheme: dark)').matches;
        
        if (savedTheme === 'dark' || (!savedTheme && prefersDark)) {
            document.documentElement.classList.add('dark-theme');
        } else {
            document.documentElement.classList.remove('dark-theme');
        }
        
        // Configurar event listener del toggle (desktop y móvil)
        const themeToggle = document.getElementById('themeToggle');
        const themeToggleMobile = document.getElementById('themeToggleMobile');
        [themeToggle, themeToggleMobile].forEach(toggle => {
            if (toggle) {
                toggle.checked = document.documentElement.classList.contains('dark-theme');
                toggle.addEventListener('change', window.toggleTheme);
            }
        });
    };

    // Cambiar tema con animación de partículas (sincronizar ambos toggles)
    window.toggleTheme = function(e) {
        const isDark = e.target.checked;
        const html = document.documentElement;
        
        // Sincronizar ambos toggles (desktop y móvil)
        const themeToggle = document.getElementById('themeToggle');
        const themeToggleMobile = document.getElementById('themeToggleMobile');
        if (themeToggle && themeToggle !== e.target) themeToggle.checked = isDark;
        if (themeToggleMobile && themeToggleMobile !== e.target) themeToggleMobile.checked = isDark;
        
        // Crear efecto de partículas
        window.createThemeParticles(e.target);
        
        // Aplicar tema
        if (isDark) {
            html.classList.add('dark-theme');
        } else {
            html.classList.remove('dark-theme');
        }
        
        // Guardar preferencia
        localStorage.setItem('sakiSushiTheme', isDark ? 'dark' : 'light');
    };

    // Efecto de partículas al cambiar tema
    window.createThemeParticles = function(element) {
        const rect = element.getBoundingClientRect();
        const colors = ['#D32F2F', '#FF7043', '#FFB300', '#9FA8DA', '#5C6BC0'];
        
        for (let i = 0; i < 12; i++) {
            setTimeout(() => {
                const particle = document.createElement('div');
                particle.className = 'theme-particle';
                particle.style.left = (rect.left + rect.width / 2) + 'px';
                particle.style.top = (rect.top + rect.height / 2) + 'px';
                particle.style.background = colors[Math.floor(Math.random() * colors.length)];
                
                // Dirección aleatoria
                const angle = (Math.PI * 2 * i) / 12;
                const distance = 60 + Math.random() * 40;
                const tx = Math.cos(angle) * distance;
                const ty = Math.sin(angle) * distance;
                
                particle.style.transform = `translate(${tx}px, ${ty}px)`;
                document.body.appendChild(particle);
                
                // Limpiar partícula después de la animación
                setTimeout(() => particle.remove(), 600);
            }, i * 30);
        }
    };
})();