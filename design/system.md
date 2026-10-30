# Sistema de diseño — Saki Sushi (panel de administración)

Capturado desde el código existente. No hay valores inventados: cada entrada nombra su fuente.
Solo se incluyen tokens del panel admin; el resto del proyecto (Cliente, Cajero) tiene su propio CSS.

## Fuentes

- `admin/css/admin.css` — tema claro/oscuro del panel, componentes y layout.
- `assets/fonts/fuentes.css` — familias y pesos declarados vía `@font-face`.
- `assets/fontawesome/all.min.css` — iconografía (Font Awesome), no aporta tokens de color.

## Color — marca

| Token | Valor | Uso | Fuente |
| --- | --- | --- | --- |
| `--primary` | `#D32F2F` | Rojo Saki: acciones principales, borde de tarjetas, tab activo (claro) | `admin/css/admin.css` |
| `--primary-dark` | `#B71C1C` | Fin del degradado de botones primarios | `admin/css/admin.css` |
| `--accent` | `#FF7043` | Naranja salmón: enlaces suaves, foco de inputs, iconos secundarios | `admin/css/admin.css` |
| `--accent-dark` | `#E64A19` | Hover del acento | `admin/css/admin.css` |
| `--gold` | `#FFB300` | Platillo estrella, destacados | `admin/css/admin.css` |

## Color — estados y categorías

| Token | Valor | Uso | Fuente |
| --- | --- | --- | --- |
| `--success` | `#388E3C` | Confirmaciones | `admin/css/admin.css` |
| `--info` | `#1976D2` | Información | `admin/css/admin.css` |
| `--warning` | `#F57C00` | Advertencias | `admin/css/admin.css` |
| `--danger` | `#ef4444` | Errores, stock crítico, hover de salir | `admin/css/admin.css` |
| `--delivery` | `#00ACC1` | Etiqueta delivery | `admin/css/admin.css` |
| `--propina` | `#9C27B0` | Etiqueta propina | `admin/css/admin.css` |
| `--favordecaja` | `#FF9800` | Favor de caja | `admin/css/admin.css` |
| `--condonar` | `#E91E63` | Condonación | `admin/css/admin.css` |
| `--usd-color` | `#0d6efd` claro / `#6ea8fe` oscuro | Desglose en dólares | `admin/css/admin.css` |
| `--bs-color` | `#198754` claro / `#75b798` oscuro | Desglose en bolívares | `admin/css/admin.css` |

## Color — superficies y texto

El panel es de contraste duro a propósito: blanco puro y negro puro, sin grises intermedios de fondo.

| Token | Claro | Oscuro (`html.dark-theme`) | Fuente |
| --- | --- | --- | --- |
| `--body-bg` | `#ffffff` | `#000000` | `admin/css/admin.css` |
| `--secondary` | `#ffffff` | `#000000` | `admin/css/admin.css` |
| `--header-bg` | `#ffffff` | `#000000` | `admin/css/admin.css` |
| `--card-bg` | `#ffffff` | `#0a0a0a` | `admin/css/admin.css` |
| `--tabs-bg` | `#ffffff` | `#0a0a0a` | `admin/css/admin.css` |
| `--table-header` | `#ffffff` | `#0a0a0a` | `admin/css/admin.css` |
| `--input-bg` | `#ffffff` | `#1a1a1a` | `admin/css/admin.css` |
| `--text-dark` | `#000000` | `#ffffff` | `admin/css/admin.css` |
| `--text-muted` | `#4a4a4a` | `#b0b0b0` | `admin/css/admin.css` |
| `--border` | `#d0d0d0` | `rgba(255,255,255,0.15)` | `admin/css/admin.css` |
| `--input-border` | `#cccccc` | `rgba(255,255,255,0.2)` | `admin/css/admin.css` |
| `--tab-text` | `#000000` | `rgba(255,255,255,0.7)` | `admin/css/admin.css` |
| `--tab-active` | `#D32F2F` | `#FF9800` | `admin/css/admin.css` |
| `--list-item-hover` | `#fafafa` | `rgba(255,255,255,0.08)` | `admin/css/admin.css` |

## Color — badges de stock

| Token | Claro | Oscuro | Fuente |
| --- | --- | --- | --- |
| `--badge-ok-*` | fondo `#e8f5e9`, texto `#1b5e20` | `rgba(46,125,50,.4)` / `#69f0ae` | `admin/css/admin.css` |
| `--badge-bajo-*` | fondo `#fff3e0`, texto `#e65100` | `rgba(245,127,23,.3)` / `#ffcc02` | `admin/css/admin.css` |
| `--badge-critico-*` | fondo `#ffebee`, texto `#b71c1c` | `rgba(198,40,40,.35)` / `#ff6b6b` | `admin/css/admin.css` |

## Tipografía

| Rol | Familia | Tamaño / peso | Fuente |
| --- | --- | --- | --- |
| Cuerpo | `'Montserrat', sans-serif` | 16 px (base del navegador), 400/600 | `admin/css/admin.css` `body` |
| Título de sección | `'Playfair Display', serif` | `1.6rem` / 700, borde inferior 2 px | `admin/css/admin.css` `.section-title` |
| Título de header | `'Playfair Display', serif` | `1.3rem` | `admin/css/admin.css` `.header-left h2` |
| Título de tarjeta de login | `'Playfair Display', serif` | `1.8rem` | `admin/css/admin.css` `.login-box h2` |
| Valor de tarjeta | `'Montserrat'` | `1.6rem` / 700 | `admin/css/admin.css` `.card-value` |
| Etiqueta de tarjeta | `'Montserrat'` | `.78rem` / 600, mayúsculas, `letter-spacing .5px` | `admin/css/admin.css` `.card-title` |
| Tab | `'Montserrat'` | `.85rem` / 500, activo 700 | `admin/css/admin.css` `.tab` |
| Botón | `'Montserrat'` | `.82rem` / 600–700 | `admin/css/admin.css` `.nav-button`, `.save-button` |
| Microtexto | `'Montserrat'` | `.7rem`–`.75rem` (frecuente con `!important`) | `admin/css/admin.css` |

Pesos declarados en `assets/fonts/fuentes.css`: Montserrat 400/500/600/700/800, Playfair Display 400/500/600/700, Roboto 300/400/500/700.
Aviso: todos los `@font-face` de cada familia apuntan al mismo archivo de peso 400, así que 600/700 se sintetizan en el navegador. Afecta la nitidez de títulos y valores.

## Espaciado

No está tokenizado; estos son los valores que se repiten en `admin/css/admin.css`.

| Contexto | Valor | Fuente |
| --- | --- | --- |
| Padding de contenido | `2rem` | `.content` |
| Gap de grillas | `1rem` | `.dashboard-grid` |
| Gap de header | `.5rem` | `.header` |
| Padding de botón | `.5rem 1rem` / `.6rem 1.3rem` | `.nav-button`, `.btn-primary` |
| Padding de tab | `.9rem 1.4rem` | `.tab` |
| Altura de header | `min-height: 56px` | `.header` |

## Radios

| Valor | Uso | Fuente |
| --- | --- | --- |
| `--radius: 10px` | Tarjetas | `admin/css/admin.css` |
| `8px` | Botones primarios y secundarios | `.btn-primary` |
| `6px` | Botones de header, logo | `.nav-button` |
| `14px` / `16px` / `20px` | Modales y bloques destacados | `admin/css/admin.css` |
| `50px` / `30px` | Pills de filtro | `admin/css/admin.css` |

## Sombras

| Token | Valor | Fuente |
| --- | --- | --- |
| `--shadow-sm` | `0 2px 8px rgba(0,0,0,0.08)` | `admin/css/admin.css` |
| `--shadow-md` | `0 4px 16px rgba(0,0,0,0.12)` | `admin/css/admin.css` |
| `--shadow-lg` | `0 8px 32px rgba(0,0,0,0.18)` | `admin/css/admin.css` |
| Sombra de header | `0 2px 12px rgba(0,0,0,.1)`, oscuro `.3` | `.header` |

## Reglas de componentes

- **Header**: sticky, `min-height 56px`, dos filas en escritorio y tres en móvil; acciones a la derecha como `.btn-header-control`.
- **Tabs**: fila con scroll horizontal sin scrollbar visible, indicador de activo por borde inferior de 3 px en `--tab-active`, no por fondo.
- **Tarjetas**: fondo `--card-bg`, `border-radius: var(--radius)`, `--shadow-sm`, borde izquierdo de 4 px en `--primary` como acento de categoría.
- **Botón primario**: degradado `135deg` de `--primary` a `--primary-dark`, texto blanco, hover con `translateY(-1px)` y sombra roja.
- **Botón secundario**: fondo transparente o `--secondary` con borde de 2 px; en oscuro se vuelve transparente.
- **Toggle**: pista de 2.4rem aprox. con perilla circular; encendido en `--primary`.
- **Tabla**: cabecera con fondo `--table-header` y texto `--table-header-text`, filas con hover `--list-item-hover`.
- **Foco**: `:focus` sobre inputs cambia borde a `--accent`; no hay anillo de foco unificado para botones (deuda).

## Deudas detectadas (para tenerlas a la vista al rediseñar)

1. Microtexto por debajo de 14 px en muchas etiquetas (`.7rem` ≈ 11 px), con `!important`.
2. Pesos 600/700 de Montserrat y Playfair se sintetizan: no hay archivos reales de esos pesos.
3. Seis radios distintos conviven (6/8/10/12/14/20 px) sin regla escrita.
4. Colores sueltos fuera de tokens (`#ffc107`, `#4ade80`, `#1a1a2e`, `#5c6bc0`) usados directo en reglas.
5. Sin anillo de foco visible unificado para botones ni tabs (accesibilidad de teclado).
