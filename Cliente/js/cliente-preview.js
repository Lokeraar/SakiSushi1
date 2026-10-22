// cliente-preview.js - Modal preview de platillos
(function() {
    window.Saki = window.Saki || {};
    window.Saki.modules = window.Saki.modules || {};
    window.Saki.modules.preview = {};
    var S = window.Saki;

    var _currentPreviewId = null;

    function abrirPreview(platilloId) {
        var item = (S.state.menuItems || []).find(function(i) { return i.id == platilloId; });
        if (!item) return;
        _currentPreviewId = platilloId;

        var modal = document.getElementById('customizeModal'); // Reuse same modal
        var body = document.getElementById('customizeModalBody');
        if (!modal || !body) return;

        var precioBs = S.utils.usdToBs(item.precio || 0);
        var imagen = item.imagen || 'https://via.placeholder.com/400x250?text=Sin+Imagen';
        // ingredientes en DB es objeto {id: {nombre, cantidad}}, convertimos a array
        var ingredientesObj = item.ingredientes || {};
        var ingredientes = Object.entries(ingredientesObj).map(function(e) {
            var ingInfo = e[1];
            return { nombre: ingInfo.nombre || e[0] };
        });

        var html = '<div class="preview-modal">' +
            '<div class="preview-image" style="background-image:url(\'' + imagen + '\');background-size:cover;background-position:center;height:250px;border-radius:var(--radius-md);margin-bottom:1rem"></div>' +
            '<h3 style="color:var(--accent);margin-bottom:.3rem;font-size:1.3rem">' + item.nombre + '</h3>' +
            '<p style="color:var(--text-secondary);font-size:.9rem;margin-bottom:.8rem">' + (item.descripcion || 'Sin descripción') + '</p>' +
            '<div style="font-size:1.2rem;font-weight:700;color:var(--accent);margin-bottom:1rem">' + S.utils.formatBs(precioBs) + '</div>';

        if (ingredientes.length > 0) {
            html += '<div class="preview-ingredientes" style="background:rgba(0,0,0,.2);padding:1rem;border-radius:var(--radius-md);margin-bottom:1rem">' +
                '<h4 style="color:var(--accent);margin-bottom:.5rem;font-size:.9rem"><i class="fas fa-list"></i> Ingredientes</h4>' +
                '<ul style="list-style:none;display:flex;flex-wrap:wrap;gap:.5rem">';
            ingredientes.forEach(function(ing) {
                html += '<li style="background:rgba(255,255,255,.1);padding:.3rem .8rem;border-radius:20px;font-size:.8rem">' + ing.nombre + '</li>';
            });
            html += '</ul></div>';
        }

        // Stock info inline (evita getStockTexto que no existe)
        var stock = window._stockPrecalculado?.[platilloId] ?? 999;
        var stockInfo = stock <= 0
            ? '<span style="color:var(--danger)"><i class="fas fa-times-circle"></i> Agotado</span>'
            : (stock < 5
                ? '<span style="color:var(--warning)"><i class="fas fa-exclamation-triangle"></i> Últimas ' + stock + ' disponibles</span>'
                : '');
        if (stockInfo) {
            html += '<div class="stock-info" style="margin-bottom:1rem">' + stockInfo + '</div>';
        }

        html += '<div style="display:flex;gap:.5rem">' +
            '<button class="btn-secondary" id="previewCustomize" style="flex:1"><i class="fas fa-sliders-h"></i> Personalizar</button>' +
            '<button class="btn-primary" id="previewAddToCart" style="flex:1"><i class="fas fa-cart-plus"></i> Añadir</button>' +
            '</div></div>';

        body.innerHTML = html;
        document.getElementById('customizeModalHeader').textContent = item.nombre;
        modal.classList.add('active');

        document.getElementById('closeCustomizeModal').addEventListener('click', function() { modal.classList.remove('active'); });
        document.getElementById('cancelCustomize').addEventListener('click', function() { modal.classList.remove('active'); });

        var customizeBtn = document.getElementById('previewCustomize');
        if (customizeBtn) {
            customizeBtn.addEventListener('click', function() {
                modal.classList.remove('active');
                if (window.abrirPersonalizacion) window.abrirPersonalizacion(platilloId);
            });
        }

        var addBtn = document.getElementById('previewAddToCart');
        if (addBtn) {
            addBtn.addEventListener('click', function() {
                modal.classList.remove('active');
                if (window.agregarAlCarrito) window.agregarAlCarrito(platilloId);
            });
        }
    }
    window.abrirPreview = abrirPreview;
    S.modules.preview.abrirPreview = abrirPreview;

    function cerrarPreview() {
        document.getElementById('customizeModal').classList.remove('active');
        _currentPreviewId = null;
    }
    window.cerrarPreview = cerrarPreview;
    S.modules.preview.cerrarPreview = cerrarPreview;
})();
