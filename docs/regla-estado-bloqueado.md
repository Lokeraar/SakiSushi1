# Regla: todo lo que se bloquea se libera, aunque el camino se corte

## Qué pasó, y cuántas veces

Tres bugs distintos de este proyecto comparten la misma forma:

| Bug | Qué se bloqueó | Por qué no se liberó |
|---|---|---|
| Inventario no guardaba | El guardado reportaba éxito con 0 filas | RLS devuelve 200 + `[]`; el código solo miraba `if (error)` |
| `validarPasswordStock` | El token de sesión quedaba viejo | `/login` devolvía uno nuevo y se descartaba |
| Cerrar sesión colgado | `signOut()` de GoTrue | La promesa nunca resolvía: esperaba un candado ajeno |
| Botón de Google muerto | `btnGoogleCuenta.disabled = true` | Se volvió por bfcache: la página se restauró congelada y el arranque no corrió |

Y antes: el carrito que no vaciaba el stock, el `window.S` que mataba un
módulo entero, el Chart.js que quedaba en una promesa sin resolver.

## La forma común

> **Se toma algo (`disabled = true`, un candado, una sesión, un estado
> "en curso") y se libera solo en el camino feliz. Cuando el camino se
> interrumpe —error, cancelación, retroceso del navegador, pestaña cerrada—
> nadie lo devuelve.**

El caso del botón de Google lo deja clarísimo: la liberación estaba
**después** de la llamada, dentro del `.catch()`. Pero si la persona
retrocede, ni el `.then()` ni el `.catch()` corren nunca, porque la página
murió. El botón queda tomado para siempre.

## La regla

**Todo recurso que se toma tiene que tener un camino de salida que NO
dependa de que la operación termine bien.**

Cinco formas concretas de aplicarla:

### 1. Nunca "solo en el `finally`"

`try/finally` no cubre la navegación, ni el cierre de pestaña, ni el
bfcache. Si algo tiene que liberarse aunque la página se vaya, va en un
evento del ciclo de vida: `pageshow`, `visibilitychange`, `pagehide`.

```js
// MAL: si el usuario retrocede, esto nunca corre
boton.disabled = true;
accion().then(...).catch(...);

// BIEN: además hay una salida por el ciclo de vida
window.addEventListener('pageshow', function (e) {
    if (e.persisted) liberarTodo();   // vuelve de bfcache
});
```

### 2. Un contador para no liberar lo que está vivo

Si se libera sin mirar, se puede reabrir un botón **mientras** una
operación está en curso, y eso permite el doble envío. Se distingue:

- vuelve de **bfcache** → la página es una foto del pasado; **forzar**, porque
  las promesas pendientes murieron con ella;
- vuelve a **primer plano** (`visibilitychange`) → la página siguió viva;
  **respetar** el contador.

### 3. Toda promesa que puede no resolver necesita un tope

Una promesa que no resuelve no es un error: es un silencio. Y un silencio
no se puede diagnosticar ni mostrar. Si algo puede colgarse, se le pone
tiempo límite y un mensaje. Ver `SEGUNDOS_MAXIMOS` en
`Cliente/js/cliente-identidad.js`.

### 4. Una escritura tiene que confirmar que escribió

`if (error)` no alcanza. Supabase responde **HTTP 200 con `[]`** cuando RLS
bloquea. Toda escritura pide las filas de vuelta:

```js
const { data, error } = await supabase.from(t).update(x).eq('id', id).select('id');
if (error) throw error;
if (!data || data.length === 0) throw new Error('No se guardó: el servidor no permitió la escritura.');
```

Lo mismo con `fetch`: mirar `respuesta.ok`, no solo que la promesa resolvió.

### 5. Lo que se guarda, se relee de donde se guardó

El token que `/login` devolvía se descartaba y la sesión seguía con el
viejo. Si una respuesta trae un valor que reemplaza a otro que ya está en
memoria, **hay que escribirlo en memoria**. Si no, la app cree tener algo
que ya no vale.

## La pregunta que ataja todos

Antes de cerrar cualquier función que toma algo, preguntarse:

> **¿Qué pasa si el usuario cierra la pestaña, retrocede, pierde señal o
> cancela justo aquí?**

Si la respuesta es "queda trabado", "no se libera", "no se guarda" o "sigue
como si nada", falta un camino de salida.

## Dónde ya está aplicada

- `Cliente/js/cliente-cuenta.js` → `soltarBotonesTrabados()` + `pageshow`.
- `Cliente/js/cliente-identidad.js` → `conTiempoLimite()`, `cerrarSesion()`
  sin esperar la red.
- `admin/js/admin-inventario.js` → `.select('id')` y conteo de filas.
- `admin/js/admin-inventario.js` → `validarPasswordStock` guarda el token nuevo.
