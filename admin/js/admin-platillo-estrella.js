// admin-platillo-estrella.js - Carrusel visual del Top 5 de platillos más vendidos
(function() {
    // Variables globales para el carrusel
    window.platillosTop5 = [];
    window.platilloCarouselIndex = 0;
    window.platilloCarouselInterval = null;
    // 5 segundos por platillo, como se pidió. Antes eran 6.
    // La rotación solo arranca con 2 o más platillos: con uno solo no hay
    // nada que rotar y el temporizador sería un parpadeo sin sentido.
    window.CAROUSEL_INTERVAL_MS = 5000;

    // ── Las fotos: por qué esta tarjeta calentaba el teléfono ──
    //
    // Las imágenes del menú son direcciones "peladas" de Unsplash:
    //
    //   https://images.unsplash.com/photo-1579871494447-9811cf80d66c
    //
    // Esa dirección entrega la foto en su tamaño ORIGINAL. Medido en el
    // dispositivo:
    //
    //   Dragon Roll      sin parámetros: 5.303 KB
    //                    con parámetros:   122 KB   (43 veces menos)
    //   Nigiri de Atún   sin parámetros: 4.873 KB
    //                    con parámetros:    56 KB   (87 veces menos)
    //
    // Y como el carrusel creaba un `new Image()` en CADA rotación, esas
    // fotos de 5 MB se volvían a bajar cada 5 segundos, para siempre. Ese
    // es el calor y la lentitud: no es el JavaScript, son los megabytes.
    //
    // La solución ya existía en el panel del cliente
    // (`Cliente/js/cliente-imagenes.js`). Acá se reusa la misma función si
    // está disponible; si no, se aplica un equivalente mínimo, para que la
    // tarjeta no dependa de que ese archivo se haya cargado antes.

    var ANCHO_ESTRELLA = 800;   // nítido en celular, aguanta tablet
    var CALIDAD_ESTRELLA = 70;  // donde el ojo deja de notar el ahorro

    function urlOptimizada(url) {
        if (!url || typeof url !== 'string') return url;
        // La función del cliente ya conoce Unsplash y Supabase Storage, y
        // respeta los hosts que no reconoce. Es la que se prefiere.
        if (typeof window.optimizarUrlImagen === 'function') {
            return window.optimizarUrlImagen(url);
        }
        // Copia mínima del mismo criterio, por si el admin carga esta
        // tarjeta sin el módulo del cliente.
        try {
            if (!/^https?:\/\//i.test(url)) return url;
            var u = new URL(url);
            var host = u.hostname.toLowerCase();
            if (host === 'images.unsplash.com' || host === 'unsplash.com') {
                if (!u.searchParams.has('w')) u.searchParams.set('w', ANCHO_ESTRELLA);
                if (!u.searchParams.has('q')) u.searchParams.set('q', CALIDAD_ESTRELLA);
                if (!u.searchParams.has('fm')) u.searchParams.set('fm', 'webp');
                return u.toString();
            }
            if (host.indexOf('supabase.co') !== -1 &&
                u.pathname.indexOf('/storage/v1/object/public/') !== -1) {
                u.pathname = u.pathname.replace('/storage/v1/object/public/',
                                                '/storage/v1/render/image/public/');
                if (!u.searchParams.has('width')) u.searchParams.set('width', ANCHO_ESTRELLA);
                if (!u.searchParams.has('quality')) u.searchParams.set('quality', CALIDAD_ESTRELLA);
                if (!u.searchParams.has('format')) u.searchParams.set('format', 'webp');
                return u.toString();
            }
            return url;
        } catch (e) { return url; }
    }

    // Caché de imágenes ya precargadas, por URL. Sin esto el carrusel volvía
    // a pedir la misma foto en cada vuelta del ciclo.
    var precargadas = Object.create(null);

    function precargar(url) {
        if (!url || precargadas[url]) return;
        precargadas[url] = true;
        var img = new Image();
        img.src = url;   // queda en la caché del navegador para el próximo giro
    }
    window.isHoveringPlatillo = false;
    window.isTouchingPlatillo = false;
    
    // Función principal para cargar datos del Platillo Estrella (alias: cargarTopVentasCliente)
    window.cargarPlatilloEstrella = async function() {
        return window.cargarTopVentasCliente();
    };
    
    window.cargarTopVentasCliente = async function() {
        try {
            // Verificar que haya token JWT antes de hacer la consulta
            if (!window.jwtToken) {
                console.warn('⚠️ No hay token JWT, omitiendo carga de Platillo Estrella');
                mostrarSinVentas();
                return;
            }
            
            const { data, error } = await window.supabaseClient
                .from('vista_platillo_estrella')
                .select('*')
                .order('posicion', { ascending: true });

            // Si hay error 401, no lanzar excepción, mostrar sin ventas
            if (error) {
                if (error.status === 401 || error.code === 'PGRST301') {
                    console.warn('⚠️ Token expirado o sin permisos para cargar Platillo Estrella');
                    mostrarSinVentas();
                    return;
                }
                throw error;
            }

            window.platillosTop5 = data || [];
            
            if (window.platillosTop5.length === 0) {
                mostrarSinVentas();
                return;
            }

            // Iniciar el carrusel con el primer platillo (sin animación en carga inicial)
            window.platilloCarouselIndex = 0;
            actualizarCardPlatilloEstrella(null);
            actualizarIndicadores();
            // Precargar las cinco fotos de una vez, ya optimizadas. Así el
            // primer giro tampoco descarga nada: el navegador las tiene en
            // caché antes de que el temporizador las pida.
            window.platillosTop5.forEach(function (pl) {
                precargar(urlOptimizada(pl.imagen || ''));
            });
            iniciarCarruselAutomatico();

        } catch (e) {
            // No mostrar error en consola si es un error 401 o de JWT (ya se manejó arriba)
            if (!(e.status === 401 || e.code === 'PGRST301' || (e.message && e.message.includes('JWT')))) {
                console.error('Error cargando Platillo Estrella:', e);
            }
            mostrarSinVentas();
        }
    };
    
    // Mostrar mensaje cuando no hay ventas
    function mostrarSinVentas() {
        const cardEl = document.getElementById('platilloEstrellaCard');
        const tituloEl = document.getElementById('platilloEstrellaTitulo');
        const descEl = document.getElementById('platilloEstrellaDesc');
        const badgeEl = document.getElementById('platilloBadgePosicion');
        const ordenesEl = document.getElementById('platilloEstrellaOrdenes');
        const totalUsdEl = document.getElementById('platilloEstrellaTotalUsd');
        const totalBsEl = document.getElementById('platilloEstrellaTotalBs');

        // Remover imagen de fondo si existe
        if (cardEl) {
            cardEl.style.backgroundImage = 'none';
        }
        
        if (tituloEl) tituloEl.textContent = 'Sin actividad';
        if (descEl) descEl.textContent = 'Aún no hay cobros esta semana. El ranking se arma solo cuando el cajero confirma el cobro de un pedido.';
        if (badgeEl) badgeEl.textContent = '-';
        if (ordenesEl) ordenesEl.textContent = '0 unidades';
        if (totalUsdEl) totalUsdEl.textContent = '0.00';
        if (totalBsEl) totalBsEl.textContent = window.formatBs(0);

        actualizarIndicadores();
        detenerCarruselAutomatico();
    }

    // Actualizar la tarjeta con los datos del platillo actual
    function actualizarCardPlatilloEstrella(direccion) {
        if (!window.platillosTop5 || window.platillosTop5.length === 0) {
            mostrarSinVentas();
            return;
        }

        const platillo = window.platillosTop5[window.platilloCarouselIndex];
        
        const cardEl = document.getElementById('platilloEstrellaCard');
        const tituloEl = document.getElementById('platilloEstrellaTitulo');
        const descEl = document.getElementById('platilloEstrellaDesc');
        const badgeEl = document.getElementById('platilloBadgePosicion');
        const ordenesEl = document.getElementById('platilloEstrellaOrdenes');
        const totalUsdEl = document.getElementById('platilloEstrellaTotalUsd');
        const totalBsEl = document.getElementById('platilloEstrellaTotalBs');

        // Usar la imagen como fondo de la tarjeta - actualizar primero para transición simultánea
        if (cardEl) {
            // La foto se pide YA optimizada (WebP, 800 px, calidad 70). La
            // diferencia medida contra la dirección original es de 43 a 87
            // veces menos bytes por imagen.
            const imagenUrl = urlOptimizada(platillo.imagen || '');
            if (imagenUrl) {
                // Si ya está puesta, no se toca: repintar el fondo con la misma
                // imagen obliga al navegador a componerla otra vez sin motivo.
                // Ojo: NO se corta la función acá, porque todavía falta pintar
                // los textos (título, unidades, montos) más abajo.
                const actual = cardEl.style.backgroundImage || '';
                const yaPuesta = actual.indexOf(imagenUrl) !== -1;

                if (!yaPuesta) {
                    // Si está en caché, se pinta de una: sin esperar a onload y
                    // sin parpadeo. Si no, se pinta al cargar.
                    if (precargadas[imagenUrl]) {
                        cardEl.style.backgroundImage = "url('" + imagenUrl + "')";
                    } else {
                        const tempImg = new Image();
                        tempImg.onload = function() {
                            cardEl.style.backgroundImage = "url('" + imagenUrl + "')";
                            precargadas[imagenUrl] = true;
                        };
                        tempImg.onerror = function() {
                            // Si falla la imagen, usar un gradiente por defecto
                            cardEl.style.backgroundImage = 'linear-gradient(135deg, #1a1a2e 0%, #16213e 100%)';
                        };
                        tempImg.src = imagenUrl;
                    }
                }
            } else {
                // Sin imagen, usar gradiente por defecto
                cardEl.style.backgroundImage = 'linear-gradient(135deg, #1a1a2e 0%, #16213e 100%)';
            }
        }
        
        // Actualizar contenido de texto inmediatamente (la animación lo ocultará temporalmente)
        if (tituloEl) {
            tituloEl.textContent = platillo.platillo_nombre || 'Sin nombre';
        }
        if (descEl) {
            // Mostrar fechas de la semana actual usando las fechas de la vista
            const fechaInicio = platillo.fecha_inicio || new Date().toISOString();
            const fechaFin = platillo.fecha_fin || new Date().toISOString();
            descEl.textContent = `Top Ventas - ${window.formatFechaGMT4(fechaInicio)} - ${window.formatFechaGMT4(fechaFin)}`;
        }
        if (badgeEl) {
            badgeEl.textContent = `#${platillo.posicion}`;
        }
        if (ordenesEl) {
            ordenesEl.textContent = `${platillo.total_cantidad || 0} unidades`;
        }
        if (totalUsdEl) {
            // El valor total_usd viene de la BD como NUMERIC (ej: 6.50)
            // Supabase puede devolverlo como string o número, lo convertimos correctamente
            let totalUsd = 0;
            if (typeof platillo.total_usd === 'string') {
                // Si viene como string, convertir directamente a float (el punto decimal es válido)
                totalUsd = parseFloat(platillo.total_usd) || 0;
            } else {
                totalUsd = Number(platillo.total_usd) || 0;
            }
            // Formatear con coma como separador decimal (formato venezolano)
            totalUsdEl.textContent = totalUsd.toFixed(2).replace('.', ',');
        }
        if (totalBsEl) {
            // Usar el total_bs histórico acumulado de la BD
            // Cada venta ya fue guardada con su subtotal_bs usando la tasa efectiva del día correspondiente
            // Esto asegura que el acumulado semanal refleje las tasas reales de cada día
            let totalBs = 0;
            if (typeof platillo.total_bs === 'string') {
                totalBs = parseFloat(platillo.total_bs) || 0;
            } else {
                totalBs = Number(platillo.total_bs) || 0;
            }
            
            totalBsEl.textContent = window.formatBs(totalBs);
        }

        // Actualizar indicadores
        actualizarIndicadores();
        
        // Animación de deslizamiento suave con dirección
        aplicarAnimacionDeslizamiento(direccion);
    }
    
    // Actualizar indicadores de progreso (5 puntos)
    function actualizarIndicadores() {
        const indicatorsContainer = document.getElementById('platilloCarouselIndicators');
        if (!indicatorsContainer) return;
        
        const indicators = indicatorsContainer.querySelectorAll('.platillo-indicator');
        const totalSlides = Math.min(window.platillosTop5.length, 5);
        
        indicators.forEach((indicator, index) => {
            if (index < totalSlides) {
                indicator.style.display = 'block';
                if (index === window.platilloCarouselIndex) {
                    indicator.classList.add('active');
                } else {
                    indicator.classList.remove('active');
                }
            } else {
                indicator.style.display = 'none';
            }
        });
    }

    // Aplicar animación de deslizamiento simple - transición simultánea de contenido e imagen
    function aplicarAnimacionDeslizamiento(direccion) {
        const card = document.getElementById('platilloEstrellaCard');
        const contentEl = card.querySelector('.tcb-estrella-content');
        
        if (!card || !contentEl) return;
        
        // Si no hay dirección (carga inicial), no aplicar animación
        if (!direccion) return;

        // Determinar dirección de salida (por defecto izquierda para siguiente)
        const direccionSalida = direccion === 'prev' ? 'right' : 'left';
        
        // Remover clases previas
        contentEl.classList.remove('platillo-slide-in', 'platillo-slide-out-left', 'platillo-slide-out-right');
        
        // Aplicar clase de salida según dirección
        if (direccionSalida === 'left') {
            contentEl.classList.add('platillo-slide-out-left');
        } else {
            contentEl.classList.add('platillo-slide-out-right');
        }
        
        // Esperar a que termine la transición de salida (350ms)
        setTimeout(() => {
            // Actualizar el contenido mientras está invisible
            // La imagen de fondo ya fue actualizada antes de llamar a esta función
            
            // Remover clase de salida
            contentEl.classList.remove('platillo-slide-out-left', 'platillo-slide-out-right');
            
            // Forzar reflow
            void contentEl.offsetWidth;
            
            // Aplicar clase de entrada
            contentEl.classList.add('platillo-slide-in');
            
            // Limpiar clase de entrada después de la transición
            setTimeout(() => {
                contentEl.classList.remove('platillo-slide-in');
            }, 350);
        }, 350);
    }

    // Iniciar carrusel automático
    function iniciarCarruselAutomatico() {
        detenerCarruselAutomatico(); // Limpiar intervalo existente si hay
        
        if (window.platillosTop5.length <= 1) return; // No necesita carrusel si solo hay 1

        window.platilloCarouselInterval = setInterval(() => {
            // Verificar si está en hover o touch para pausar
            if (!window.isHoveringPlatillo && !window.isTouchingPlatillo) {
                window.platilloCarouselIndex = (window.platilloCarouselIndex + 1) % window.platillosTop5.length;
                actualizarCardPlatilloEstrella('next');
            }
        }, window.CAROUSEL_INTERVAL_MS);
    }

    // Detener carrusel automático
    function detenerCarruselAutomatico() {
        if (window.platilloCarouselInterval) {
            clearInterval(window.platilloCarouselInterval);
            window.platilloCarouselInterval = null;
        }
    }

    // Navegación manual - siguiente platillo (dirección por defecto: izquierda)
    window.siguientePlatillo = function() {
        if (!window.platillosTop5 || window.platillosTop5.length === 0) return;
        window.platilloCarouselIndex = (window.platilloCarouselIndex + 1) % window.platillosTop5.length;
        actualizarCardPlatilloEstrella('next');
        reiniciarCarruselTrasInteraccion();
    };

    // Navegación manual - platillo anterior (dirección: derecha)
    window.anteriorPlatillo = function() {
        if (!window.platillosTop5 || window.platillosTop5.length === 0) return;
        window.platilloCarouselIndex = (window.platilloCarouselIndex - 1 + window.platillosTop5.length) % window.platillosTop5.length;
        actualizarCardPlatilloEstrella('prev');
        reiniciarCarruselTrasInteraccion();
    };
    
    // Ir a un índice específico (para clicks en indicadores) - determina dirección automáticamente
    window.irAPlatilloIndex = function(index) {
        if (!window.platillosTop5 || index < 0 || index >= window.platillosTop5.length) return;
        const direccion = index > window.platilloCarouselIndex ? 'next' : 'prev';
        window.platilloCarouselIndex = index;
        actualizarCardPlatilloEstrella(direccion);
        reiniciarCarruselTrasInteraccion();
    };

    // Reiniciar el temporizador tras interacción manual
    function reiniciarCarruselTrasInteraccion() {
        detenerCarruselAutomatico();
        setTimeout(() => {
            iniciarCarruselAutomatico();
        }, window.CAROUSEL_INTERVAL_MS);
    }

    // Función para redirigir a Reportes
    window.verAnaliticaPlatilloEstrella = function(event) {
        if (event) event.stopPropagation();
        // Cambiar a la pestaña de Reportes
        const tabReportes = document.querySelector('.tab[data-tab="reportes"]');
        if (tabReportes) {
            // Simular click en la pestaña
            tabReportes.click();
        }
        
        // Mostrar toast informativo
        window.mostrarToast('Viendo analítica completa en Reportes', 'info');
    };
    
    // Helper para formatear fecha en GMT-4
    window.formatFechaGMT4 = function(fechaStr) {
        if (!fechaStr) return '';
        const date = new Date(fechaStr);
        // Ajustar a GMT-4 (Venezuela)
        const offset = -4 * 60 * 60 * 1000;
        const gmt4Date = new Date(date.getTime() + offset);
        return gmt4Date.toLocaleDateString('es-VE', { day: '2-digit', month: '2-digit', year: '2-digit' });
    };
    
    // Helper para obtener tasa efectiva actual
    window.obtenerTasaEfectivaActual = function() {
        const tasaDisplay = document.getElementById('tasaEfectivaDisplay');
        if (tasaDisplay) {
            // El formato es "400.00" o "500,00" - normalizar a número float
            const texto = tasaDisplay.textContent.trim();
            // Reemplazar punto de miles (si existe) y convertir coma decimal a punto
            const normalized = texto.replace(/\./g, '').replace(',', '.');
            return parseFloat(normalized) || null;
        }
        // Fallback a configGlobal si no hay display
        return window.tasaEfectivaActual();
    };

    // Setup de event listeners
    document.addEventListener('DOMContentLoaded', function() {
        const card = document.getElementById('platilloEstrellaCard');
        if (!card) return;
        
        // Botones de navegación
        const btnPrev = document.getElementById('platilloNavPrev');
        const btnNext = document.getElementById('platilloNavNext');
        
        if (btnPrev) {
            btnPrev.addEventListener('click', function(e) {
                e.stopPropagation();
                window.anteriorPlatillo();
            });
        }
        
        if (btnNext) {
            btnNext.addEventListener('click', function(e) {
                e.stopPropagation();
                window.siguientePlatillo();
            });
        }
        
        // Pausa en hover (desktop) - no pausar si se hace hover sobre el botón de analítica o navegación
        card.addEventListener('mouseenter', (e) => {
            if (e.target.closest('.tcb-estrella-btn') || e.target.closest('.carousel-nav-btn')) return;
            window.isHoveringPlatillo = true;
        });
        
        card.addEventListener('mouseleave', () => {
            window.isHoveringPlatillo = false;
        });
        
        // Pausa en touch (móvil/tablet) - no pausar si se toca el botón de analítica o navegación
        card.addEventListener('touchstart', (e) => {
            if (e.target.closest('.tcb-estrella-btn') || e.target.closest('.carousel-nav-btn')) return;
            window.isTouchingPlatillo = true;
        }, { passive: true });
        
        card.addEventListener('touchend', (e) => {
            if (e.target.closest('.tcb-estrella-btn') || e.target.closest('.carousel-nav-btn')) return;
            window.isTouchingPlatillo = false;
        }, { passive: true });
        
        // Click en indicadores
        const indicatorsContainer = document.getElementById('platilloCarouselIndicators');
        if (indicatorsContainer) {
            indicatorsContainer.addEventListener('click', (e) => {
                if (e.target.classList.contains('platillo-indicator')) {
                    const index = Array.from(indicatorsContainer.querySelectorAll('.platillo-indicator')).indexOf(e.target);
                    if (index >= 0) {
                        window.irAPlatilloIndex(index);
                    }
                }
            });
        }
        
        // Swipe touch para navegación (solo si no es en el botón de analítica o navegación)
        let touchStartX = 0;
        let touchEndX = 0;
        
        card.addEventListener('touchstart', (e) => {
            // No iniciar swipe si se toca el botón de analítica o navegación
            if (e.target.closest('.tcb-estrella-btn') || e.target.closest('.carousel-nav-btn')) return;
            touchStartX = e.changedTouches[0].screenX;
        }, { passive: true });
        
        card.addEventListener('touchend', (e) => {
            // No finalizar swipe si se tocó el botón de analítica o navegación
            if (e.target.closest('.tcb-estrella-btn') || e.target.closest('.carousel-nav-btn')) return;
            touchEndX = e.changedTouches[0].screenX;
            handleSwipe();
        }, { passive: true });
        
        function handleSwipe() {
            const swipeThreshold = 50;
            const diff = touchStartX - touchEndX;
            
            if (Math.abs(diff) > swipeThreshold) {
                if (diff > 0) {
                    // Swipe izquierda - siguiente
                    window.siguientePlatillo();
                } else {
                    // Swipe derecha - anterior
                    window.anteriorPlatillo();
                }
            }
        }
        
        // Cargar datos al iniciar
        setTimeout(() => {
            if (window.supabaseClient) {
                window.cargarTopVentasCliente();
            }
        }, 1000);
    });

    // Re-cargar cuando se cambia a la pestaña dashboard
    document.addEventListener('click', function(e) {
        if (e.target.classList.contains('tab') && e.target.dataset.tab === 'dashboard') {
            setTimeout(() => {
                window.cargarTopVentasCliente();
            }, 300);
        }
    });

})();
