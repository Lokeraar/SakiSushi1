// admin-helpers.js - Funciones auxiliares (no dependientes de otros módulos)
(function() {
    window.guardarWifiPersistente = function() {
        const ssid = document.getElementById('qrWifiSsid')?.value || '';
        const password = document.getElementById('qrWifiPassword')?.value || '';

        // El wifi vive en la tabla `config`, NO en localStorage.
        //
        // Antes se guardaba solo en localStorage, así que el QR salía con
        // wifi únicamente si se generaba en el mismo teléfono del admin.
        // Desde otra máquina salía sin wifi y nadie se enteraba.
        if (ssid !== window.wifiSsidPersistente || password !== window.wifiPasswordPersistente) {
            window.wifiSsidPersistente = ssid;
            window.wifiPasswordPersistente = password;
            window._guardarWifiEnBase(ssid, password);
        }
    };

    // Escritura en la base, con rebote para no disparar una consulta por
    // cada tecla que se escribe en el campo del wifi.
    var _wifiTimer = null;
    window._guardarWifiEnBase = function(ssid, password) {
        if (_wifiTimer) clearTimeout(_wifiTimer);
        _wifiTimer = setTimeout(async function() {
            if (!window.supabaseClient) return;
            try {
                const { data, error } = await window.supabaseClient
                    .from('config').select('id').limit(1);
                if (error) throw error;
                if (!data || data.length === 0) return;
                const { error: errUpd } = await window.supabaseClient
                    .from('config')
                    .update({ wifi_ssid: ssid, wifi_password: password })
                    .eq('id', data[0].id);
                if (errUpd) throw errUpd;
            } catch (e) {
                console.warn('[wifi] no se pudo guardar en la base:', e.message);
            }
        }, 900);
    };

    window.restaurarWifiPersistente = function() {
        const ssidInput = document.getElementById('qrWifiSsid');
        const passwordInput = document.getElementById('qrWifiPassword');
        if (ssidInput && window.wifiSsidPersistente) ssidInput.value = window.wifiSsidPersistente;
        if (passwordInput && window.wifiPasswordPersistente) passwordInput.value = window.wifiPasswordPersistente;
    };

    // Lee el wifi desde la base para que los campos muestren lo guardado
    // aunque el admin entre desde otro dispositivo.
    window.cargarWifiDesdeBase = async function() {
        if (!window.supabaseClient) return null;
        try {
            const { data, error } = await window.supabaseClient
                .from('config').select('wifi_ssid, wifi_password').limit(1);
            if (error) throw error;
            const c = data && data[0] ? data[0] : {};
            window.wifiSsidPersistente = c.wifi_ssid || '';
            window.wifiPasswordPersistente = c.wifi_password || '';
            window.restaurarWifiPersistente();
            return c;
        } catch (e) {
            console.warn('[wifi] no se pudo leer de la base:', e.message);
            return null;
        }
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

    // ── Ventana de tasa de hoy: RETIRADA ──
    //
    // Acá vivían `_pedirTasaDeHoy()` y `_verificarTasaDeHoy()`, que abrían una
    // ventana pidiendo que el admin ESCRIBIERA la tasa ("Ej: 42.50") y
    // guardaban el valor en localStorage.
    //
    // Se retiraron por tres motivos:
    //   1. Pedían un número que la base ya tiene: la tasa se captura del BCV
    //      con su fecha valor (migraciones 22 a 26).
    //   2. El ejemplo "42.50" era de hace meses. Con la tasa en 886, quien se
    //      guiara por el ejemplo cargaba un valor 20 veces menor.
    //   3. Era bloqueante: sin escribir un número, el admin no podía trabajar.
    //      La ventana nueva (assets/tasa-ventana.js) no bloquea: muestra la tasa
    //      capturada, ofrece "Mantener esta tasa: X", y si nadie decide, el
    //      sistema sigue cobrando con la última conocida.
    //
    // El relevo es `window.arrancarVentanaTasa()`.

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
