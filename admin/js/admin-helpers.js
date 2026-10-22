// admin-helpers.js - Funciones auxiliares (no dependientes de otros módulos)
(function() {
    window.guardarWifiPersistente = function() {
        const ssid = document.getElementById('qrWifiSsid')?.value || '';
        const password = document.getElementById('qrWifiPassword')?.value || '';
        
        if (ssid !== window.wifiSsidPersistente) {
            window.wifiSsidPersistente = ssid;
            localStorage.setItem('saki_wifi_ssid', ssid);
        }
        if (password !== window.wifiPasswordPersistente) {
            window.wifiPasswordPersistente = password;
            localStorage.setItem('saki_wifi_pwd', password);
        }
    };

    window.restaurarWifiPersistente = function() {
        const ssidInput = document.getElementById('qrWifiSsid');
        const passwordInput = document.getElementById('qrWifiPassword');
        if (ssidInput && window.wifiSsidPersistente) ssidInput.value = window.wifiSsidPersistente;
        if (passwordInput && window.wifiPasswordPersistente) passwordInput.value = window.wifiPasswordPersistente;
    };

    window._convertirUnidad = function(valor, desde, hacia) {
        if (!desde || !hacia || desde === hacia) return valor;
        let base = valor;
        if (desde === 'kilogramos') base = valor * 1000;
        else if (desde === 'litros') base = valor * 1000;
        if (hacia === 'kilogramos') return base / 1000;
        if (hacia === 'litros')     return base / 1000;
        return base;
    };

    window._pedirTasaDeHoy = function(onConfirm) {
        const overlay = document.createElement('div');
        overlay.id = 'tasaHoyOverlay';
        overlay.style.cssText = [
            'position:fixed','top:0','left:0','width:100%','height:100%',
            'background:rgba(0,0,0,.85)','z-index:9999',
            'display:flex','align-items:center','justify-content:center',
            'font-family:Montserrat,sans-serif'
        ].join(';');
        overlay.innerHTML = `
            <div style="background:#fff;border-radius:16px;padding:2rem 2.5rem;width:90%;max-width:400px;box-shadow:0 8px 32px rgba(0,0,0,.3);text-align:center">
                <div style="font-size:2.5rem;margin-bottom:.75rem">💱</div>
                <h2 style="font-size:1.3rem;color:#1a1a2e;margin-bottom:.4rem">Tasa de cambio de hoy</h2>
                <p style="font-size:.88rem;color:#666;margin-bottom:1.5rem">
                    Ingresa el valor actual del dólar en bolívares para que el sistema calcule correctamente todos los precios de hoy.
                </p>
                <input type="number" id="tasaHoyInput" placeholder="Ej: 42.50"
                    step="0.01" min="1"
                    style="width:100%;padding:.8rem 1rem;font-size:1.1rem;font-weight:700;text-align:center;
                           border:2px solid #e0e0e0;border-radius:10px;outline:none;
                           font-family:Montserrat,sans-serif;margin-bottom:1rem;box-sizing:border-box">
                <div id="tasaHoyError" style="color:#D32F2F;font-size:.82rem;margin-bottom:.75rem;display:none">
                    Por favor ingresa un valor válido mayor a 0.
                </div>
                <button id="tasaHoyBtn"
                    style="width:100%;padding:.9rem;background:linear-gradient(135deg,#D32F2F,#B71C1C);
                           color:#fff;border:none;border-radius:10px;font-size:1rem;font-weight:700;
                           cursor:pointer;font-family:Montserrat,sans-serif;letter-spacing:.5px">
                    Confirmar tasa de hoy
                </button>
                <p style="font-size:.75rem;color:#999;margin-top:.75rem">
                    Podrás ajustarla en cualquier momento desde la barra de tasa.
                </p>
            </div>
        `;
        document.body.appendChild(overlay);

        setTimeout(() => {
            const input = document.getElementById('tasaHoyInput');
            if (input) input.focus();
        }, 100);

        const confirmar = () => {
            const val = parseFloat(document.getElementById('tasaHoyInput').value);
            const errEl = document.getElementById('tasaHoyError');
            if (!val || val <= 0) {
                errEl.style.display = 'block';
                document.getElementById('tasaHoyInput').focus();
                return;
            }
            errEl.style.display = 'none';
            const hoy = new Date().toISOString().split('T')[0];
            localStorage.setItem('saki_tasa_fecha', hoy);
            localStorage.setItem('saki_tasa_valor', val);
            overlay.remove();
            onConfirm(val);
        };

        document.getElementById('tasaHoyBtn').addEventListener('click', confirmar);
        document.getElementById('tasaHoyInput').addEventListener('keydown', e => {
            if (e.key === 'Enter') confirmar();
        });
    };

    window._verificarTasaDeHoy = function(onReady) {
        const hoy  = new Date().toISOString().split('T')[0];
        const fecha = localStorage.getItem('saki_tasa_fecha');
        const valor = parseFloat(localStorage.getItem('saki_tasa_valor'));

        if (fecha === hoy && valor > 0) {
            onReady(valor);
        } else {
            window._pedirTasaDeHoy((val) => {
                onReady(val);
            });
        }
    };

    window._verificarAvisoLunes = function() {
        if (!window.configGlobal || !window.configGlobal.aumento_semanal) return;

        const hoy = new Date();
        if (hoy.getDay() !== 1) return;

        const claveAviso = 'saki_aviso_lunes_' + hoy.toISOString().split('T')[0];
        if (localStorage.getItem(claveAviso)) return;
        localStorage.setItem(claveAviso, '1');

        const notif = document.createElement('div');
        notif.style.cssText = [
            'position:fixed','top:1.5rem','left:50%','transform:translateX(-50%)',
            'background:#1a1a2e','color:#fff','border-radius:12px',
            'padding:1.2rem 1.5rem','z-index:8000','box-shadow:0 4px 20px rgba(0,0,0,.4)',
            'max-width:420px','width:90%','font-family:Montserrat,sans-serif',
            'border-left:4px solid #FF9800'
        ].join(';');
        notif.innerHTML = `
            <div style="display:flex;align-items:flex-start;gap:.75rem">
                <div style="font-size:1.5rem;flex-shrink:0">📅</div>
                <div style="flex:1">
                    <div style="font-weight:700;margin-bottom:.3rem;font-size:.95rem">Nueva semana — ¿Actualizas el porcentaje?</div>
                    <div style="font-size:.82rem;opacity:.85;margin-bottom:.75rem">
                        Hoy es lunes y tienes activo el aumento semanal.
                        ¿Quieres ajustar el porcentaje de aumento para esta semana?
                    </div>
                    <div style="display:flex;gap:.5rem;justify-content:flex-end">
                        <button id="avisoLunesNo"
                            style="padding:.4rem .9rem;background:rgba(255,255,255,.15);color:#fff;
                                   border:1px solid rgba(255,255,255,.3);border-radius:6px;
                                   cursor:pointer;font-family:Montserrat,sans-serif;font-size:.82rem">
                            No, dejarlo igual
                        </button>
                        <button id="avisoLunesSi"
                            style="padding:.4rem .9rem;background:#FF9800;color:#1a1a2e;border:none;
                                   border-radius:6px;cursor:pointer;font-family:Montserrat,sans-serif;
                                   font-weight:700;font-size:.82rem">
                            Sí, cambiar %
                        </button>
                    </div>
                </div>
            </div>
        `;
        document.body.appendChild(notif);

        document.getElementById('avisoLunesNo').addEventListener('click', () => notif.remove());
        document.getElementById('avisoLunesSi').addEventListener('click', () => {
            notif.remove();
            window.scrollTo({ top: 0, behavior: 'smooth' });
            const input = document.getElementById('aumentoDiarioInput');
            if (input) {
                input.focus();
                input.select();
                input.style.outline = '3px solid #FF9800';
                setTimeout(() => { input.style.outline = ''; }, 3000);
            }
        });

        setTimeout(() => { if (notif.parentNode) notif.remove(); }, 30000);
    };

    window._simularLunes = function() {
        console.log('%c📅 Simulando lunes para prueba de aviso semanal...', 'color:#FF9800;font-weight:700');
        const hoy = new Date().toISOString().split('T')[0];
        localStorage.removeItem('saki_aviso_lunes_' + hoy);
        const estadoOriginal = window.configGlobal?.aumento_semanal;
        if (window.configGlobal) window.configGlobal.aumento_semanal = true;
        const _orig = Date.prototype.getDay;
        Date.prototype.getDay = function() { return 1; };
        window._verificarAvisoLunes();
        Date.prototype.getDay = _orig;
        if (window.configGlobal && estadoOriginal !== undefined)
            window.configGlobal.aumento_semanal = estadoOriginal;
        console.log('%c✅ Aviso de lunes disparado. Mira la pantalla.', 'color:green;font-weight:700');
    };

    window._simularPeriodoSemanal = function(semanas) {
        semanas = semanas || 1;
        const input = document.getElementById('aumentoDiarioInput');
        const pct = parseFloat(input?.value) || 0;
        const base = parseFloat(document.getElementById('tasaBaseInput')?.value) || 0;
        const acum = semanas * pct;
        const efectiva = base * (1 + acum / 100);
        console.group('%c📊 Simulación: ' + semanas + ' semana(s) de aumento semanal', 'color:#FF9800;font-weight:700');
        console.log('Tasa base:', base);
        console.log('% por semana:', pct + '%');
        console.log('Semanas simuladas:', semanas);
        console.log('Acumulado simulado:', acum.toFixed(2) + '%');
        console.log('Tasa efectiva simulada: Bs', efectiva.toFixed(2));
        console.log('Diferencia vs actual: Bs', (efectiva - (window.configGlobal?.tasa_efectiva || base)).toFixed(2));
        console.groupEnd();
        console.log('%c💡 Tip: prueba window._simularPeriodoSemanal(3) para 3 semanas', 'color:gray');
    };
})();
