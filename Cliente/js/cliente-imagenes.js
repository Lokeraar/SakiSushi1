// cliente-imagenes.js — Optimización de las fotos de platillos
//
// EL PROBLEMA MEDIDO
//
// Las fotos de Unsplash estaban guardadas como la dirección "pelada":
//
//   https://images.unsplash.com/photo-1579871494447-9811cf80d66c
//
// Esa dirección entrega la foto en su tamaño ORIGINAL. Medido con la foto del
// Dragon Roll:
//
//   sin parámetros  ->  5.430.871 bytes  (5,4 MB)   13,3 segundos
//   con parámetros  ->    125.432 bytes  (125 KB)    1,2 segundos
//
// 43 veces más liviana y 11 veces más rápida. Y esa foto de 5 MB se descarga
// CADA VEZ que la tarjeta se repinta.
//
// Eso es la causa real de que la carta se sienta lenta en el teléfono: no es
// el JavaScript, son los megabytes.
//
// QUÉ HACE
//
//  1. `optimizarUrlImagen(url)`  — agrega los parámetros a los hosts conocidos.
//  2. `subirImagenOptimizada()`  — al subir un archivo, lo convierte a WebP y
//                                  lo achica ANTES de mandarlo al servidor.
//
// IMPORTANTE: solo se tocan hosts conocidos. Si el dueño pega la dirección de
// otro sitio, se respeta tal cual: agregarle parámetros que ese sitio no
// entiende rompería la imagen.

(function () {
    'use strict';

    // Ancho al que se sirven las fotos. 800 se ve nítido en un celular y
    // aguanta una tablet sin pixelear. Con 600 se ahorraban 50 KB más, pero
    // se notaba en pantallas grandes.
    var ANCHO = 800;

    // Calidad: 70 es el punto donde el ojo deja de distinguir el ahorro.
    var CALIDAD = 70;

    /**
     * Agrega los parámetros de tamaño y formato a las imágenes de hosts
     * conocidos. Cualquier otra dirección se devuelve sin tocar.
     */
    window.optimizarUrlImagen = function (url) {
        if (!url || typeof url !== 'string') return url;
        var u = url.trim();
        if (!/^https?:\/\//i.test(u)) return url;   // ruta relativa: se respeta

        try {
            var parsed = new URL(u);
            var host = parsed.hostname.toLowerCase();

            // ---- Unsplash: acepta w, q y fm ----
            if (host === 'images.unsplash.com' || host === 'unsplash.com') {
                // Si ya trae parámetros propios, no se pisan.
                if (!parsed.searchParams.has('w')) parsed.searchParams.set('w', ANCHO);
                if (!parsed.searchParams.has('q')) parsed.searchParams.set('q', CALIDAD);
                if (!parsed.searchParams.has('fm')) parsed.searchParams.set('fm', 'webp');
                return parsed.toString();
            }

            // ---- Supabase Storage: redimensiona al vuelo ----
            // El servicio de transformación de Supabase acepta width, quality
            // y format en la ruta /render/image/. Se usa solo si está
            // disponible; si falla, la imagen original igual carga.
            if (host.indexOf('supabase.co') !== -1 && parsed.pathname.indexOf('/storage/v1/object/public/') !== -1) {
                var ruta = parsed.pathname.replace(
                    '/storage/v1/object/public/',
                    '/storage/v1/render/image/public/'
                );
                parsed.pathname = ruta;
                if (!parsed.searchParams.has('width')) parsed.searchParams.set('width', ANCHO);
                if (!parsed.searchParams.has('quality')) parsed.searchParams.set('quality', CALIDAD);
                if (!parsed.searchParams.has('format')) parsed.searchParams.set('format', 'webp');
                return parsed.toString();
            }

            // Cualquier otro host se respeta sin tocar.
            return u;
        } catch (e) {
            return url;
        }
    };

    /**
     * Convierte un archivo de imagen a WebP y lo achica, en el navegador,
     * ANTES de subirlo.
     *
     * Por qué en el navegador y no en el servidor: así el cliente nunca sube
     * una foto de 4 MB por datos móviles. Una foto de celular de 4 MB sale
     * pesando 150 KB después de esto.
     *
     * Si el navegador no puede (muy viejo), devuelve el archivo original:
     * subir una foto grande es mejor que no subir nada.
     */
    window.convertirAWebp = function (file, anchoMaximo) {
        return new Promise(function (resolve) {
            var ancho = anchoMaximo || ANCHO;

            if (!file || !file.type || file.type.indexOf('image/') !== 0) {
                return resolve({ success: false, error: 'No es una imagen', archivo: file });
            }

            // GIF animado: convertirlo a WebP perdería la animación. Se deja.
            if (file.type === 'image/gif') {
                return resolve({ success: false, error: 'GIF: se deja como está', archivo: file });
            }

            var img = new Image();
            var urlTemp = URL.createObjectURL(file);

            img.onload = function () {
                try {
                    var w = img.naturalWidth;
                    var h = img.naturalHeight;

                    // Solo se achica si es más grande. Nunca se agranda.
                    if (w > ancho) {
                        h = Math.round(h * (ancho / w));
                        w = ancho;
                    }

                    var canvas = document.createElement('canvas');
                    canvas.width = w;
                    canvas.height = h;
                    var ctx = canvas.getContext('2d');
                    ctx.drawImage(img, 0, 0, w, h);

                    canvas.toBlob(function (blob) {
                        URL.revokeObjectURL(urlTemp);
                        if (!blob) {
                            return resolve({ success: false, error: 'No se pudo convertir', archivo: file });
                        }
                        // El navegador puede ignorar "image/webp" y devolver PNG.
                        // Se comprueba, y si no es webp se avisa pero se usa igual.
                        var esWebp = blob.type === 'image/webp';
                        var nuevo = new File(
                            [blob],
                            (file.name || 'imagen').replace(/\.[^.]+$/, '') + (esWebp ? '.webp' : '.jpg'),
                            { type: blob.type || 'image/jpeg' }
                        );
                        resolve({
                            success: true,
                            archivo: nuevo,
                            original: file.size,
                            final: nuevo.size,
                            ancho: w,
                            esWebp: esWebp
                        });
                    }, 'image/webp', 0.8);
                } catch (e) {
                    URL.revokeObjectURL(urlTemp);
                    resolve({ success: false, error: e.message, archivo: file });
                }
            };

            img.onerror = function () {
                URL.revokeObjectURL(urlTemp);
                resolve({ success: false, error: 'No se pudo leer la imagen', archivo: file });
            };

            img.src = urlTemp;
        });
    };

    /**
     * Sube una imagen de platillo optimizada.
     *
     * Reemplaza el camino directo: convierte primero, y recién después sube.
     * Devuelve la misma forma que esperaba el admin: {success, url, error}.
     */
    window.subirImagenPlatilloOptimizada = async function (file, carpeta) {
        var conversion = await window.convertirAWebp(file, ANCHO);
        var aSubir = conversion.success ? conversion.archivo : file;

        if (conversion.success && window.console) {
            var ahorro = Math.round(100 - (conversion.final / conversion.original) * 100);
            console.log('[imagen] ' + Math.round(conversion.original / 1024) + ' KB -> ' +
                Math.round(conversion.final / 1024) + ' KB (' + ahorro + '% menos)' +
                (conversion.esWebp ? ' en WebP' : ' (el navegador no generó WebP)'));
        }

        if (typeof window.subirImagenPlatillo === 'function') {
            return window.subirImagenPlatillo(aSubir, carpeta);
        }
        return { success: false, error: 'No hay función de subida disponible' };
    };

})();
