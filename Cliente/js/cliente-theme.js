(function() {
    window.Saki = window.Saki || {};
    window.Saki.utils = window.Saki.utils || {};
    window.Saki.modules = window.Saki.modules || {};
    
    // FUNCIONES DE TEMA (CLARO/OSCURO)
    function toggleTema() {
        document.body.classList.toggle('tema-claro');

        // El icono puede no existir (por ejemplo si el botón se quitó en otra
        // vista). Sin esta guarda, `icono.className` lanzaba un TypeError y el
        // tema NO se guardaba: cambiaba en pantalla y volvía al recargar.
        var esClaro = document.body.classList.contains('tema-claro');
        var icono = document.querySelector('#themeToggle i');
        if (icono) icono.className = esClaro ? 'fas fa-sun' : 'fas fa-moon';

        try {
            localStorage.setItem('saki_tema', esClaro ? 'claro' : 'oscuro');
        } catch (e) { /* modo privado */ }
    }
    
    function cargarTemaGuardado() {
        var tema;
        try { tema = localStorage.getItem('saki_tema'); } catch (e) { tema = null; }
        if (tema !== 'claro') return;
        document.body.classList.add('tema-claro');
        var icono = document.querySelector('#themeToggle i');
        if (icono) icono.className = 'fas fa-sun';
    }
    
    // Exponer en Saki.modules y window para compatibilidad
    window.Saki.modules.theme = {
        toggleTema: toggleTema,
        cargarTemaGuardado: cargarTemaGuardado
    };
    window.toggleTema = toggleTema;
    window.cargarTemaGuardado = cargarTemaGuardado;
    
})();