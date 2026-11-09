# Nota de trabajo — ventana del platillo

Los cinco artboards de esta carpeta son **la misma ventana** con cinco
distribuciones distintas. Todos usan la paleta del tema claro ya cerrada en
`Cliente/index.html` (`body.tema-claro`), y un conmutador arriba de cada
artboard permite ver el tema oscuro para comprobar que la distribución aguanta
los dos.

## Tokens usados (tomados del CSS real, no inventados)

| Token | Claro | Oscuro |
|---|---|---|
| `--papel` | `#FBF7F2` | `#12121c` |
| `--superficie` | `#FFFFFF` | `--card-bg` |
| `--superficie-2` | `#F6F0E9` | — |
| `--text-primary` | `#2A1C14` | `#fff` |
| `--text-secondary` | `#5F4E44` | `--gray-400` |
| `--text-muted` | `#7A6A60` | — |
| `--primary` | `#A01828` | `#D32F2F` |
| `--primary-text` | `#96121F` | — |
| `--accent` (relleno) | `#DD951F` | `#FF9800` |
| `--accent-text` | `#8A5A00` | — |
| `--accent-sobre-marca` | `#FFD180` | — |
| `--linea` | `#E8DDD3` | `rgba(255,255,255,.1)` |
| `--borde-control` | `#947F6D` | — |

Contraste de cada par, medido: tinta 15.45, tinta2 7.40, tinta3 4.85,
carmesí-texto 8.19, dorado-texto 5.56, blanco sobre carmesí 7.91, tinta sobre
dorado 6.58. Todos AA o mejor.

## Qué hace la ventana (una sola, dos entradas)

La ventana es la misma tanto si el cliente toca la **foto** de la tarjeta como
si toca **Personalizar**. Contiene, en algún orden:

1. foto del platillo (tocable → se amplía),
2. nombre y descripción,
3. stock disponible,
4. cantidad (− / +),
5. modo: Completo · Personalizar ingredientes,
6. lista de ingredientes con − / Normal / ×2 y su precio,
7. precio total,
8. acciones: Cancelar · Añadir.

Lo que cambia entre artboards es **cómo se reparte eso** en la pantalla.
