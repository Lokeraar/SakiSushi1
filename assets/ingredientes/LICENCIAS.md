# Fotos de ingredientes — origen y licencias

Las 15 fotos de `Cliente/assets/ingredientes/` vienen de tres fuentes distintas.
Este archivo existe para que, si alguna vez hay que reemplazar una o defender
su uso, se sepa exactamente de dónde salió.

Todas fueron recortadas a cuadrado 420×420 y convertidas a WebP calidad 82.
Total: **125 KB las quince**, contra 1 MB que pesarían en JPEG crudo.

## Fuente 1 — Spoonacular (11 fotos)

Fotos de ingrediente sobre fondo blanco, estilo consistente entre sí.
Se sirven desde `img.spoonacular.com/ingredients_500x500/`.

| Archivo | Archivo original |
|---|---|
| `aguacate.webp` | `avocado.jpg` |
| `alga-nori.webp` | `nori.jpg` |
| `atun.webp` | `tuna-steak.png` |
| `cangrejo.webp` | `crabmeat.jpg` |
| `jengibre.webp` | `ginger-pickled.jpg` |
| `pepino.webp` | `cucumber.jpg` |
| `queso-crema.webp` | `cream-cheese.jpg` |
| `salmon.webp` | `salmon.jpg` |
| `salsa-soya.webp` | `soy-sauce.jpg` |
| `sesamo.webp` | `sesame-seeds.jpg` |
| `wasabi.webp` | `wasabi.jpg` |

## Fuente 2 — TheMealDB (1 foto)

| Archivo | Original |
|---|---|
| `arroz.webp` | `/images/ingredients/Rice.png` |

## Fuente 3 — Pexels (1 foto)

Se sumó buscando justamente evitar una obligación de crédito. Pexels no exige
atribución.

| Archivo | Foto |
|---|---|
| `mayonesa.webp` | Frasco de mayonesa japonesa (Kewpie), foto `31621556` |

La foto original traía el frasco junto a una tabla con pan y papas. Se recortó
cerrado sobre el frasco para que se lea como ingrediente, igual que las demás.

**Nota sobre cómo se accedió**: la API de Pexels pide clave (devuelve 401), así
que se usó la búsqueda pública del sitio. Al descargar con `curl` hay que pasar
`-L`: sin eso la respuesta llega vacía (0 bytes) y parece que no hubiera
resultados.

### Qué se buscó y no sirvió

- `tobiko`, `masago`, `caviar orange`, `fish eggs`, `salmon roe`: Pexels **no
  distingue huevas de fruta**. "caviar orange" devuelve naranjas; "masago"
  devuelve peces vivos.
- La única foto de huevas rescatable (`4973825`) es un plato de sushi armado,
  con copas de vino de fondo: peor que la de Wikimedia.

## Fuente 4 — Wikimedia Commons (2 fotos)

Acá hay que prestar atención: **una exige crédito**.

| Archivo | Archivo original | Licencia | Autor | ¿Exige crédito? |
|---|---|---|---|---|
| `anguila.webp` | `Kabayaki grilled eel.jpg` | **CC0** (dominio público) | Fumikas Sagisavas | No |
| `huevas.webp` | `Tobiko sur blini.jpg` | **CC BY-SA 4.0** | Thomon | **Sí** |

### Estado actual de las obligaciones

De las 15 fotos, **una sola** exige crédito: `huevas.webp`, de Thomon, bajo
CC BY-SA 4.0.

Las otras 14 (11 de Spoonacular, 1 de TheMealDB, 1 de Pexels, y la anguila que
es CC0) no obligan a nada.

### Qué implica CC BY-SA 4.0

Significa dos cosas:

1. **Atribución**: hay que nombrar al autor en algún lado visible.
2. **Compartir igual**: si se modifica la foto y se redistribuye, la versión
   modificada tiene que salir con la misma licencia.

Acá las fotos fueron **recortadas y reconvertidas**. Eso ya es una modificación,
así que la licencia CC BY-SA se mantiene sobre las versiones recortadas.

### Cómo se cumple, en la práctica

Hay dos caminos, y la decisión no es técnica sino del dueño:

**Opción A — cumplir la licencia.** Agregar un crédito discreto dentro de la
app, por ejemplo en el pie de página o en un "Créditos de imágenes" accesible
desde el menú. Alcanza con nombrar autor y licencia.

**Opción B — reemplazar la foto.** Buscar tobiko bajo CC0 o de producción
propia. Ya se hizo con la mayonesa: se reemplazó por una de Pexels y esa
obligación desapareció. Con las huevas no se encontró reemplazo mejor: Pexels
no tiene tobiko aislado y Wikimedia solo tenía esa opción limpia.

Nada de esto bloquea el desarrollo: las 15 fotos ya están listas y
funcionando. Queda **una** decisión pendiente antes de publicar al público:
qué hacer con el crédito de las huevas.

**Opción C, la más simple**: las fotos de ingredientes son miniaturas de 34 px
dentro de un modal. Un renglón de crédito en el pie de página cuesta nada y
cierra el tema.

## Lo que se descartó y por qué

- **Openverse**: devolvía anguilas vivas en el mar, no filetes para sushi.
  Además empezó a limitar las peticiones.
- **TheMealDB**: de sus 992 ingredientes no tiene ni huevas ni anguila, en
  ninguna variante de nombre.
- **pngimg.com**: requiere el id numérico de cada imagen, no se puede adivinar
  por nombre.
- **Spoonacular** para huevas y mayonesa japonesa: no las tiene. Su `caviar`
  es caviar negro (no tobiko naranja) y su `mayonnaise` son frascos genéricos.
