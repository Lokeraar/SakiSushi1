(function() {
    window.Saki = window.Saki || {};
    window.Saki.utils = {};
    
    // generarId(prefix) — UUID v4 con prefijo
    function generarId(prefix) {
        const uuid = crypto.randomUUID ? crypto.randomUUID() : 
                   'xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx'.replace(/[xy]/g, function(c) {
                       const r = Math.random() * 16 | 0;
                       const v = c == 'x' ? r : (r & 0x3 | 0x8);
                       return v.toString(16);
                   });
        return prefix + uuid;
    }
    window.Saki.utils.generarId = generarId;
    window.generarId = generarId;
    
    // formatBs(monto) — "Bs. 1.234,56"
    function formatBs(monto) {
        if (monto === null || monto === undefined) return 'Bs. 0,00';
        const num = parseFloat(monto);
        if (isNaN(num)) return 'Bs. 0,00';
        return 'Bs. ' + num.toLocaleString('es-VE', {
            minimumFractionDigits: 2,
            maximumFractionDigits: 2
        });
    }
    window.Saki.utils.formatBs = formatBs;
    window.formatBs = formatBs;
    
    // usdToBs(usd) — multiplica por configGlobal.tasa_efectiva
    function usdToBs(usd) {
        const tasa = window.configGlobal?.tasa_efectiva || 400;
        return parseFloat(usd) * tasa;
    }
    window.Saki.utils.usdToBs = usdToBs;
    window.usdToBs = usdToBs;
    
    // copiarAlPortapapeles(texto, boton) — clipboard API + feedback visual
    function copiarAlPortapapeles(texto, boton) {
        if (!texto) return;
        if (!navigator.clipboard || !navigator.clipboard.writeText) {
            mostrarToast('Portapapeles no disponible', 'error');
            return;
        }
        navigator.clipboard.writeText(texto).then(function() {
            if (boton) {
                boton.classList.add('copied');
                var icono = boton.querySelector('i');
                if (icono) icono.className = 'fas fa-check';
                setTimeout(function() {
                    boton.classList.remove('copied');
                    if (icono) icono.className = 'fas fa-copy';
                }, 1500);
            }
            mostrarToast('Copiado al portapapeles', 'success');
        }).catch(function(err) {
            console.error('Error al copiar:', err);
            mostrarToast('Error al copiar', 'error');
        });
    }
    window.Saki.utils.copiarAlPortapapeles = copiarAlPortapapeles;
    window.copiarAlPortapapeles = copiarAlPortapapeles;
    
    // mostrarToast(msg, tipo) — toast genérico
    function mostrarToast(msg, tipo = 'info') {
        const toast = document.getElementById('toast');
        if (!toast) return;
        
        toast.className = 'toast';
        toast.classList.add('show');
        toast.classList.add(tipo);
        toast.textContent = msg;
        
        clearTimeout(toast._hideTimer);
        toast._hideTimer = setTimeout(() => {
            toast.classList.remove('show');
        }, 3000);
    }
    window.Saki.utils.mostrarToast = mostrarToast;
    window.mostrarToast = mostrarToast;
    
})();