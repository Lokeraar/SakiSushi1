#!/usr/bin/env node
/**
 * Genera una artboard por CADA ventana y modal del panel de administración,
 * ejecutando el código real del proyecto sobre un DOM simulado.
 *
 * ── Por qué así y no dibujado a mano ──────────────────────────────────────
 *
 * El usuario quiere corregir el panel mirándolo con sus propios ojos. Un
 * artboard dibujado a mano mostraría la idea de quien lo dibuja, no lo que el
 * panel hace hoy. Todas esas pestañas las puebla el JS (la tabla de menú, la
 * grilla de inventario, las gráficas de reportes). Un HTML estático las dejaría
 * vacías y el canvas mostraría un panel que no existe.
 *
 * Por eso: se toma el markup real de admin/index.html, se carga en linkedom y
 * se corren los mismos módulos que corre el navegador, alimentados con datos
 * de prueba con la forma exacta de la base.
 *
 * ── La regla que no se rompe ──────────────────────────────────────────────
 *
 * Nada de HTML de interfaz inventado. El markup sale de admin/index.html; lo
 * dinámico sale de ejecutar admin-*.js. Lo único inventado son los DATOS.
 *
 * ── Trampa ya conocida ────────────────────────────────────────────────────
 *
 * Un contexto `vm` NUEVO por cada vista. Si dos vistas comparten el DOM, los
 * módulos corren dos veces sobre el mismo documento e insertan dos veces sus
 * botones con el mismo id. Ya pasó con "Consultar el BCV".
 *
 *   node design/panel-admin-completo/snapshot.js
 */

const fs = require('fs');
const path = require('path');
const vm = require('vm');
const { parseHTML } = require(
  '/data/data/com.termux/files/home/.gentle-shell/agent/npm/node_modules/linkedom'
);

const ROOT = path.resolve(__dirname, '..', '..');
const read = (rel) => fs.readFileSync(path.join(ROOT, rel), 'utf8');

// ── 1. Vistas a generar ───────────────────────────────────────────────────
//
// `pane` es el id real del contenedor en admin/index.html. `js` son los
// módulos que hay que cargar para que la pestaña tenga contenido; `run` es la
// función pública del proyecto que la puebla. Nada de esto se inventa: cada
// entrada se comprobó contra el código.
const VIEWS = [
  {
    file: '01-inicio.html', title: 'Inicio', pane: 'dashboardPane', width: 390,
    tradeoff: 'Vista completa del pulso del local; no muestra la densidad de datos que sí aparece en escritorio',
    js: ['admin/js/admin-tasa-panel.js', 'admin/js/admin-cierre.js',
         'admin/js/admin-platillo-estrella.js', 'admin/js/admin-config.js'],
  },
  {
    file: '02-menu.html', title: 'Menú', pane: 'menuPane', width: 390,
    tradeoff: 'Se ve la grilla de platillos como en el teléfono; los filtros por categoría quedan apilados',
    js: ['admin/js/admin-menu.js', 'admin/js/admin-ofertas.js', 'admin/js/admin-secciones.js'],
    run: 'cargarMenu',
  },
  {
    file: '03-inventario.html', title: 'Inventario', pane: 'inventarioPane', width: 390,
    tradeoff: 'Muestra el stock real con reservas descontadas; el semáforo se lee de un vistazo',
    js: ['admin/js/admin-inventario.js'],
    run: 'cargarInventario',
  },
  {
    file: '04-usuarios.html', title: 'Usuarios', pane: 'usuariosPane', width: 390,
    tradeoff: 'Lista compacta de quién puede entrar; no muestra permisos granulares',
    js: ['admin/js/admin-usuarios.js'],
    run: 'cargarUsuarios',
  },
  {
    file: '05-deliverys.html', title: 'Deliverys', pane: 'deliverysPane', width: 390,
    tradeoff: 'Centra la atención en los motorizados y su estado; el historial de viajes queda aparte',
    js: ['admin/js/admin-delivery.js'],
    run: 'cargarDeliverys',
  },
  {
    file: '06-mesoneros.html', title: 'Mesoneros', pane: 'mesonerosPane', width: 390,
    tradeoff: 'Prioriza las propinas del día; el alta de mesonero compite por espacio',
    js: ['admin/js/admin-mesoneros.js'],
    run: 'cargarMesoneros',
  },
  {
    file: '07-qr.html', title: 'Códigos QR', pane: 'qrPane', width: 390,
    tradeoff: 'Los QR se ven a tamaño de lectura; la generación en lote queda abajo',
    js: ['admin/js/admin-qr.js'],
    run: 'cargarQRs',
  },
  {
    file: '08-reportes.html', title: 'Reportes', pane: 'reportesPane', width: 390,
    tradeoff: 'Expone el hueco real: las cuatro gráficas están vacías porque Chart.js no se carga',
    js: ['admin/js/admin-reportes.js'],
    run: 'cargarReportes',
  },
];

// ── 1b. Modales ───────────────────────────────────────────────────────────
//
// Un modal abierto no es una ventana aparte: es la ventana de fondo, atenuada,
// con el modal encima. Por eso cada artboard conserva el panel completo detrás
// y se marca la clase `active` en el modal correspondiente, que es exactamente
// lo que hace el proyecto al abrirlo.
//
// `run` es la función real del proyecto que llena el modal. Si recibe un id,
// se le pasa uno de los datos de prueba para que muestre el modo "editar" y no
// solo el "nuevo" vacío.
const MODALES = [
  {
    file: '10-modal-platillo.html', title: 'Modal · Nuevo platillo',
    modal: 'platilloModal', pane: 'menuPane', width: 390,
    tradeoff: 'Muestra el formulario completo con sus campos de precio e imagen; el fondo queda atenuado',
    js: ['admin/js/admin-menu.js', 'admin/js/admin-ofertas.js', 'admin/js/admin-secciones.js'],
    run: 'abrirModalNuevoPlatillo',
  },
  {
    file: '11-modal-ingrediente.html', title: 'Modal · Nuevo ingrediente',
    modal: 'ingredienteModal', pane: 'inventarioPane', width: 390,
    tradeoff: 'Expone unidad, stock inicial y mínimo en una sola columna; el mínimo es el que decide la marquesina',
    js: ['admin/js/admin-inventario.js'],
    run: 'abrirModalNuevoIngrediente',
  },
  {
    file: '12-modal-usuario.html', title: 'Modal · Nuevo usuario',
    modal: 'usuarioModal', pane: 'usuariosPane', width: 390,
    tradeoff: 'Deja ver los roles disponibles y el estado activo; no explica qué puede hacer cada rol',
    js: ['admin/js/admin-usuarios.js'],
    run: 'abrirModalNuevoUsuario',
  },
  {
    file: '13-modal-pago.html', title: 'Modal · Registrar pago',
    modal: 'pagoModal', pane: 'mesonerosPane', width: 390,
    tradeoff: 'El desglose por método de pago cabe en una columna; los montos en Bs y USD compiten por ancho',
    js: ['admin/js/admin-mesoneros.js'],
    run: 'abrirModalPago',
  },
  {
    file: '14-modal-cierre.html', title: 'Modal · Local operativo',
    modal: 'cierreModal', pane: 'dashboardPane', width: 390,
    tradeoff: 'Los cuatro modos del local con su consecuencia visible; el texto explicativo alarga el modal',
    js: ['admin/js/admin-cierre.js', 'admin/js/admin-config.js'],
    run: 'abrirModalCierre',
  },
  {
    file: '15-modal-qr-mesa.html', title: 'Modal · Elegir mesa para QR',
    modal: 'adminMesaModal', pane: 'qrPane', width: 390,
    tradeoff: 'Lista de mesas para generar el QR de una; se pierde la vista previa del código',
    js: ['admin/js/admin-qr.js'],
    run: 'abrirSelectorMesaAdmin',
  },
];

// ── 2. Markup real, recortado al panel ────────────────────────────────────
const htmlSrc = read('admin/index.html');

// Los comentarios del archivo nombran etiquetas. Sin ignorarlos, el conteo de
// `<div>` se cierra antes de tiempo y el recorte sale corto.
const inComment = new Uint8Array(htmlSrc.length);
for (const m of htmlSrc.matchAll(/<!--[\s\S]*?-->/g)) {
  for (let k = m.index; k < m.index + m[0].length; k++) inComment[k] = 1;
}
const find = (tag, from) => {
  let pos = from;
  for (;;) {
    pos = htmlSrc.indexOf(tag, pos);
    if (pos === -1 || !inComment[pos]) return pos;
    pos += tag.length;
  }
};

/** Devuelve el bloque completo de un elemento por su id, contando anidamiento. */
function bloquePorId(id) {
  const start = htmlSrc.indexOf(`id="${id}"`);
  if (start < 0) return null;
  // Se retrocede hasta la etiqueta de apertura que contiene ese id.
  const abre = htmlSrc.lastIndexOf('<', start);
  const etiqueta = htmlSrc.slice(abre, htmlSrc.indexOf('>', abre) + 1);
  // Un elemento que se cierra en su propia etiqueta no sirve como contenedor.
  if (etiqueta.endsWith('/>') || /^<(input|img|br|hr|meta|link)\b/i.test(etiqueta)) return null;

  let depth = 0;
  let i = abre;
  for (;;) {
    const o = find('<div', i);
    const c = find('</div>', i);
    if (c === -1) return null;
    if (o !== -1 && o < c) { depth += 1; i = o + 4; }
    else {
      depth -= 1;
      i = c + 6;
      if (depth === 0) return htmlSrc.slice(abre, i);
    }
  }
}

// El contenedor de todas las pestañas. Se toma entero y luego se deja visible
// solo la pestaña pedida: así cada artboard conserva la barra de pestañas, que
// es parte de cómo se ve la ventana.
const panelStart = htmlSrc.indexOf('<div class="panel-container" id="panelContainer">');
if (panelStart < 0) throw new Error('no encontré el panelContainer');

let depth = 0;
let i = panelStart;
for (;;) {
  const o = find('<div', i);
  const c = find('</div>', i);
  if (c === -1) throw new Error('no encontré el cierre del panelContainer');
  if (o !== -1 && o < c) { depth += 1; i = o + 4; }
  else { depth -= 1; i = c + 6; if (depth === 0) break; }
}
const panelMarkup = htmlSrc.slice(panelStart, i);

// Los modales viven fuera del panel-container. Se traen todos: son parte de
// cada ventana y el artboard los muestra cerrados salvo el que corresponda.
const modales = [];
for (const id of ['bcvModal', 'cierreModal', 'platilloModal', 'ingredienteModal',
                  'usuarioModal', 'deliveryModal', 'mesoneroModal', 'pagoModal',
                  'qrAmpliadoModal', 'stockPasswordModal', 'adminMesaModal']) {
  const b = bloquePorId(id);
  if (b) modales.push(b);
}

const logos = {};
const logoB64 = fs.readFileSync(path.join(ROOT, 'assets/marca/logo-300.png')).toString('base64');
logos.logo = `data:image/png;base64,${logoB64}`;

// ── 3. Datos de prueba ────────────────────────────────────────────────────
//
// La forma de cada fila se copió de lo que el módulo consulta y de las
// columnas reales de la base. Los valores son verosímiles: platillos que el
// proyecto ya tiene, montos a la tasa del 2 de noviembre.
const TASA = 889.58;

const DATOS = {
  menu: [
    { id: 'plat_1', nombre: 'Nigiri de Atún (2 pcs)', categoria: 'Sushi', subcategoria: null,
      descripcion: '2 piezas de atún sobre arroz', precio: 6.50, disponible: true,
      imagen: '', ingredientes: { ing_1: { nombre: 'Arroz para sushi', cantidad: 0.06, principal: true } } },
    { id: 'plat_2', nombre: 'Dragon Roll', categoria: 'Rolls', subcategoria: 'Rolls Tempura de 12 piezas',
      descripcion: 'Roll relleno de camarón con aguacate', precio: 12.00, disponible: true,
      imagen: '', ingredientes: { ing_1: { nombre: 'Arroz para sushi', cantidad: 0.12, principal: true } } },
    { id: 'plat_3', nombre: 'California Roll', categoria: 'Rolls', subcategoria: 'Rolls Fríos de 10 piezas',
      descripcion: 'Cangrejo, aguacate y pepino', precio: 9.50, disponible: true,
      imagen: '', ingredientes: { ing_7: { nombre: 'Arroz para sushi', cantidad: 0.10, principal: true } } },
    { id: 'plat_4', nombre: 'Salmón Teriyaki', categoria: 'Sushi', subcategoria: null,
      descripcion: 'Filete de salmón con salsa teriyaki', precio: 15.00, disponible: true,
      imagen: '', ingredientes: { ing_2: { nombre: 'Salmón fresco', cantidad: 0.18, principal: true } } },
    { id: 'plat_5', nombre: 'Yakimeshi de Pollo', categoria: 'Comida China', subcategoria: 'Yakimeshi',
      descripcion: 'Arroz salteado con pollo y vegetales', precio: 8.00, disponible: true,
      imagen: '', ingredientes: { ing_8: { nombre: 'Arroz para sushi', cantidad: 0.15, principal: true } } },
    { id: 'plat_6', nombre: 'Té Verde Frío', categoria: 'Tragos y bebidas', subcategoria: null,
      descripcion: 'Té verde sin azúcar, 500 ml', precio: 3.00, disponible: true,
      imagen: '', ingredientes: {} },
  ],

  inventario: [
    { id: 'ing_1', nombre: 'Arroz para sushi', unidad: 'kilogramos', stock: 12.5, reservado: 2.1, minimo: 5 },
    { id: 'ing_2', nombre: 'Salmón fresco', unidad: 'kilogramos', stock: 3.2, reservado: 1.4, minimo: 4 },
    { id: 'ing_3', nombre: 'Atún fresco', unidad: 'kilogramos', stock: 1.8, reservado: 0.6, minimo: 3 },
    { id: 'ing_4', nombre: 'Aguacate', unidad: 'unidades', stock: 24, reservado: 6, minimo: 10 },
    { id: 'ing_5', nombre: 'Alga nori', unidad: 'paquetes', stock: 0, reservado: 0, minimo: 5 },
    { id: 'ing_6', nombre: 'Queso crema', unidad: 'kilogramos', stock: 4.0, reservado: 0.5, minimo: 2 },
  ],

  usuarios: [
    { id: 'u1', nombre: 'Christian', email: 'christiandrm123@gmail.com', rol: 'admin', activo: true },
    { id: 'u2', nombre: 'María González', email: 'maria@caja.saki', rol: 'cajero', activo: true },
    { id: 'u3', nombre: 'Luis Pérez', email: 'luis@caja.saki', rol: 'cajero', activo: true },
    { id: 'u4', nombre: 'Ana Rodríguez', email: 'ana@mesonero.saki', rol: 'mesonero', activo: false },
  ],

  deliverys: [
    { id: 'd1', nombre: 'Carlos Mendoza', telefono: '0414-1234567', activo: true, foto: '' },
    { id: 'd2', nombre: 'José Ramírez', telefono: '0424-7654321', activo: true, foto: '' },
    { id: 'd3', nombre: 'Pedro Silva', telefono: '0412-5556677', activo: false, foto: '' },
  ],

  mesoneros: [
    { id: 'm1', nombre: 'Ana Rodríguez', activo: true, foto: '' },
    { id: 'm2', nombre: 'Luis Pérez', activo: true, foto: '' },
  ],

  propinas: [
    { id: 'p1', mesonero_id: 'm1', monto_bs: 889.58, moneda_original: 'BS', monto_original: 889.58, fecha: '2026-11-02' },
    { id: 'p2', mesonero_id: 'm2', monto_bs: 1779.16, moneda_original: 'BS', monto_original: 1779.16, fecha: '2026-11-02' },
  ],

  codigos_qr: [
    { id: 'q1', mesa: 1, codigo: 'SAKI-MESA-1', activo: true, created_at: '2026-10-23' },
    { id: 'q2', mesa: 2, codigo: 'SAKI-MESA-2', activo: true, created_at: '2026-10-23' },
    { id: 'q3', mesa: 3, codigo: 'SAKI-MESA-3', activo: true, created_at: '2026-10-23' },
  ],

  pedidos: [
    { id: 'ped_1', fecha: '2026-11-02T12:14:00-04:00', tipo: 'mesa', total: 24.50, estado: 'entregado',
      cliente_nombre: 'Mesa 3', items: [{ nombre: 'Dragon Roll', cantidad: 2, precioUnitarioUSD: 12.00 }] },
    { id: 'ped_2', fecha: '2026-11-02T13:02:00-04:00', tipo: 'delivery', total: 18.00, estado: 'en_camino',
      cliente_nombre: 'Andrea', items: [{ nombre: 'California Roll', cantidad: 1, precioUnitarioUSD: 9.50 }] },
    { id: 'ped_3', fecha: '2026-11-01T20:30:00-04:00', tipo: 'mesa', total: 31.00, estado: 'entregado',
      cliente_nombre: 'Mesa 1', items: [{ nombre: 'Salmón Teriyaki', cantidad: 2, precioUnitarioUSD: 15.00 }] },
  ],
};

// ── 4. Cliente de Supabase falso ──────────────────────────────────────────
//
// Responde con la forma de supabase-js: { data, error }. Se encadena para que
// `from(...).select(...).eq(...).order(...)` funcione igual que en la app.
// Devuelve `this` desde cada método salvo los terminales, que ya resuelven.
function clienteFalso() {
  const consulta = (tabla) => {
    const filas = DATOS[tabla] || [];
    const api = {
      select: () => api,
      eq: () => api,
      neq: () => api,
      in: () => api,
      gte: () => api,
      lte: () => api,
      order: () => api,
      limit: () => api,
      single: () => Promise.resolve({ data: filas[0] || null, error: null }),
      maybeSingle: () => Promise.resolve({ data: filas[0] || null, error: null }),
      insert: () => Promise.resolve({ data: null, error: null }),
      update: () => api,
      delete: () => api,
      then: (ok) => Promise.resolve({ data: filas, error: null }).then(ok),
    };
    return api;
  };
  return {
    from: consulta,
    rpc: () => Promise.resolve({ data: null, error: null }),
    channel: () => ({ on: () => ({ subscribe: () => ({}) }), subscribe: () => ({}) }),
    removeChannel: () => {},
    auth: {
      getSession: () => Promise.resolve({ data: { session: null }, error: null }),
      onAuthStateChange: () => ({ data: { subscription: { unsubscribe() {} } } }),
      signOut: () => Promise.resolve({ error: null }),
    },
  };
}

// ── 5. Arranque de una vista ──────────────────────────────────────────────
async function render(view) {
  // Solo se deja la pestaña pedida como activa. El resto del markup se
  // conserva porque la barra de pestañas es parte de cómo se ve la ventana.
  let markup = panelMarkup;
  markup = markup.replace(/class="tab-pane active"/g, 'class="tab-pane"');
  markup = markup.replace(
    new RegExp(`class="tab-pane"([^>]*id="${view.pane}")`),
    'class="tab-pane active"$1'
  );

  const shell = `<!DOCTYPE html><html><head><meta charset="utf-8"></head><body>${markup}${modales.join('\n')}</body></html>`;
  const { window, document } = parseHTML(shell);

  // Lo mínimo que los módulos esperan del navegador.
  window.formatBs = (n) => 'Bs ' + Number(n || 0).toFixed(2).replace('.', ',');
  window.formatUSD = (n) => '$' + Number(n || 0).toFixed(2);
  window.esFormatoBs = (s) => String(s).trim().startsWith('Bs');
  window.usdToBs = (usd) => Number(usd || 0) * TASA;
  window.usdToBsBase = (usd) => Number(usd || 0) * TASA;
  window.tasaEfectivaActual = () => TASA;
  window.tasaBaseActual = () => TASA;
  window.TASA_RESPALDO = 400;
  window.mostrarToast = () => {};
  window.supabaseClient = clienteFalso();
  window.configGlobal = { tasa_efectiva: TASA, tasa_cambio: TASA, descuento_al_quitar: false,
                          alerta_stock_minimo: true, minutos_pago: 20 };
  window.charts = {};
  document.documentElement.classList = {
    add() {}, remove() {}, toggle() {}, contains: () => false,
  };

  // ── `form.reset()`, que linkedom no implementa ──
  //
  // Varios modales limpian el formulario al abrirse. En un navegador eso
  // devuelve cada campo a su valor inicial; en linkedom el método no existe y
  // la apertura se corta a la mitad, dejando el modal sin títulos ni listas.
  //
  // Se replica el comportamiento real sobre los controles del formulario, que
  // es lo que el navegador hace por dentro.
  // Ojo: linkedom NO crea `HTMLFormElement` al parsear. Un `<form>` sale como
  // `HTMLElement` pelado, así que parchear `HTMLFormElement.prototype` no sirve
  // —se comprobó: el objeto existe pero ningún form lo usa como prototipo—.
  // Hay que parchear `HTMLElement.prototype`, que es de donde cuelgan todos.
  const protoForm = window.HTMLElement && window.HTMLElement.prototype;
  if (protoForm && !protoForm.reset) {
    protoForm.reset = function () {
      if (this.tagName !== 'FORM') return; /* solo los form se comportan así */
      Array.prototype.forEach.call(this.querySelectorAll('input, select, textarea'), function (el) {
        if (el.type === 'checkbox' || el.type === 'radio') { el.checked = el.hasAttribute('checked'); }
        else if (el.tagName === 'SELECT') { el.selectedIndex = 0; }
        else { el.value = el.getAttribute('value') || ''; }
      });
    };
  }

  // ── Simulación de red ausente ──
  //
  // `cargarReportes()` intenta bajar Chart.js de un CDN. En linkedom un
  // <script> creado por JS nunca se descarga, así que ni `onload` ni `onerror`
  // disparan: la promesa queda colgada para siempre y el artboard no se genera.
  //
  // Se replica lo que pasa sin red: el script falla de inmediato. Es el mismo
  // camino que toma el teléfono con datos móviles malos, así que el artboard
  // muestra el estado degradado REAL, no uno inventado.
  const crearElementoOriginal = document.createElement.bind(document);
  document.createElement = function (etiqueta) {
    const el = crearElementoOriginal(etiqueta);
    if (String(etiqueta).toLowerCase() === 'script') {
      // El `src` se asigna después de crear el elemento; se intercepta para
      // avisar el fallo en el siguiente microtask, ya con los handlers puestos.
      let _src = '';
      Object.defineProperty(el, 'src', {
        get: () => _src,
        set: (v) => {
          _src = v;
          Promise.resolve().then(() => {
            if (typeof el.onerror === 'function') el.onerror(new Error('sin red'));
          });
        },
      });
    }
    return el;
  };

  const context = vm.createContext({
    window, document,
    console: { log() {}, warn() {}, error() {} },
    Date, Math, Number, String, JSON, Object, Array, Boolean, RegExp, Error,
    parseInt, parseFloat, isNaN, encodeURIComponent, decodeURIComponent,
    setTimeout: (f) => { try { if (typeof f === 'function') f(); } catch (e) {} return 0; },
    clearTimeout: () => {},
    setInterval: () => 0,
    clearInterval: () => {},
    Promise,
    localStorage: {
      _d: {},
      getItem(k) { return this._d[k] ?? null; },
      setItem(k, v) { this._d[k] = String(v); },
      removeItem(k) { delete this._d[k]; },
    },
  });

  // Los módulos se cargan en orden. Un módulo que falla no detiene el resto:
  // se avisa y se sigue, porque una pestaña sin un pedazo es mejor que ninguna.
  //
  // `admin-core.js` va primero SIEMPRE: es el que define los ayudantes que
  // todos los demás usan (`limpiarErroresInput`, `TASA_RESPALDO`, `usdToBs`).
  // En la app real se carga antes que cualquier otro módulo del panel; sin él,
  // abrir un modal se corta en la primera llamada.
  for (const rel of ['admin/js/admin-core.js', ...view.js]) {
    try {
      vm.runInContext(read(rel), context, { filename: rel });
    } catch (err) {
      console.log(`  aviso: ${rel} no cargó (${err.message})`);
    }
  }

  // La función pública que puebla la pestaña.
  if (view.run && typeof window[view.run] === 'function') {
    try {
      await window[view.run]();
      console.log(`  ${view.run}(): ok`);
    } catch (err) {
      console.log(`  ${view.run}() falló: ${err.message}`);
    }
  } else if (view.run) {
    console.log(`  aviso: ${view.run}() no existe`);
  }

  // El modal, si esta artboard es de un modal.
  //
  // Se marca `active` —que es lo que hace el proyecto al abrirlo— pero además
  // se ejecuta la función real de apertura, porque varias de ellas rellenan
  // campos (títulos, valores por defecto, listas de mesas).
  if (view.modal) {
    const m = document.getElementById(view.modal);
    if (m) m.classList.add('active');
    if (view.run && typeof window[view.run] === 'function') {
      try {
        await window[view.run]();
        console.log(`  ${view.run}(): ok`);
      } catch (err) {
        console.log(`  ${view.run}() falló: ${err.message}`);
      }
    } else if (view.run) {
      console.log(`  aviso: ${view.run}() no existe`);
    }
    // El modal puede haber quedado cerrado si la función de apertura falló:
    // se vuelve a marcar para que el artboard lo muestre igual.
    if (m) m.classList.add('active');
  }

  // Piezas que la app pinta con datos que no vienen de una consulta simple.
  const setText = (id, v) => { const el = document.getElementById(id); if (el) el.textContent = v; };
  if (view.pane === 'dashboardPane') {
    setText('ventasHoy', '$73.50 / Bs 65.386,13');
    setText('productosActivos', '6');
    setText('alertasStock', '3');
    setText('deliverysHoyDashboard', '$18.00 / Bs 16.012,44');
    setText('propinasHoyDashboard', 'Bs 2.668,74');
    setText('diferenciaTasaValor', 'Bs 0,00');
    setText('aumentoAcumuladoDisplay', '0.00%');
    setText('tasaEfectivaDisplay', TASA.toFixed(2));
  }

  // ── CSS real, sin nada remoto ──
  let css = read('admin/css/admin.css');
  css = css.replace(/@import\s+url\([^)]*\);?\n?/g, '');
  css = css.replace(/url\('https:\/\/[^']*'\)/g, 'none');
  css = css.replace(/url\("https:\/\/[^"]*"\)/g, 'none');

  // ── Fuentes locales embebidas ──
  const face = (family, rel) => {
    const b64 = fs.readFileSync(path.join(ROOT, rel)).toString('base64');
    return `@font-face{font-family:'${family}';font-style:normal;font-weight:100 900;font-display:swap;` +
      `src:url(data:font/woff2;base64,${b64}) format('woff2')}`;
  };
  const fonts =
    face('Montserrat', 'assets/fonts/Montserrat-400-latin-ext.woff2') +
    face('Playfair Display', 'assets/fonts/PlayfairDisplay-400-latin-ext.woff2');

  // ── Iconos: se recogen los que el markup realmente usa ──
  //
  // Antes había un mapa fijo y aparecían cuadrados vacíos donde faltaba uno.
  // Ahora se buscan todas las clases fa-* del documento y se resuelven contra
  // el CSS real de Font Awesome.
  const faSrc = read('assets/fontawesome/all.min.css');
  const usados = new Set();
  for (const m of document.body.innerHTML.matchAll(/\bfa-([a-z0-9-]+)\b/g)) {
    usados.add(m[1]);
  }
  // Alias que Font Awesome resuelve por su cuenta y no aparecen como .fa-x:before
  const alias = { solid: null, fw: null, lg: null, sm: null, xs: null, '2x': null, '3x': null, spin: null };
  const reglas = [];
  for (const nombre of usados) {
    if (alias[nombre] === null) continue;
    const m = faSrc.match(new RegExp(`\\.fa-${nombre.replace(/-/g, '\\-')}:before\\{content:"(\\\\[0-9a-f]+)"`));
    if (m) reglas.push(`.fa-${nombre}::before{content:"${m[1]}"}`);
  }
  const faWoff = fs.readFileSync(path.join(ROOT, 'assets/fontawesome/webfonts/fa-solid-900.woff2')).toString('base64');
  const faCss =
    `@font-face{font-family:'Font Awesome 6 Free';font-style:normal;font-weight:900;font-display:block;` +
    `src:url(data:font/woff2;base64,${faWoff}) format('woff2')}` +
    `.fas,.fa-solid{font-family:'Font Awesome 6 Free';font-weight:900;-webkit-font-smoothing:antialiased;` +
    `display:inline-block;font-style:normal;font-variant:normal;line-height:1;text-rendering:auto}` +
    reglas.join('');

  // ── Logos: se reemplaza la URL remota por el archivo del repo ──
  let body = document.body.innerHTML;
  body = body.replace(/src="https:\/\/lh3\.googleusercontent\.com\/[^"]*"/g, `src="${logos.logo}"`);
  body = body.replace(/url\(['"]?https:\/\/lh3\.googleusercontent\.com[^)]*\)/g, `url(${logos.logo})`);

  const doc = `<!DOCTYPE html>
<html lang="es">
<head>
<meta charset="UTF-8">
<meta name="viewport" content="width=${view.width}, initial-scale=1">
<title>Panel admin · ${view.title} (${view.width}px)</title>
<!--
  Artboard generado desde el código real, no dibujado a mano.

    markup ............ admin/index.html (recortado a la pestaña «${view.title}»)
    contenido dinámico  ejecución de ${view.js.join(', ')}
    estilos ........... admin/css/admin.css, con lo remoto quitado
    iconos ............ resueltos contra assets/fontawesome/all.min.css
    datos ............. verosímiles; es lo único inventado

  Regenerar con: node design/panel-admin-completo/snapshot.js
-->
<style>${fonts}</style>
<style>${faCss}</style>
<style>${css}</style>
<style>
  /* Lo mínimo para que el snapshot se comporte como la app: el panel real
     arranca con login delante y su JS lo muestra al autenticar. */
  html, body { margin: 0; }
  html { width: ${view.width}px; }
  body { width: ${view.width}px; }
  .panel-container { display: flex !important; }
  .login-container { display: none !important; }
</style>
</head>
<body>
${body}
<script>
  // Tema oscuro, que es el estado real del panel.
  document.documentElement.classList.add('dark-theme');
</script>
</body>
</html>
`;

  return doc;
}

// ── 6. Ejecutar ───────────────────────────────────────────────────────────
(async () => {
  for (const view of [...VIEWS, ...MODALES]) {
    console.log(`\n${view.file} · ${view.title} · ${view.width}px`);
    const doc = await render(view);
    const out = path.join(__dirname, view.file);
    fs.writeFileSync(out, doc, 'utf8');
    const kb = (Buffer.byteLength(doc) / 1024).toFixed(0);
    const urls = (doc.match(/https?:\/\//g) || []).length;
    console.log(`  ${kb} KB · urls externas: ${urls}`);
  }

  // Manifiesto del canvas.
  const manifesto = {
    title: 'Panel de administración · todas las ventanas',
    brief: 'Cada ventana del panel admin de Saki Sushi, generada desde el código real, para revisar y corregir desde lo que ve el usuario.',
    artboards: [...VIEWS, ...MODALES].map((v) => ({
      file: v.file,
      title: v.title,
      tradeoff: v.tradeoff,
      width: v.width,
      height: 1400,
    })),
  };
  fs.writeFileSync(
    path.join(__dirname, 'design.json'),
    JSON.stringify(manifesto, null, 2) + '\n',
    'utf8'
  );
  console.log(`\ndesign.json · ${VIEWS.length + MODALES.length} artboards`);
})().catch((err) => {
  console.error(err);
  process.exit(1);
});
