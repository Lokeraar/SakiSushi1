// admin-qr.js - Gestión de códigos QR (versión limpia)
(function() {
    window.cargarQRs = async function() {
        try {
            const { data, error } = await window.supabaseClient.from('codigos_qr').select('*').order('fecha', { ascending: false });
            if (error) throw error;
            window.qrCodes = data || [];
            window.renderizarQRs();
            const _ssid = localStorage.getItem('saki_wifi_ssid');
            const _pwd  = localStorage.getItem('saki_wifi_pwd');
            if (_ssid) { const el = document.getElementById('qrWifiSsid'); if (el) el.value = _ssid; }
            if (_pwd)  { const el = document.getElementById('qrWifiPassword'); if (el) el.value = _pwd; }
        } catch (e) { console.error('Error cargando QRs:', e); window.mostrarToast('Error cargando QRs', 'error'); }
    };

    window.renderizarQRs = function() {
        const grid = document.getElementById('qrGrid');
        if (!grid) return;
        grid.innerHTML = '';
        const _ssid = localStorage.getItem('saki_wifi_ssid') || '';
        const _pwd  = localStorage.getItem('saki_wifi_pwd') || '';
        (window.qrCodes || []).forEach(qr => {
            const params = new URLSearchParams({ mesa: qr.nombre });
            if (_ssid) params.set('wifi_ssid', _ssid);
            if (_pwd)  params.set('wifi_pwd', _pwd);
            const qrText = window.location.origin + '/Cliente/index.html?' + params.toString();
            const qrId   = 'qr-' + qr.id;
            const card = document.createElement('div');
            card.className = 'qr-card-v2';
            card.title = 'Toca para ampliar';
            card.style.cursor = 'pointer';
            const qrDiv = document.createElement('div');
            qrDiv.id = qrId;
            qrDiv.className = 'qr-img-box';
            const nombre = document.createElement('div');
            nombre.className = 'qr-nombre-v2';
            nombre.textContent = (_ssid ? '📶 ' : '') + qr.nombre;
            const btnDel = document.createElement('button');
            btnDel.className = 'btn-icon delete qr-del-btn';
            btnDel.title = 'Eliminar QR';
            btnDel.innerHTML = '<i class="fas fa-trash"></i>';
            btnDel.addEventListener('click', function(e) { e.stopPropagation(); window.eliminarQR(qr.id); });
            card.appendChild(qrDiv);
            card.appendChild(nombre);
            card.appendChild(btnDel);
            card.addEventListener('click', function() { window.ampliarQR(qr.id, qr.nombre, qrText); });
            grid.appendChild(card);
            new QRCode(document.getElementById(qrId), { text: qrText, width: 140, height: 140 });
        });
    };

    window.generarQR = async function() {
        const nombre   = document.getElementById('qrNombreMesa').value.trim();
        const ssidEl   = document.getElementById('qrWifiSsid');
        const pwdEl    = document.getElementById('qrWifiPassword');
        const ssid     = ssidEl ? ssidEl.value.trim() : '';
        const password = pwdEl  ? pwdEl.value.trim()  : '';
        window.guardarWifiPersistente();
        if (!nombre) { window.mostrarToast('Ingresa el nombre de la mesa', 'error'); return; }
        if (ssid && !password) { window.mostrarToast('Ingresa la contraseña WiFi', 'error'); return; }
        const qrData = { id: window.generarId('QR_'), nombre: nombre, fecha: new Date().toISOString() };
        try {
            const { error } = await window.supabaseClient.from('codigos_qr').insert([qrData]);
            if (error) throw error;
            document.getElementById('qrNombreMesa').value = '';
            await window.cargarQRs();
            window.mostrarToast('✅ QR generado', 'success');
        } catch(e) { console.error('Error generando QR:', e); window.mostrarToast('❌ Error al generar QR: ' + (e.message || e), 'error'); }
    };

    window.eliminarQR = async function(id) {
        window.mostrarConfirmacionPremium(
            'Eliminar QR',
            '¿Estás seguro de eliminar este código QR?',
            async () => {
                try {
                    await window.supabaseClient.from('codigos_qr').delete().eq('id', id);
                    await window.cargarQRs();
                    window.mostrarToast('🗑️ QR eliminado', 'success');
                } catch (e) { console.error('Error eliminando QR:', e); window.mostrarToast('❌ Error al eliminar QR', 'error'); }
            }
        );
    };

    window.ampliarQR = function(id, nombre, url) {
        const container = document.getElementById('qrAmpliado');
        container.innerHTML = '';
        new QRCode(container, { text: url, width: 300, height: 300 });
        const urlDisplay = url.replace(/wifi_pwd=([^&]+)/, 'wifi_pwd=***');
        document.getElementById('qrAmpliadoInfo').innerHTML = `
            <div style="margin-top:.75rem">
                <div style="font-weight:800;font-size:1rem;color:var(--text-dark);margin-bottom:.4rem">${nombre}</div>
                <div style="font-size:.7rem;color:var(--text-muted);word-break:break-all;background:#f5f5f5;padding:.5rem .7rem;border-radius:8px;border:1px solid var(--border);line-height:1.5;text-align:left">${urlDisplay}</div>
            </div>
            <div style="margin-top:1rem;display:flex;justify-content:space-between;align-items:center">
                <button class="btn-danger" id="qrModalDeleteBtn" style="background:var(--danger);color:#fff;border:none;padding:.5rem 1rem;border-radius:8px;cursor:pointer">
                    <i class="fas fa-trash"></i> Eliminar
                </button>
                <button class="btn-primary" id="qrModalCloseBtn" style="background:var(--primary);color:#fff;border:none;padding:.5rem 1rem;border-radius:8px;cursor:pointer">
                    Cerrar
                </button>
            </div>
        `;
        const modal = document.getElementById('qrAmpliadoModal');
        modal.classList.add('active');
        
        const deleteBtn = document.getElementById('qrModalDeleteBtn');
        if (deleteBtn) {
            deleteBtn.onclick = async () => {
                window.mostrarConfirmacionPremium(
                    'Eliminar QR',
                    `¿Eliminar el QR de "${nombre}"?`,
                    async () => {
                        await window.eliminarQR(id);
                        window.cerrarModal('qrAmpliadoModal');
                    }
                );
            };
        }
        const closeBtn = document.getElementById('qrModalCloseBtn');
        if (closeBtn) closeBtn.onclick = () => window.cerrarModal('qrAmpliadoModal');
    };

    // ==================== SELECTOR DE MESAS PARA ADMIN ====================
    window.abrirSelectorMesaAdmin = async function() {
        try {
            // Cargar mesas desde codigos_qr
            const { data, error } = await window.supabaseClient.from('codigos_qr').select('*').order('nombre');
            if (error) throw error;
            
            const mesas = data || [];
            const modal = document.getElementById('adminMesaModal');
            const mesaList = document.getElementById('adminMesaList');
            
            if (!mesas.length) {
                mesaList.innerHTML = '<p style="color:var(--text-muted);text-align:center;padding:2rem"><i class="fas fa-info-circle" style="font-size:2rem;margin-bottom:1rem;display:block"></i>No hay mesas registradas</p>';
            } else {
                mesaList.innerHTML = mesas.map(m => `
                    <button class="btn-primary" onclick="window.seleccionarMesaAdmin('${m.nombre.replace(/'/g, "\\'")}')" style="padding:1rem;display:flex;flex-direction:column;align-items:center;gap:.5rem;cursor:pointer;transition:all .3s ease;border:none;border-radius:12px;background:var(--card-bg);color:var(--text-dark);font-weight:600" onmouseover="this.style.background='var(--primary)';this.style.color='#fff'" onmouseout="this.style.background='var(--card-bg)';this.style.color='var(--text-dark)'">
                        <i class="fas fa-chair" style="font-size:1.5rem;color:var(--accent)"></i>
                        <span>${m.nombre}</span>
                    </button>
                `).join('');
            }
            
            modal.classList.add('active');
        } catch (e) {
            console.error('Error abriendo selector de mesas:', e);
            window.mostrarToast('❌ Error al cargar mesas', 'error');
        }
    };
    
    window.seleccionarMesaAdmin = function(mesaNombre) {
        // Redirigir a la página del cliente con la mesa específica
        const url = `${window.location.origin}/Cliente/index.html?mesa=${encodeURIComponent(mesaNombre)}`;
        window.open(url, '_blank');
        window.cerrarModal('adminMesaModal');
    };
})();
