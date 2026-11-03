# CodeGraph y las funciones `window.*`

## El problema en una frase

CodeGraph indexa `function x(){}` pero **no** `window.x = function(){}`. Como este
proyecto expone casi todo por `window` (352 funciones), el índice quedaba ciego a
casi todo el código real.

## Cómo se comprobó

Se creó un archivo de prueba con ocho formas de declarar la misma función y se
indexó con `codegraph init`. Se consultó la tabla `nodes`:

| Forma | ¿Indexada? |
|---|---|
| `function declarada(){}` | sí |
| `const fn = function(){}` | sí |
| `module.exports.fn = function(){}` | sí |
| `window.fn = function(){}` | **no** |
| `window.fn = () => {}` | **no** |
| `window.fn = async function(){}` | **no** |
| `globalThis.fn = function(){}` | **no** |
| `api.fn = function(){}` | **no** |

No es un problema de configuración: `codegraph index` no acepta patrones ni
lenguajes. Es cómo el analizador trata las expresiones de función anónimas.

## La vía

Nombrar la expresión de función con su propio nombre:

```js
// antes — invisible para CodeGraph
window.cargarReportes = function() { ... };

// después — indexado, y se comporta exactamente igual
window.cargarReportes = function cargarReportes() { ... };
```

El nombre de una expresión de función solo existe dentro de su propio cuerpo. No
crea una variable en el ámbito externo ni altera el objeto `window`. La única
diferencia observable es `Function.prototype.name`, que pasa de `""` al nombre.

## Por qué es seguro

Antes de aplicarlo a las 352 funciones se verificó:

1. **Sin auto-referencias.** El único caso donde el nombre aparece dentro del
   cuerpo es `cerrarSesionMesonero`, y la referencia está en la función
   *siguiente*, no dentro de ella. Nombrar no cambia a qué apunta nada.
2. **El conjunto expuesto no cambia.** Se comparó, archivo por archivo contra
   `HEAD`, el conjunto de claves asignadas a `window`. 57 archivos, cero
   diferencias.
3. **Nadie lee `Function.name`.** Las únicas lecturas de `.name` del proyecto son
   sobre `File` y `Error`.
4. **Los tres paneles cargan.** Cliente (3 módulos, 43 funciones), admin (7
   módulos, 106) y Cajero (script inline, 95): ninguno lanza error.
5. **Los 14 artboards del canvas se regeneran idénticos** (mismo tamaño de byte,
   salvo un dato de ventas que cambió por la hora).

## El límite que queda

**CodeGraph no indexa HTML.** `Cajero/index.html` contiene 77 funciones en un
`<script>` inline y las 54 que siguen sin aparecer en el índice están todas ahí.
Nombrarlas no basta: el archivo entero está fuera del alcance del indexador.

Si eso importa, la salida es sacar ese `<script>` a un `.js` aparte. Es un cambio
más grande y no se hizo.

## Consecuencia práctica

Tras el cambio, el índice pasó de 471 a 777 nodos y de 68 a 69 archivos con
relaciones resueltas. Funciones que antes eran invisibles ahora responden a
`codegraph query` y `codegraph context`: `cargarReportes`,
`actualizarMarquesinaStock`, `verificarStockCritico`, `tasaEfectivaActual`,
`irAStockCritico`, entre otras.

## Regla

Al escribir una función nueva colgada de `window`, **dale su nombre**:

```js
window.miFuncion = function miFuncion() { ... };
```

Cuesta una palabra y mantiene el índice útil.
