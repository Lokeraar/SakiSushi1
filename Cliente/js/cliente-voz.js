(function() {
    window.Saki = window.Saki || {};
    window.Saki.utils = window.Saki.utils || {};
    window.Saki.modules = window.Saki.modules || {};

    // Private variable to hold the speech recognition instance
    let reconocimientoVoz = null;

    function iniciarBusquedaPorVoz() {
        if (!('webkitSpeechRecognition' in window) && !('SpeechRecognition' in window)) {
            window.Saki.utils.mostrarToast('❌ Tu navegador no soporta búsqueda por voz', 'error');
            return;
        }
        
        const SpeechRecognition = window.SpeechRecognition || window.webkitSpeechRecognition;
        reconocimientoVoz = new SpeechRecognition();
        reconocimientoVoz.lang = 'es-ES';
        reconocimientoVoz.continuous = false;
        reconocimientoVoz.interimResults = false;
        
        const btn = document.getElementById('voiceSearchBtn');
        if (!btn) return; // Guard against missing button
        
        btn.classList.add('listening');
        const icon = btn.querySelector('i');
        if (icon) icon.className = 'fas fa-microphone-alt';
        
        reconocimientoVoz.onresult = function(event) {
            const transcripcion = event.results[0][0].transcript;
            const searchInput = document.getElementById('searchInput');
            if (searchInput) {
                searchInput.value = transcripcion;
                searchInput.dispatchEvent(new Event('input'));
            }
            window.Saki.utils.mostrarToast(`🔊 Buscando: "${transcripcion}"`, 'info');
            btn.classList.remove('listening');
            if (icon) icon.className = 'fas fa-microphone';
        };
        
        reconocimientoVoz.onerror = function() {
            btn.classList.remove('listening');
            if (icon) icon.className = 'fas fa-microphone';
            window.Saki.utils.mostrarToast('❌ No se pudo reconocer la voz', 'error');
        };
        
        reconocimientoVoz.onend = function() {
            btn.classList.remove('listening');
            if (icon) icon.className = 'fas fa-microphone';
        };
        
        reconocimientoVoz.start();
    }

    function detenerBusquedaPorVoz() {
        if (reconocimientoVoz) {
            reconocimientoVoz.stop();
            reconocimientoVoz = null;
        }
        const btn = document.getElementById('voiceSearchBtn');
        if (btn) {
            btn.classList.remove('listening');
            const icon = btn.querySelector('i');
            if (icon) icon.className = 'fas fa-microphone';
        }
    }

    // Exponer en Saki.modules y window para compatibilidad
    window.Saki.modules.voz = {
        iniciarBusquedaPorVoz: iniciarBusquedaPorVoz,
        detenerBusquedaPorVoz: detenerBusquedaPorVoz
    };
    window.iniciarBusquedaPorVoz = iniciarBusquedaPorVoz;
    window.detenerBusquedaPorVoz = detenerBusquedaPorVoz;

})();