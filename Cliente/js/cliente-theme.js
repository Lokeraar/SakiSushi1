(function() {
    window.Saki = window.Saki || {};
    window.Saki.utils = window.Saki.utils || {};
    window.Saki.modules = window.Saki.modules || {};
    
    // FUNCIONES DE TEMA (CLARO/OSCURO)
    function toggleTema() {
        document.body.classList.toggle('tema-claro');
        const icono = document.querySelector('#themeToggle i');
        if (document.body.classList.contains('tema-claro')) {
            icono.className = 'fas fa-sun';
            localStorage.setItem('saki_tema', 'claro');
        } else {
            icono.className = 'fas fa-moon';
            localStorage.setItem('saki_tema', 'oscuro');
        }
    }
    
    function cargarTemaGuardado() {
        const tema = localStorage.getItem('saki_tema');
        if (tema === 'claro') {
            document.body.classList.add('tema-claro');
            document.querySelector('#themeToggle i').className = 'fas fa-sun';
        }
    }
    
    // Exponer en Saki.modules y window para compatibilidad
    window.Saki.modules.theme = {
        toggleTema: toggleTema,
        cargarTemaGuardado: cargarTemaGuardado
    };
    window.toggleTema = toggleTema;
    window.cargarTemaGuardado = cargarTemaGuardado;
    
})();