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

## Fuente 3 — Wikimedia Commons (3 fotos)

Acá hay que prestar atención: **dos exigen crédito**.

| Archivo | Archivo original | Licencia | Autor | ¿Exige crédito? |
|---|---|---|---|---|
| `anguila.webp` | `Kabayaki grilled eel.jpg` | **CC0** (dominio público) | Fumikas Sagisavas | No |
| `huevas.webp` | `Tobiko sur blini.jpg` | **CC BY-SA 4.0** | Thomon | **Sí** |
| `mayonesa.webp` | `Mayonnaise - Japan.jpg` | **CC BY-SA 4.0** | Susan Slater | **Sí** |

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

**Opción B — reemplazar esas dos fotos.** Buscar tobiko y mayonesa japonesa
bajo CC0 o de producción propia. Es lo más limpio legalmente y evita tener que
mantener un crédito, pero hay que encontrar reemplazos que combinen con el
resto.

Nada de esto bloquea el desarrollo: las fotos ya están listas y funcionando.
Es una decisión a resolver antes de publicar el sitio al público.

## Lo que se descartó y por qué

- **Openverse**: devolvía anguilas vivas en el mar, no filetes para sushi.
  Además empezó a limitar las peticiones.
- **TheMealDB**: de sus 992 ingredientes no tiene ni huevas ni anguila, en
  ninguna variante de nombre.
- **pngimg.com**: requiere el id numérico de cada imagen, no se puede adivinar
  por nombre.
- **Spoonacular** para huevas y mayonesa japonesa: no las tiene. Su `caviar`
  es caviar negro (no tobiko naranja) y su `mayonnaise` son frascos genéricos.
