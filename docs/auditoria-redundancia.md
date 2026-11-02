# Auditoría de redundancia histórica — Cliente y Admin

Fecha: 2026-11-02. Alcance: `Cliente/`, `admin/`, `Cajero/`. Indexado con
CodeGraph (68 archivos, 471 nodos, 1027 aristas).

Motivo: el bug del costo de envío reveló un patrón —código que existe en un
lugar y se ignora en otro— y Christian pidió buscar el resto.

---

## Resumen

| # | Hallazgo | Gravedad | Estado |
|---|---|---|---|
| 1 | `admin-mesoneros.js` repite el cálculo de tasa 12 veces e ignora `window.usdToBs` | **Alta** | Por corregir |
| 2 | `costo_delivery` duplicaba a `costo_delivery_usd` | Alta | **Corregido** |
| 3 | `hoyISO()` definida idéntica en dos archivos del admin | Media | Por corregir |
| 4 | `alerta_stock_minimo`: columna de `config` que nadie lee | Media | Por decidir |
| 5 | `recovery_email`: columna de `config` que nadie lee | Baja | Por decidir |
| 6 | `monto_recibido`: columna de `pedidos` que nadie lee | Baja | Por decidir |
| 7 | `|| 400` hardcodeado 33 veces | Media | Por corregir |
| 8 | `minutos()` duplicada (dos variantes) | Baja | Aceptable |

---

## 1. El cálculo de tasa repetido 12 veces (gravedad alta)

`admin/js/admin-core.js:52` ya define:

```js
window.usdToBs = function(u) {
    return u * (window.configGlobal?.tasa_efectiva || 400);
};
```

Y `admin-mesoneros.js` **lo ignora** y repite el cálculo inline en 12 lugares:

```js
const tasaBase = Number(window.configGlobal?.tasa_cambio || 400);
const tasaEfectiva = Number(window.configGlobal?.tasa_efectiva || window.configGlobal?.tasa_cambio || 400);
```

Esto es exactamente el patrón que produjo el bug del envío: la regla vive en
un solo lugar, pero se reimplementa en otro. El día que cambie el fallback, o
que se agregue un tercer tipo de tasa, hay 12 lugares donde olvidarlo.

**Corrección propuesta:** que `admin-mesoneros.js` use `window.usdToBs` y una
nueva `window.usdToBsBase`, igual que el Cliente. Nada de fórmulas inline.

---

## 2. `costo_delivery` duplicaba a `costo_delivery_usd` (corregido)

Confirmado por Christian: eran "prácticamente lo mismo". Los datos lo prueban
—`TEST-MIX-2` tiene 1.50 en ambas—.

Nadie lee `costo_delivery`. La RPC ya no la escribe: los pedidos nuevos la
dejan en su default 0 y usan `costo_delivery_usd` como única fuente de dólares,
más `costo_delivery_bs` para la conversión congelada.

---

## 3. `hoyISO()` duplicada (gravedad media)

Definición **idéntica** en dos archivos:

- `admin/js/admin-tasa-aviso.js:38`
- `admin/js/admin-tasa-panel.js:63`

```js
function hoyISO() {
    return new Date().toLocaleDateString('en-CA', { timeZone: 'America/Caracas' });
}
```

Ambas son locales (dentro de su IIFE), así que no chocan en tiempo de
ejecución, pero son dos copias de la misma regla de zona horaria. Si mañana
cambia la zona o el formato, hay que acordarse de las dos.

**Corrección propuesta:** dejar una sola en un módulo compartido del admin.

---

## 4 y 5. Columnas de `config` que nadie lee

| Columna | Quién la lee |
|---|---|
| `alerta_stock_minimo` | **Nadie.** Solo existe como default en `supabase-config.js:92` |
| `recovery_email` | **Nadie.** Solo como default en `supabase-config.js:91` |

Sobre `alerta_stock_minimo`: el código real usa un umbral **por ingrediente**
(`item.minimo`), no uno global. Verificado en `admin-inventario.js:47,99`.

```js
const minimo = item.minimo || 0;
if (disponible <= 0) estado = 'agotado';
else if (disponible <= minimo) estado = 'critico';
else if (disponible <= minimo * 1.5) estado = 'bajo';
```

Es decir: la columna global es una idea que se abandonó a favor del umbral por
ingrediente, pero quedó el default en el código.

**Decisión pendiente de Christian:** borrar los defaults, o dejar las columnas
por si se usan más adelante.

---

## 6. `monto_recibido` en `pedidos`

Cero referencias en Cliente, admin, Cajero y migraciones. Columna sin lector
ni escritor.

**Decisión pendiente:** borrarla o dejarla documentada como reservada.

---

## 7. El `|| 400` hardcodeado: 33 veces

Aparece 33 veces en Cliente, admin y Cajero. Es el valor de respaldo cuando
`configGlobal` no cargó todavía. El problema no es el número: es que está
repetido y si algún día cambia la tasa de respaldo hay que tocar 33 lugares.

**Corrección propuesta:** una constante única, `TASA_RESPALDO`, en un módulo
compartido.

---

## 8. `minutos()` duplicada — aceptable

- `Cliente/js/cliente-carrito-dialogo.js:39` usa `20` literal
- `Cliente/js/cliente-carrito-timer.js:41` usa `MINUTOS_DEFECTO`

Misma lógica con distinta constante local. **No es un defecto**: cada módulo
tiene su propia constante con nombre. Se documenta y se deja.

---

## Lo que NO fue redundancia

Verificado y descartado para no generar trabajo inútil:

- **`guardarCarrito`, `actualizarCarritoBadge`, `actualizarCarritoUI` en
  `cliente-customize.js`**: son *stubs* deliberados que evitan una dependencia
  circular. Llaman a la versión de `cliente-carrito.js`. Correcto como está.
- **`toggleNivel`, `borrarGrupoNivel`**: la segunda coincide con el nombre de
  un parámetro, no es una función duplicada.
- **`deliverys` vs `entregas_delivery`**: son cosas distintas (motorizados y
  sus entregas). Confirmado por el usuario.
- **`usdToBs` en Cliente vs Admin**: misma firma y misma regla en ambos
  lados, pero viven en homes distintos y no se pueden compartir sin un módulo
  común. No es redundancia accidental.

---

## Orden sugerido de corrección

1. **Hallazgo 1** (tasa repetida 12 veces): es el que más riesgo tiene.
2. **Hallazgo 7** (`|| 400`): va de la mano con el anterior.
3. **Hallazgo 3** (`hoyISO`): rápido y sin riesgo.
4. **Hallazgos 4, 5, 6**: necesitan decisión de producto, no de código.
