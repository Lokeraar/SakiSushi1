#!/usr/bin/env node
/**
 * Renderiza el estado real del dashboard de Inicio ejecutando los
 * renderizadores del proyecto sobre un DOM simulado.
 *
 * Por qué esto y no un HTML dibujado a mano: media pantalla del Inicio la
 * pinta el JS (el cuadro de la tasa del BCV, el cierre del local, el platillo
 * estrella, los pedidos recientes). Un artboard estático los dejaría vacíos y
 * el canvas mostraría un panel que no existe.
 *
 * Cómo: se toma el markup real de admin/index.html, se carga en linkedom y se
 * corren los mismos módulos que corre el navegador, alimentados con los datos
 * que muestra la captura del 30/10 a las 15:21.
 *
 * Lo único inventado es el contenido de los datos: la tasa 889,26 de
 * dolarapi.com, los seis productos activos, el local abierto. El HTML que sale
 * es el que produce el código del proyecto.
 *
 *   node design/dashboard-inicio/snapshot.js
 */

const fs = require('fs');
const path = require('path');
const vm = require('vm');
const { parseHTML } = require(
  '/data/data/com.termux/files/home/.gentle-shell/agent/npm/node_modules/linkedom'
);

const ROOT = path.resolve(__dirname, '..', '..');
// Dos vistas del mismo panel. El layout del proyecto es mobile-first: debajo de
// 768px muestra header-mobile y apila todo; arriba muestra header-desktop. Son
// pantallas distintas, no la misma con zoom, así que se generan por separado.
const VIEWS = {
  // 390 y no 412: el iframe del canvas se dibuja a su ancho de diseño y el
  // teléfono menos el chrome del canvas deja menos de 412. 390 entra sin
  // recorte y sigue siendo un ancho de teléfono real (iPhone 12/13/14).
  '00-estado-actual-movil.html':    { label: 'móvil',    width: 390 },
  '00-estado-actual-escritorio.html': { label: 'escritorio', width: 1440 },
};
const read = (rel) => fs.readFileSync(path.join(ROOT, rel), 'utf8');

// ── 1. Markup real del panel, recortado al pane de Inicio ──────────────────
const htmlSrc = read('admin/index.html');

const start = htmlSrc.indexOf('<div class="panel-container" id="panelContainer">');
const paneStart = htmlSrc.indexOf('<div class="tab-pane active" id="dashboardPane">', start);
if (start < 0 || paneStart < 0) throw new Error('no encontré el panel de Inicio');

// Los comentarios del archivo nombran etiquetas, así que el conteo los ignora:
// sin esto el bloque se cierra antes de tiempo.
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

let depth = 0;
let i = paneStart;
for (;;) {
  const open = find('<div', i);
  const close = find('</div>', i);
  if (close === -1) throw new Error('no encontré el cierre del dashboardPane');
  if (open !== -1 && open < close) {
    depth += 1;
    i = open + 4;
  } else {
    depth -= 1;
    i = close + 6;
    if (depth === 0) break;
  }
}

let markup = htmlSrc.slice(start, i);
const leftOpen = (markup.match(/<div\b/g) || []).length - markup.split('</div>').length + 1;
if (leftOpen !== 2) throw new Error(`el recorte quedó desbalanceado (${leftOpen} div abiertos)`);
markup = markup.trimEnd() + '\n        </div>\n    </div>'; // content + panelContainer

// El modal de cierre del local vive fuera del panel-container, así que el
// recorte de arriba no lo incluye. Se trae igual: es parte de Inicio desde que
// el bloque salió del tasa-cards-bar.
{
  // El modal del BCV tambien vive fuera del panel-container.
  const iniBcv = htmlSrc.indexOf('<div class="modal" id="bcvModal">');
  if (iniBcv !== -1) {
    let d = 0;
    let k = iniBcv;
    for (;;) {
      const o = htmlSrc.indexOf('<div', k);
      const c = htmlSrc.indexOf('</div>', k);
      if (o !== -1 && o < c) { d += 1; k = o + 4; }
      else { d -= 1; k = c + 6; if (d === 0) break; }
    }
    markup = htmlSrc.slice(iniBcv, k) + '\n' + markup;
  }
}
{
  const ini = htmlSrc.indexOf('<div class="modal" id="cierreModal">');
  if (ini !== -1) {
    let d = 0;
    let k = ini;
    for (;;) {
      const o = htmlSrc.indexOf('<div', k);
      const c = htmlSrc.indexOf('</div>', k);
      if (o !== -1 && o < c) { d += 1; k = o + 4; }
      else { d -= 1; k = c + 6; if (d === 0) break; }
    }
    // Se copia tal cual, cerrado, como en la app. El botón lo abre abajo.
    const modal = htmlSrc.slice(ini, k);
    markup = modal + '\n' + markup;
  }
}

// El logo real vive en Supabase; se usa el mismo archivo que versiona el repo.
const logoB64 = fs.readFileSync(path.join(ROOT, 'assets/marca/logo-300.png')).toString('base64');
markup = markup.replace(
  /src="https:\/\/lh3\.googleusercontent\.com\/[^"]*"/g,
  `src="data:image/png;base64,${logoB64}"`
);

// ── 2. DOM simulado con el markup real ────────────────────────────────────
const shell = `<!DOCTYPE html><html><head><meta charset="utf-8"></head><body>${markup}</body></html>`;
const { window, document } = parseHTML(shell);

// Lo mínimo que el código del proyecto espera encontrar en `window`.
window.formatBs = (n) => 'Bs ' + Number(n || 0).toFixed(2).replace('.', ',');
window.formatUSD = (n) => '$' + Number(n || 0).toFixed(2);
window.mostrarToast = () => {};
window.supabaseClient = null;
window.configGlobal = { tasa_efectiva: 889.26, tasa_cambio: 889.26 };
document.documentElement.classList = { add() {}, remove() {}, toggle() {}, contains: () => false };

const sandbox = {
  window,
  document,
  console: { log() {}, warn() {}, error() {} },
  Date,
  Math,
  Number,
  String,
  JSON,
  parseInt,
  parseFloat,
  isNaN,
  setTimeout: () => 0,
  clearTimeout: () => {},
  setInterval: () => 0,
  clearInterval: () => {},
  Promise,
};
const context = vm.createContext(sandbox);

function runModule(rel) {
  try {
    vm.runInContext(read(rel), context, { filename: rel });
    return true;
  } catch (err) {
    console.error(`  aviso: ${rel} no cargó (${err.message})`);
    return false;
  }
}

// ── 3. Renderizadores reales del proyecto ────────────────────────────────
async function render(view) {
console.log('renderizadores:');
runModule('admin/js/admin-tasa-panel.js');
runModule('admin/js/admin-cierre.js');
runModule('admin/js/admin-platillo-estrella.js');
runModule('admin/js/admin-config.js');

// El cuadro de la tasa del BCV. Los datos son los de la captura; la forma del
// HTML la decide tasa_panel.js.
if (typeof window.renderizarTasaPanel === 'function') {
  // `_datos` es privado del módulo: se entra por la única puerta pública, que
  // es cargarTasaPanel(). Se le da un cliente falso que responde el RPC.
  window.supabaseClient = {
    rpc: async () => ({
      data: {
        bcv: { valor: 889.26, fecha_valor: '2026-10-30', dias_atras: 0, fuente: 'dolarapi.com', es_principal: true },
        proxima: null,
        aplicada: { tasa_cambio: 889.26, tasa_efectiva: 889.26 },
        diferencia: { porcentaje: 0, signo: 'igual', es_igual: true, requiere_revision: false, umbral_porcentaje: 0.5, bolivares: 0, por_100_usd: 0 },
        revision: { ya_revisada: true, accion: 'mantener', revisada_por: 'Administrador', captura_fallo_hoy: false, dato_viejo: false },
        por_confirmar: [],
        cadena_hoy: [{ fuente: 'dolarapi.com', estado: 'ok', hora: '11:52', detalle: '' }],
        capturas: [{}, {}, {}, {}, {}],
      },
      error: null,
    }),
  };
  const panel = document.getElementById('tasaBcvPanel');
  if (panel) panel.style.display = '';
  await window.cargarTasaPanel();
  const panelHtml = document.getElementById('tasaBcvPanel').innerHTML;
  console.log('  tasa_panel: ' + (panelHtml.length > 100 ? 'ok' : 'vacío'));
}

// El modal del BCV con sus dos opciones. Se ejecuta abrirModalBCV() real,
// alimentado con las tasas que la base ya tiene capturadas.
if (typeof window.abrirModalBCV === 'function') {
  window.supabaseClient = {
    rpc: async () => ({
      data: {
        bcv: { valor: 889.26, fecha_valor: '2026-10-30', dias_atras: 0, fuente: 'dolarapi.com', es_principal: true },
        proxima: { valor: 895.40, fecha_valor: '2026-10-31', dias_para: 1, fuente: 'dolarapi.com' },
        aplicada: { tasa_cambio: 889.26, tasa_efectiva: 889.26 },
        diferencia: {}, revision: {}, por_confirmar: [], cadena_hoy: [], capturas: [],
      },
      error: null,
    }),
  };
  await window.abrirModalBCV();
  console.log('  modal BCV: ' + (document.getElementById('bcvOpciones').innerHTML.includes('bcv-opcion') ? 'ok' : 'vacío'));
}

// El cierre del local: local abierto, con sus chips de sugerencia.
if (typeof window.renderizarEstadoCierre === 'function') {
  window.renderizarEstadoCierre(null);
  console.log('  cierre: ok');
}

// El platillo estrella sin ventas: es lo que muestra la captura. Se entra por
// la función pública del módulo, que sin token JWT cae en mostrarSinVentas().
if (typeof window.cargarTopVentasCliente === 'function') {
  await window.cargarTopVentasCliente();
  const t = document.getElementById('platilloEstrellaTitulo');
  console.log('  platillo estrella: ' + (t && t.textContent ? 'ok' : 'vacío'));
}

// ── 4. Piezas que en la app pinta el JS pero acá no hay renderizador puro ──
// Se calcan del estado observado, no se inventan: son textos fijos que el
// código del proyecto escribe con `textContent`.
const setText = (id, value) => {
  const el = document.getElementById(id);
  if (el) el.textContent = value;
};
setText('ventasHoy', '$0.00 / Bs 0.00');
setText('productosActivos', '6');
setText('alertasStock', '0');
setText('deliverysHoyDashboard', '$0.00 / Bs 0,00');
setText('propinasHoyDashboard', '$0.00 / Bs 0,00');
setText('diferenciaTasaValor', 'Bs 0,00');
setText('stockCritico', 'No hay alertas de stock');
setText('pedidosRecientes', 'No hay pedidos recientes');
setText('aumentoAcumuladoDisplay', '0.00%');
setText('tasaEfectivaDisplay', '889.26');
setText('tasaBaseInput', '');
setText('aumentoDiarioInput', '');

// El botón "Consultar el BCV" lo agrega admin-config.js al cargar.
const saveWrap = document.querySelector('.tcb-save-wrap');
if (saveWrap && !document.getElementById('btnObtenerTasaBCV')) {
  const btn = document.createElement('button');
  btn.id = 'btnObtenerTasaBCV';
  btn.className = 'btn-secondary tcb-save-btn';
  btn.setAttribute('style', 'margin-left:8px');
  btn.innerHTML = '<i class="fas fa-satellite-dish"></i> Consultar<br>el BCV';
  saveWrap.appendChild(btn);
}

// El modal BCV se deja cerrado en el snapshot: en el canvas se abre tocando
// "Consultar el BCV", igual que en la app.
{
  const m = document.getElementById('bcvModal');
  if (m) m.classList.remove('active');
}

// ── 5. CSS real ───────────────────────────────────────────────────────────
let css = read('admin/css/admin.css');
css = css.replace(/@import\s+url\([^)]*\);?\n?/g, '');   // Google Fonts
css = css.replace(/url\('https:\/\/[^']*'\)/g, 'none');   // fondo del login

// ── 6. Fuentes e iconos locales, embebidos ───────────────────────────────
const face = (family, rel) => {
  const b64 = fs.readFileSync(path.join(ROOT, rel)).toString('base64');
  return `@font-face{font-family:'${family}';font-style:normal;font-weight:100 900;font-display:swap;` +
    `src:url(data:font/woff2;base64,${b64}) format('woff2')}`;
};
// Una sola cara por familia: es lo que hace el proyecto, donde todos los pesos
// declarados apuntan al archivo de 400 y el navegador dibuja el resto.
const fonts =
  face('Montserrat', 'assets/fonts/Montserrat-400-latin-ext.woff2') +
  face('Playfair Display', 'assets/fonts/PlayfairDisplay-400-latin-ext.woff2');

const icons = {
  'home': 'f015', 'utensils': 'f2e7', 'chevron-left': 'f053', 'chevron-right': 'f054',
  'cash-register': 'f788', 'sign-out-alt': 'f2f5', 'exclamation-triangle': 'f071',
  'save': 'f0c7', 'store-slash': 'e071', 'store': 'f54e', 'lock': 'f023',
  'dollar-sign': '24', 'coins': 'f51e', 'chart-line': 'f201',
  'external-link-alt': 'f35d', 'clock': 'f017', 'receipt': 'f543', 'inbox': 'f01c',
  'trash-alt': 'f2ed', 'arrow-left': 'f060', 'satellite-dish': 'f7c0',
  'triangle-exclamation': 'f071', 'forward': 'f04e', 'pen': 'f304', 'check': 'f00c',
  'building-columns': 'f19c', 'circle-check': 'f058', 'circle-xmark': 'f057',
  'circle-question': 'f059', 'diagram-project': 'f542', 'clock-rotate-left': 'f1da',
  'plug-circle-xmark': 'e560', 'rotate': 'f2f1', 'spinner': 'f110',
};
const faWoff = fs.readFileSync(path.join(ROOT, 'assets/fontawesome/webfonts/fa-solid-900.woff2')).toString('base64');
const faCss =
  `@font-face{font-family:'Font Awesome 6 Free';font-style:normal;font-weight:900;font-display:block;` +
  `src:url(data:font/woff2;base64,${faWoff}) format('woff2')}` +
  `.fas,.fa-solid{font-family:'Font Awesome 6 Free';font-weight:900;-webkit-font-smoothing:antialiased;` +
  `display:inline-block;font-style:normal;font-variant:normal;line-height:1;text-rendering:auto}` +
  Object.entries(icons).map(([n, c]) => `.fa-${n}::before{content:"\\${c}"}`).join('');

// ── 7. Documento final ───────────────────────────────────────────────────
const body = document.body.innerHTML;

const doc = `<!DOCTYPE html>
<html lang="es">
<head>
<meta charset="UTF-8">
<meta name="viewport" content="width=${view.width}, initial-scale=1">
<title>Dashboard · estado actual (${view.label})</title>
<!--
  Snapshot del panel real de Inicio. El markup sale de admin/index.html y las
  piezas que pinta el JS se generaron ejecutando admin-tasa-panel.js,
  admin-cierre.js y admin-platillo-estrella.js sobre un DOM simulado.
  Los assets locales (logo, tipografías, iconos) van embebidos porque el canvas
  solo sirve archivos .html.
  Regenerar con: node design/dashboard-inicio/snapshot.js
-->
<style>${fonts}</style>
<style>${faCss}</style>
<style>${css}</style>
<style>
  /* Solo lo mínimo para que el snapshot se comporte como la app: el panel real
     arranca oculto y su JS lo muestra al autenticar. */
  html, body { margin: 0; }
  /* El ancho de la vista se fija acá: el canvas muestra el artboard a su
     tamaño real y así se ven los media queries que corren en el teléfono. */
  html { width: ${view.width}px; }
  body { width: ${view.width}px; }
  .panel-container { display: flex !important; }
  .login-container { display: none; }
</style>
</head>
<body>
${body}
<script>
  // El botón de cierre del local. En la app lo cablea admin-cierre.js; acá solo
  // se replica ese enlace para poder abrir y cerrar el modal en el canvas.
  var _btnCierre = document.getElementById('btnAbrirCierre');
  var _modalCierre = document.getElementById('cierreModal');
  if (_btnCierre && _modalCierre) {
    _btnCierre.addEventListener('click', function () {
      _modalCierre.classList.add('active');
    });
    _modalCierre.addEventListener('click', function (e) {
      if (e.target === _modalCierre) _modalCierre.classList.remove('active');
    });
    Array.prototype.forEach.call(
      _modalCierre.querySelectorAll('[onclick*="cerrarModalCierre"]'),
      function (b) { b.onclick = function () { _modalCierre.classList.remove('active'); }; }
    );
  }

  // La interacción real del header: tema claro/oscuro.
  ['themeToggle', 'themeToggleMobile'].forEach(function (id) {
    var el = document.getElementById(id);
    if (!el) return;
    el.addEventListener('change', function () {
      document.documentElement.classList.toggle('dark-theme', el.checked);
    });
  });
  // El tema por defecto de la captura es oscuro.
  document.documentElement.classList.add('dark-theme');
  ['themeToggle', 'themeToggleMobile'].forEach(function (id) {
    var el = document.getElementById(id);
    if (el) el.checked = true;
  });
</script>
</body>
</html>
`;

return doc;
}

(async () => {
  for (const [file, view] of Object.entries(VIEWS)) {
    const doc = await render(view);
    const out = path.join(__dirname, file);
    fs.writeFileSync(out, doc, 'utf8');
    const kb = (Buffer.byteLength(doc) / 1024).toFixed(0);
    const urls = (doc.match(/https?:\/\//g) || []).length;
    console.log(`\n${file} · ${view.width}px · ${kb} KB · urls externas: ${urls}`);
  }
})().catch((err) => {
  console.error(err);
  process.exit(1);
});
