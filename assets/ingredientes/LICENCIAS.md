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

Las dos son **CC0** (dominio público). No exigen crédito ni imponen condición
alguna.

| Archivo | Archivo original | Licencia | Autor | ¿Exige crédito? |
|---|---|---|---|---|
| `anguila.webp` | `Kabayaki grilled eel.jpg` | **CC0** | Fumikas Sagisavas | No |
| `huevas.webp` | `Ikura salmon roe Hokkaido 02.jpg` | **CC0** | KQuhen | No |

### Estado de las licencias

**Ninguna de las 15 fotos exige crédito.**

- 11 de Spoonacular — licencia de su catálogo de ingredientes
- 1 de TheMealDB — licencia de su biblioteca
- 1 de Pexels — Pexels License (no exige atribución)
- 2 de Wikimedia Commons — CC0 (dominio público)

El sitio no necesita ningún renglón de créditos por las imágenes de
ingredientes.

### Cómo se llegó acá

Había dos fotos con CC BY-SA 4.0 que obligaban a nombrar al autor:

- **mayonesa**: se reemplazó por una de Pexels.
- **huevas**: se reemplazó por esta de Wikimedia, CC0.

Las dos sustituciones se eligieron porque **la licencia no impone
condiciones**, no porque las anteriores fueran malas fotos.

## Lo que se descartó y por qué

Bancos probados para las huevas, que fue lo más difícil:

- **TheMealDB**: de sus 992 ingredientes no tiene ni huevas ni anguila, en
  ninguna variante de nombre.
- **Spoonacular**: su `caviar` es caviar negro, no tobiko naranja.
- **Pexels**: 94 fotos revisadas. Su buscador **no distingue huevas de fruta**;
  "caviar orange" devuelve naranjas y "masago" devuelve peces vivos. La única
  rescatable era un plato de sushi armado con copas de vino de fondo.
- **pngimg.com**: requiere el id numérico de cada imagen, no se puede adivinar
  por nombre.
- **Bancos con publicidad en el HTML** (foodiesfeed, burst, stocksnap,
  kaboompics, picjumbo, reshot): al buscar devuelven banners de Shutterstock y
  Envato, no fotos propias.
- **pixabay, unsplash, picryl, rawpixel, freeimages**: bloquean el acceso
  (401, 403 o vacío).

### Qué funcionó: Openverse filtrando por CC0

Openverse agrega fotos de Flickr y Wikimedia con el filtro de licencia puesto
en la URL. Buscando `ikura` con `license=cc0` apareció la foto elegida.

Dos detalles técnicos que costaron tiempo:

- **Flickr exige `Referer: https://www.flickr.com/`** para dejar descargar.
  Sin ese encabezado la descarga llega vacía (0 bytes).
- Filtrado por `by` o `by-sa` no alcanza para un restaurante: hay fotos con
  `by-nc-sa`, que **prohíben el uso comercial**. Este sitio vende comida, así
  que la única licencia que deja todo resuelto sin letra chica es **CC0**.

