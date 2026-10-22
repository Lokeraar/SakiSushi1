# SakiSushi1

Sistema de pedidos para un restaurante de sushi. Tres aplicaciones sobre un
mismo backend Supabase.

| App | Para quién |
|---|---|
| `Cliente/` | el comensal, sin cuenta |
| `admin/` | administración completa |
| `Cajero/` | cobro y propinas |

- Frontend: HTML + CSS + JavaScript vanilla (`window.Saki`). Sin bundler.
- Backend: Supabase (PostgreSQL 17.6 + Edge Functions en Deno).
- Deploy actual: GitHub Pages (build legacy, sirve la raíz de `main`).

## URLs

Cliente: https://lokeraar.github.io/SakiSushi1/Cliente/

Cajero: https://lokeraar.github.io/SakiSushi1/Cajero/

Admin: https://lokeraar.github.io/SakiSushi1/admin/

## Migraciones

En `supabase/migrations/`. Se aplican en orden:

```bash
psql "$(cat ~/.pguri-ip)" -v ON_ERROR_STOP=1 -f supabase/migrations/ARCHIVO.sql
```

| Archivo | Qué hace |
|---|---|
| `20261021_01` | `crear_pedido_con_reserva` v2 (7 parámetros) + reserva de ingredientes |
| `20261021_02` | Ingredientes principales, `disponibilidad_platillo()`, vista `menu_disponibilidad` |
| `20261021_03` | RLS de cinco roles — **superada por la 05, no aplicar** |
| `20261021_04` | Ciclo de inventario: reservado → consumido, y liberación al cancelar |
| `20261021_05` | RLS real: cierra el acceso a `password_hash` y `admin_password` |
| `20261021_06` | Rol exigido en las RPC de stock + idempotencia corregida |

## Contexto del proyecto

`handoff.md` tiene el estado verificado, los invariantes de negocio y el
entorno de trabajo. Leerlo antes de tocar código.

## Advertencia sobre este repositorio

Nació como copia de trabajo del 22-oct-2026. **No comparte historia con
`Lokeraar/SakiSushi0`**: son dos repositorios independientes.
