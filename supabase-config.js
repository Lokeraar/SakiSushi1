// supabase-config.js - VERSIÓN COMPLETA Y CORREGIDA

window.SUPABASE_URL = 'https://iqwwoihiiyrtypyqzhgy.supabase.co';
window.SUPABASE_ANON_KEY = 'sb_publishable_m4WcF4gmkj1olAj95HMLlA_4yKqPFXm';

// FUNCIÓN PARA INICIALIZAR EL CLIENTE CON UN TOKEN JWT OPCIONAL
window.inicializarSupabaseCliente = (jwtToken = null) => {
    // Prevenir GoTrueClient duplicado: cerrar auth del cliente anterior
    if (window.supabaseClient) {
        try {
            window.supabaseClient.auth.stopAutoRefresh();
        } catch (_) { /* ignorar si no existe el método */ }
    }
    const storageKey = jwtToken ? `sb-jwt-${Date.now()}` : 'sb-anon';
    const options = {
        auth: {
            persistSession: false,
            autoRefreshToken: false,
            detectSessionInUrl: false,
            storageKey: storageKey
        },
        realtime: {
            heartbeatIntervalMs: 60000,
            reconnectAfterMs: (tries) => Math.min(tries * 2000, 30000)
        },
        global: { 
            headers: { 
                apikey: window.SUPABASE_ANON_KEY,
                Authorization: `Bearer ${jwtToken || window.SUPABASE_ANON_KEY}`
            } 
        }
    };
    window.supabaseClient = window.supabase.createClient(
        window.SUPABASE_URL,
        window.SUPABASE_ANON_KEY,
        options
    );
    console.log(jwtToken ? '✅ Cliente Supabase con JWT' : '🔓 Cliente Supabase anónimo');
    return window.supabaseClient;
};

// Inicializar cliente por defecto (sin token)
if (!window.supabaseClient) {
    window.supabaseClient = window.inicializarSupabaseCliente();
}

// ============================================
// CONFIGURACIÓN GLOBAL
// ============================================
window.configGlobal = {
    tasa_cambio: 400,
    tasa_efectiva: 400,
    aumento_diario: 0,
    aumento_acumulado: 0,
    aumento_activo: false,
    aumento_detenido: false,
    fecha_ultimo_aumento: null,
    ultima_actualizacion: null,
    recovery_email: 'admin@sakisushi.com',
    alerta_stock_minimo: 5
};

// ============================================
// CACHÉ GLOBAL MEJORADO
// ============================================
window.appCache = {
    stock: { data: {}, lastUpdate: 0, duration: 5000 },
    platillos: new Map(),
    pedidos: new Map(),
    notificaciones: new Map(),
    
    getStock: function(ingredienteId) {
        const ahora = Date.now();
        if (ahora - this.stock.lastUpdate > this.stock.duration) {
            this.stock.data = {};
        }
        return this.stock.data[ingredienteId];
    },
    
    setStock: function(ingredienteId, valor) {
        this.stock.data[ingredienteId] = valor;
        this.stock.lastUpdate = Date.now();
    },
    
    invalidateStock: function() {
        this.stock.data = {};
        this.stock.lastUpdate = 0;
        this.platillos.clear();
    },
    
    limpiarTodo: function() {
        this.stock.data = {};
        this.stock.lastUpdate = 0;
        this.platillos.clear();
        this.pedidos.clear();
        this.notificaciones.clear();
    }
};

window.stockCache = {
    get: (id) => window.appCache.getStock(id),
    set: (id, v) => window.appCache.setStock(id, v),
    invalidate: () => window.appCache.invalidateStock(),
    clear: () => { 
        window.appCache.stock.data = {}; 
        window.appCache.stock.lastUpdate = 0; 
    }
};

// ============================================
// FUNCIONES DE ZONA HORARIA GMT-4
// ============================================
window.getFechaGMT4 = function() {
    const fecha = new Date();
    return new Date(fecha.toLocaleString('en-US', { timeZone: 'America/Caracas' }));
};

window.formatearFechaGMT4 = function(timestamp) {
    if (!timestamp) return 'N/A';
    try {
        let ts = timestamp;
        if (typeof ts === 'string' && !ts.endsWith('Z') && !/[+\-]\d{2}(:\d{2})?$/.test(ts)) ts += 'Z';
        const fecha = new Date(ts);
        const opts = z => fecha.toLocaleString('en-US', { timeZone: 'America/Caracas', ...z });
        const dia = String(opts({ day: 'numeric' })).padStart(2, '0');
        const mes = String(opts({ month: 'numeric' })).padStart(2, '0');
        const ano = opts({ year: 'numeric' });
        const hhmm = opts({ hour: 'numeric', minute: '2-digit', hour12: true });
        return `${dia}/${mes}/${ano} ${hhmm}`.toLowerCase();
    } catch (e) {
        return timestamp;
    }
};

window.formatearHora12GMT4 = function(timestamp) {
    if (!timestamp) return 'N/A';
    try {
        let ts = timestamp;
        if (typeof ts === 'string' && !ts.endsWith('Z') && !/[+\-]\d{2}(:\d{2})?$/.test(ts)) ts += 'Z';
        const fecha = new Date(ts);
        return fecha.toLocaleString('en-US', {
            timeZone: 'America/Caracas',
            hour: 'numeric',
            minute: '2-digit',
            hour12: true
        }).toLowerCase();
    } catch (e) {
        return timestamp;
    }
};

window.getTimestampISO_GMT4 = function() {
    const fecha = new Date();
    const fechaGMT4 = new Date(fecha.toLocaleString('en-US', { timeZone: 'America/Caracas' }));
    const fechaUTC = new Date(fechaGMT4.getTime() + (4 * 60 * 60 * 1000));
    return fechaUTC.toISOString();
};

window.utcToGMT4 = function(utcTimestamp) {
    if (!utcTimestamp) return null;
    try {
        const fecha = new Date(utcTimestamp);
        return new Date(fecha.getTime() - (4 * 60 * 60 * 1000));
    } catch (e) {
        return new Date(utcTimestamp);
    }
};

// ============================================
// FUNCIONES DE NOTIFICACIONES PUSH
// ============================================
window.VAPID_PUBLIC_KEY = 'BC6oJ4E+5pGIn4icpzCBLMi6/nk+1JJenrUA41uJrAs1ELraSw5ctvRAlh8sHVldqzBXUtEwEeFKBm0/hmuM9EY=';

function urlBase64ToUint8Array(base64String) {
    const padding = '='.repeat((4 - base64String.length % 4) % 4);
    const base64 = (base64String + padding).replace(/-/g, '+').replace(/_/g, '/');
    const rawData = window.atob(base64);
    const outputArray = new Uint8Array(rawData.length);
    for (let i = 0; i < rawData.length; ++i) outputArray[i] = rawData.charCodeAt(i);
    return outputArray;
}

window.esBrave = function() {
    return navigator.brave && typeof navigator.brave.isBrave === 'function';
};

window.solicitarPermisoPush = async function(sessionId) {
    if (!('Notification' in window)) return { success: false, error: 'no_support' };
    if (!('serviceWorker' in navigator)) return { success: false, error: 'no_sw' };
    if (location.protocol !== 'https:' && location.hostname !== 'localhost') return { success: false, error: 'no_https' };
    
    try {
        const permiso = await Notification.requestPermission();
        if (permiso !== 'granted') return { success: false, error: 'denied' };
        
        const swUrl = '/sw.js';
        const registration = await navigator.serviceWorker.register(swUrl);
        await navigator.serviceWorker.ready;
        
        let subscription = await registration.pushManager.getSubscription();
        if (!subscription) {
            subscription = await registration.pushManager.subscribe({
                userVisibleOnly: true,
                applicationServerKey: urlBase64ToUint8Array(window.VAPID_PUBLIC_KEY)
            });
        }
        
        const p256dh = btoa(String.fromCharCode.apply(null, new Uint8Array(subscription.getKey('p256dh'))));
        const auth = btoa(String.fromCharCode.apply(null, new Uint8Array(subscription.getKey('auth'))));
        
        const { error } = await window.supabaseClient
            .from('push_subscriptions')
            .upsert([{
                session_id: sessionId,
                endpoint: subscription.endpoint,
                p256dh: p256dh,
                auth: auth,
                user_agent: navigator.userAgent
            }], { onConflict: 'endpoint' });
            
        if (error) throw error;
        return { success: true, subscription };
        
    } catch (error) {
        console.error('❌ Error en push:', error);
        return { success: false, error: error.message };
    }
};

window.tienePermisoPush = function() {
    return Notification.permission === 'granted';
};

// ============================================
// FUNCIONES DE CARGA DE CONFIGURACIÓN
// ============================================
// TASA DEL BCV
// ============================================
// La Edge Function `tasa-bcv-scraper` consulta el BCV y devuelve la tasa
// oficial del día. Existe desde mayo pero estaba desconectada del frontend:
// los precios se mostraban con la tasa guardada en `config`, que quedó
// congelada en 544,58 desde el 28-may.
//
// Se cachea por día en localStorage para no golpear la función en cada carga
// y para que un fallo del BCV no rompa la app.
window.obtenerTasaBCV = async function(opciones) {
    const forzar = opciones && opciones.forzar;
    const hoy = new Date().toISOString().split('T')[0];

    if (!forzar) {
        const fechaCache = localStorage.getItem('saki_bcv_fecha');
        const valorCache = parseFloat(localStorage.getItem('saki_bcv_valor'));
        if (fechaCache === hoy && valorCache > 0) {
            return valorCache;
        }
    }

    try {
        const url = window.SUPABASE_URL + '/functions/v1/tasa-bcv-scraper';
        const res = await fetch(url, {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json',
                'apikey': window.SUPABASE_ANON_KEY,
                'Authorization': 'Bearer ' + window.SUPABASE_ANON_KEY
            }
        });
        const data = await res.json();
        if (!data.success || !(data.tasa > 0)) {
            console.warn('BCV no devolvió una tasa usable:', data.error || 'sin detalle');
            return null;
        }
        localStorage.setItem('saki_bcv_fecha', hoy);
        localStorage.setItem('saki_bcv_valor', String(data.tasa));
        console.log('💱 Tasa BCV del día:', data.tasa, '(' + (data.fuente || 'BCV') + ')');
        return data.tasa;
    } catch (e) {
        console.warn('No se pudo consultar el BCV, se usa la tasa guardada:', e.message);
        return null;
    }
};

// Aplica el aumento vigente sobre una tasa base, igual que el admin.
// Se duplica a propósito la aritmética de admin-config.js para que el cliente
// no dependa de que el admin tenga el panel abierto.
function _calcularTasaEfectiva(tasaBase, cfg) {
    var activoDiario  = !!cfg.aumento_activo;
    var activoSemanal = !!cfg.aumento_semanal;
    var indefinido    = !!cfg.aumento_indefinido;
    var pct           = parseFloat(cfg.aumento_diario) || 0;

    if ((!activoDiario && !activoSemanal) || !cfg.aumento_desde) {
        return tasaBase;
    }

    var hoy = new Date(); hoy.setHours(0, 0, 0, 0);
    var desde = new Date(String(cfg.aumento_desde).split('T')[0] + 'T00:00:00');
    if (desde > hoy) return tasaBase;

    var hasta = (!indefinido && cfg.aumento_hasta)
        ? new Date(String(cfg.aumento_hasta).split('T')[0] + 'T00:00:00')
        : null;
    if (hasta && hasta < desde) return tasaBase;

    var finEfectivo = (hasta && hasta < hoy) ? hasta : hoy;
    var msDia       = 24 * 60 * 60 * 1000;
    var msPeriodo   = activoSemanal ? 7 * msDia : msDia;
    var periodos    = Math.max(0, Math.floor((finEfectivo - desde) / msPeriodo) + 1);
    var acumulado   = periodos * pct;

    return tasaBase * (1 + acumulado / 100);
}

// ============================================
window.cargarConfiguracion = async function() {
    try {
        // Se lee la vista pública, no la tabla cruda: desde la migración 05
        // `config` solo es legible por cajero y admin, y el cliente anónimo
        // necesita la tasa para mostrar precios. La vista `config_publica`
        // expone todo menos `admin_password`.
        const { data, error } = await window.supabaseClient
            .from('config_publica')
            .select('*')
            .eq('id', 1)
            .single();
        if (error && error.code !== 'PGRST116') throw error;
        if (data) window.configGlobal = { ...window.configGlobal, ...data };

        // ── Tasa del día ──
        // Se consulta el BCV y, si responde, se usa como tasa base. El precio
        // final lo sigue calculando `tasa_efectiva` = base × (1 + aumento).
        //
        // Importante: el aumento SOLO se aplica mientras esté vigente (activo
        // o semanal, dentro de su ventana de fechas). Si no, tasa_efectiva es
        // la tasa base tal cual. Antes esto se recalculaba solo si el admin
        // abría su panel, así que el cliente podía quedar con un valor viejo.
        var tasaBCV = window.obtenerTasaBCV ? await window.obtenerTasaBCV() : null;
        if (tasaBCV > 0) {
            window.configGlobal.tasa_cambio      = tasaBCV;
            window.configGlobal.tasa_efectiva    = _calcularTasaEfectiva(tasaBCV, window.configGlobal);
            window.configGlobal.tasa_origen      = 'bcv';
            window.configGlobal.tasa_consultada  = new Date().toISOString();
        } else {
            // Sin BCV se usa lo que haya en config, que la migración dejó como
            // último valor bueno. Nunca se cae a un 400 hardcodeado.
            window.configGlobal.tasa_origen = 'config';
        }

        console.log('✅ Configuración cargada.', {
            base: window.configGlobal.tasa_cambio,
            efectiva: window.configGlobal.tasa_efectiva,
            origen: window.configGlobal.tasa_origen
        });
        return window.configGlobal;
    } catch (error) {
        console.error('Error cargando configuración:', error);
        return window.configGlobal;
    }
};

// ============================================
// FUNCIONES DE SUBIDA DE IMÁGENES Y COMPROBANTES
// ============================================
window.subirImagenPlatillo = async function(archivoImagen, carpetaAdicional = '') {
    try {
        if (!archivoImagen) return { success: false, error: 'No se proporcionó archivo' };
        const tipoValido = ['image/jpeg', 'image/png', 'image/jpg', 'image/webp', 'image/gif'];
        if (!tipoValido.includes(archivoImagen.type)) return { success: false, error: 'Tipo de archivo no válido' };
        const maxSize = 5 * 1024 * 1024;
        if (archivoImagen.size > maxSize) return { success: false, error: 'El archivo es demasiado grande. Máximo 5MB' };
        const timestamp = Date.now();
        const random = Math.random().toString(36).substring(2, 8);
        const extension = archivoImagen.name.split('.').pop();
        const nombreArchivo = `${timestamp}_${random}.${extension}`;
        const ruta = carpetaAdicional ? `${carpetaAdicional}/${nombreArchivo}` : nombreArchivo;
        const { data, error } = await window.supabaseClient.storage
            .from('imagenes-platillos')
            .upload(ruta, archivoImagen, { cacheControl: '3600', upsert: false, contentType: archivoImagen.type });
        if (error) throw error;
        const { data: urlData } = window.supabaseClient.storage.from('imagenes-platillos').getPublicUrl(ruta);
        return { success: true, path: ruta, url: urlData.publicUrl };
    } catch (error) {
        console.error('Error subiendo imagen:', error);
        return { success: false, error: error.message };
    }
};

window.eliminarImagenPlatillo = async function(urlImagen) {
    try {
        if (!urlImagen) return { success: true };
        const bucketName = 'imagenes-platillos';
        const bucketIndex = urlImagen.indexOf(`/public/${bucketName}/`);
        if (bucketIndex === -1) return { success: true };
        const rutaRelativa = urlImagen.substring(bucketIndex + `/public/${bucketName}/`.length);
        if (!rutaRelativa) return { success: true };
        const { error } = await window.supabaseClient.storage.from(bucketName).remove([rutaRelativa]);
        if (error) throw error;
        return { success: true };
    } catch (error) {
        console.error('Error eliminando imagen:', error);
        return { success: false, error: error.message };
    }
};

window.subirComprobante = async function(file, tipo, onProgress) {
    try {
        if (!file) throw new Error('No se proporcionó archivo');
        const tipoValido = ['image/jpeg', 'image/png', 'image/jpg', 'image/webp', 'image/gif'];
        if (!tipoValido.includes(file.type)) throw new Error('Tipo de archivo no válido. Solo imágenes JPG, PNG, WEBP o GIF');
        const maxSize = 5 * 1024 * 1024;
        if (file.size > maxSize) throw new Error('El archivo es demasiado grande. Máximo 5MB');
        const timestamp = Date.now();
        const nombreArchivo = `${timestamp}_${file.name.replace(/[^a-zA-Z0-9.]/g, '_')}`;
        const ruta = `${tipo}/${nombreArchivo}`;
        const { data, error } = await window.supabaseClient.storage
            .from('comprobantes')
            .upload(ruta, file, { cacheControl: '3600', upsert: false, contentType: file.type });
        if (error) throw new Error(error.message || 'Error al subir el archivo');
        const { data: urlData } = window.supabaseClient.storage.from('comprobantes').getPublicUrl(ruta);
        if (onProgress) onProgress({ loaded: file.size, total: file.size, percent: 100 });
        return { success: true, url: urlData.publicUrl };
    } catch (error) {
        console.error('Error en subirComprobante:', error);
        return { success: false, error: error.message || 'Error desconocido al subir el comprobante' };
    }
};

// ============================================
// FUNCIONES DE FORMATO Y VALIDACIÓN
// ============================================
window.formatBs = function(monto) {
    try {
        const valor = Math.round((monto || 0) * 100) / 100;
        let [entero, decimal] = valor.toFixed(2).split('.');
        entero = entero.replace(/\B(?=(\d{3})+(?!\d))/g, '.');
        return `Bs ${entero},${decimal}`;
    } catch (e) {
        return 'Bs ' + (monto || 0).toFixed(2);
    }
};

window.formatUSD = function(monto) {
    try {
        return new Intl.NumberFormat('en-US', { style: 'currency', currency: 'USD', minimumFractionDigits: 2 }).format(monto);
    } catch (e) {
        return '$ ' + (monto || 0).toFixed(2);
    }
};

window.generarId = function(prefix = '') {
    if (window.crypto && window.crypto.randomUUID) {
        return `${prefix}${crypto.randomUUID()}`;
    }
    return `${prefix}${Date.now()}_${Math.random().toString(36).substring(2, 15)}`;
};

window.validarTelefono = function(telefono) {
    const soloNumeros = telefono.replace(/\D/g, '');
    const regex = /^(0412|0414|0424|0416|0426|0418|0422|0212|0234|0241|0243|0246|0251|0254|0255|0257|0261|0264|0265|0268|0271|0273|0274|0275|0276|0281)\d{7}$/;
    return regex.test(soloNumeros);
};

window.validarReferencia = function(ref) {
    const soloNumeros = ref.replace(/\D/g, '');
    return soloNumeros.length === 6;
};

window.usdToBs = function(usd, tasa) {
    const tasaActual = tasa || window.configGlobal.tasa_efectiva || 400;
    return usd * tasaActual;
};

window.bsToUsd = function(bs, tasa) {
    const tasaActual = tasa || window.configGlobal.tasa_efectiva || 400;
    return bs / tasaActual;
};

// ============================================
// DATOS DE PARROQUIAS Y CATEGORÍAS
// ============================================
window.parroquiasDelivery = [
    { nombre: "San Bernardino", precioUSD: 2 }, { nombre: "San José", precioUSD: 2 },
    { nombre: "San Agustín", precioUSD: 2 }, { nombre: "Candelaria", precioUSD: 2 },
    { nombre: "San Juan", precioUSD: 3 }, { nombre: "Catedral", precioUSD: 3 },
    { nombre: "Santa Rosalía", precioUSD: 3 }, { nombre: "El Recreo", precioUSD: 4 },
    { nombre: "La Candelaria", precioUSD: 2 }, { nombre: "San Pedro", precioUSD: 4 },
    { nombre: "El Paraíso", precioUSD: 4 }, { nombre: "La Vega", precioUSD: 4 },
    { nombre: "El Valle", precioUSD: 5 }, { nombre: "Coche", precioUSD: 5 },
    { nombre: "Caricuao", precioUSD: 7 }, { nombre: "Antímano", precioUSD: 7 },
    { nombre: "Macarao", precioUSD: 7 }, { nombre: "23 de Enero", precioUSD: 4 },
    { nombre: "La Pastora", precioUSD: 3 }, { nombre: "Altagracia", precioUSD: 3 },
    { nombre: "Santa Teresa", precioUSD: 3 }, { nombre: "Santa Rosalía de Palermo", precioUSD: 3 },
    { nombre: "Chacao", precioUSD: 5 }, { nombre: "Leoncio Martínez", precioUSD: 6 },
    { nombre: "Petare", precioUSD: 6 }, { nombre: "La Dolorita", precioUSD: 6 },
    { nombre: "Fila de Mariches", precioUSD: 6 }, { nombre: "Caucagüita", precioUSD: 7 },
    { nombre: "El Cafetal", precioUSD: 6 }, { nombre: "Las Minas", precioUSD: 5 },
    { nombre: "Nuestra Señora del Rosario", precioUSD: 7 }, { nombre: "Sucre", precioUSD: 7 },
    { nombre: "El Junquito", precioUSD: 7 }
];

window.categoriasMenu = {
    "entradas":  [],
    "sushi":     [],
    "rolls":     ["Rolls Fríos de 10 piezas", "Rolls Tempura de 12 piezas"],
    "tragos":    [],
    "pokes":     [],
    "ensaladas": [],
    "china":     ["Arroz Chino","Arroz Cantones","Chopsuey","Lomey","Chow Mein","Fideos de Arroz","Tallarines Cantones","Mariscos","Foo Yong","Sopas","Entremeses"],
    "japonesa":  ["Yakimeshi","Yakisoba","Pasta Udon","Churrasco"],
    "ofertas":   [],
    "ninos":     [],
    "ejecutivo": []
};
window.categoriasMenuLabels = {
    "entradas":"Entradas","sushi":"Sushi","rolls":"Rolls",
    "tragos":"Tragos y bebidas","pokes":"Pokes","ensaladas":"Ensaladas",
    "china":"Comida China","japonesa":"Comida Japonesa",
    "ofertas":"Ofertas Especiales","ninos":"Para Niños","ejecutivo":"Combo Ejecutivo"
};

// ============================================
// FUNCIONES DE NOTIFICACIONES (SONIDO Y BADGE)
// ============================================
window.reproducirSonidoNotificacion = function() {
    const audio = document.getElementById('notificationSound');
    if (audio) {
        audio.pause();
        audio.currentTime = 0;
        audio.play().catch(e => console.log('Error reproduciendo sonido:', e));
    }
    if (navigator.vibrate) {
        navigator.vibrate([200, 100, 200]);
    }
};

window.actualizarBadgeNotificaciones = function(conteo) {
    const badge = document.getElementById('notificationBadge');
    if (badge) {
        if (conteo > 0) {
            badge.textContent = conteo;
            badge.style.display = 'block';
            badge.classList.add('has-unread');
            badge.style.animation = 'none';
            badge.offsetHeight;
            badge.style.animation = 'vibrate .3s ease';
        } else {
            badge.style.display = 'none';
            badge.classList.remove('has-unread');
        }
    }
};

// ============================================
// FUNCIÓN AUXILIAR PARA WIFI (cliente)
// ============================================
window._mostrarPantallaWifi = function(wifiSsid, wifiPwd) {
    document.body.innerHTML = `
        <div style="min-height:100vh;display:flex;flex-direction:column;align-items:center;justify-content:center;
            background:linear-gradient(135deg,#1a1a2e,#16213e);color:#fff;padding:2rem;text-align:center;font-family:Roboto,sans-serif">
            <div style="font-size:3rem;margin-bottom:1rem">📶</div>
            <h2 style="color:#FF9800;font-size:1.4rem;margin-bottom:.75rem">Conéctate al WiFi del restaurante</h2>
            <p style="font-size:1rem;opacity:.85;margin-bottom:1.5rem">Para acceder al menú necesitas estar conectado a:</p>
            <div style="background:rgba(255,255,255,.1);border-radius:12px;padding:1.2rem 2rem;margin-bottom:2rem;border:1px solid rgba(255,255,255,.2)">
                <div style="font-size:1.3rem;font-weight:700;color:#fff;letter-spacing:1px">${wifiSsid}</div>
                ${wifiPwd ? '<div style="font-size:.85rem;opacity:.6;margin-top:.3rem">Contraseña: ' + wifiPwd + '</div>' : ''}
            </div>
            <p style="font-size:.85rem;opacity:.65;margin-bottom:2rem">Ve a Ajustes → WiFi, conéctate a la red y luego toca:</p>
            <button onclick="window.location.reload()" 
                style="background:linear-gradient(135deg,#D32F2F,#B71C1C);color:#fff;border:none;padding:.9rem 2rem;
                border-radius:10px;font-size:1rem;font-weight:700;cursor:pointer;letter-spacing:.5px;margin-bottom:1rem">
                🔄 Ya me conecté — Abrir Menú
            </button>
            <p style="font-size:.75rem;opacity:.4">O escanea el QR nuevamente</p>
        </div>
    `;
};

console.log('✅ supabase-config.js cargado correctamente');
console.log('   - Anon key:', window.SUPABASE_ANON_KEY ? '✅' : '❌');
console.log('   - VAPID Public Key:', window.VAPID_PUBLIC_KEY ? '✅' : '❌');
console.log('   - GMT-4 functions:', typeof window.formatearFechaGMT4 === 'function' ? '✅' : '❌');