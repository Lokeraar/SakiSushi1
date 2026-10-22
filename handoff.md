# Handoff — Saki Sushi 1

> Documento de continuidad. Fecha de corte: **22 de octubre de 2026**.
> Todo lo aquí escrito fue verificado contra la base real y el código, no
> inferido. Si algo no se pudo probar, se dice explícitamente.

---

## 1. Qué es este proyecto

Sistema de pedidos para un restaurante de sushi. Tres aplicaciones sobre un
mismo backend:

| App | Para quién | Líneas | Módulos |
|---|---|---|---|
| `Cliente/` | el comensal, sin cuenta | 6.028 | 16 IIFE |
| `admin/` | administración completa | 12.188 | 13 IIFE |
| `Cajero/` | cobro y propinas | 1.511 | monolítico |

- **Frontend:** HTML + CSS + JavaScript vanilla. Sin bundler, sin framework.
  Los módulos cuelgan de `window.Saki`.
- **Backend:** Supabase (PostgreSQL 17.6 + Edge Functions en Deno).
- **Deploy actual:** GitHub Pages (build legacy, sirve la raíz de `main`).
- **Repositorio:** `https://github.com/Lokeraar/SakiSushi0`
- **Proyecto Supabase:** `iqwwoihiiyrtypyqzhgy`

### Aclaración importante sobre el nombre

Existe otro producto, el **POS de facturación offline** (Astro 5, hoy llamado
El Peregrino del Vino). Sus copias viejas viven en `~/web-build` y
`~/saki-web`, y ambas declaran `"name": "saki-sushi-pos"`. **No son versiones
de esta web.** Este proyecto nunca usó Astro.

---

## 2. Estado de git

| Commit | Qué contiene |
|---|---|
| `279d92f` | **Estado base del 21-oct.** Las tres apps, `openspec/`, tests de Playwright, tooling. Normaliza CRLF con `.gitattributes` y repara el `.gitignore`. |
| `646fc5f` | **Parche de stock** + las migraciones SQL. |

Antes del primer commit, `git status` reportaba 58 archivos modificados
cuando el cambio real era de 10 líneas: era conversión CRLF→LF del worktree
(el repo se trabajó en Windows y ahora vive en Android). Con `.gitattributes`
ese ruido desapareció.

**Ambos commits son locales.** `origin/main` sigue en `dd2600f`.

---

## 3. RoLES del sistema (definidos, parcialmente implementados)

| Rol | Cómo entra | Puede |
|---|---|---|
| **cliente** | anónimo, sin contraseña | ver menú, ordenar, ver sus notificaciones. Nada más. |
| **mesonero** | PIN de 4 dígitos en tablet | lo del cliente + marcar "Atendido por" + entregar propina al cajero |
| **cajero** | usuario y contraseña | cobrar, **registrar propinas con comprobante**, asignar motorizado, marcar entregado, fijar la tasa |
| **admin** | usuario y contraseña | todo lo del cajero + crear QR, platillos, mesoneros, motorizados, inventario, usuarios |
| **motorizado** | **sin acceso** | es un registro de la tabla `deliverys`. El cajero lo asigna y marca entregado. Nunca inicia sesión. |

### Vocabulario que NO hay que confundir

- **`deliverys`** = el motorizado, la persona (tabla).
- **`delivery`** = el servicio de envío, un valor de `pedidos.tipo`.
- **`entregas_delivery`** = lo que el cajero le paga al motorizado.

### Los dos flujos de pedido

1. **En mesa:** el cliente escanea el QR de la mesa → ve el menú → arma el
   carrito → confirma → recibe notificación de "pase a caja" → el cajero
   cobra. El mesonero puede hacerlo desde su tablet; su distintivo es
   "Atendido por: (nombre)".
2. **Delivery / Reserva:** entra por el link web, elige uno de los dos
   botones, llena el formulario, paga solo por Pago Móvil. El cajero recibe
   el pedido, lo procesa y responde: notificación de éxito o de fallo con
   motivo.

### Flujo de propina

El mesonero **recibe físicamente** la propina y **se la pasa al cajero**. El
cajero la **registra** en `propinas` con el `mesonero_id` y la `referencia`
del comprobante. Tres métodos: efectivo Bs/$, Pago Móvil (últimos 6 dígitos)
y punto de venta (el cliente pasa por caja).

**El mesonero nunca escribe en `propinas`.** Si pudiera, podría inflarse el
acumulado solo.

---

## 4. Lo que ya está resuelto y verificado

### 4.1 Pedido roto → cerrado

**Antes:** el Cliente llamaba `crear_pedido_con_reserva` con 7 parámetros y la
función solo aceptaba 2. PostgREST devolvía `PGRST202`. Un cliente podía
recorrer todo el flujo y el pedido nunca se creaba.

**Ahora:** la migración `20261021_01` define la función con los 7 parámetros
que el frontend ya enviaba. No hizo falta tocar JavaScript.

Prueba real ejecutada (con `ROLLBACK`, sin dejar rastro):

```
ANTES   | pedidos 0 | notif 0 | arroz_reservado 0.00
DESPUES | pedidos 1 | notif 1 | arroz_reservado 0.30
        estado=pendiente, mesa=1
```

El cliente quitó el Aguacate y **el aguacate no se descontó**; los otros cinco
ingredientes sí, en la cantidad exacta para dos California Roll.

La versión vieja de 2 parámetros fue eliminada para que PostgREST no elija la
equivocada.

### 4.2 Stock → cerrado (regla de negocio implementada)

**Regla decidida:** el stock de un platillo **se deriva de sus ingredientes**,
nunca de `menu.stock`. Si falta un **principal** el platillo se bloquea; si
falta un **secundario** sigue siendo ordenable y solo se avisa.

Verificado:

```
Falta SECUNDARIO (Aguacate)  → disponible: true   faltan_secundarios: ["Aguacate"]
Falta PRINCIPAL (Cangrejo)   → disponible: false  faltan_principales: ["Cangrejo (imitación)"]
```

Principales marcados por receta:

| Platillo | Principales |
|---|---|
| California Roll | Arroz, Alga nori, Cangrejo |
| Philadelphia Roll | Arroz, Alga nori, Salmón |
| Spicy Tuna Roll | Arroz, Alga nori, Atún |
| Dragon Roll | Arroz, Alga nori, Anguila |
| Sashimi de Salmón | Salmón (todo el platillo) |
| Nigiri de Atún | Arroz, Atún |

### 4.3 Corrección de un diagnóstico equivocado

Se reportó al principio que "la base dice stock 0 y la UI muestra 116
disponibles" como si fuera un defecto. **No lo era:** 116 es el cálculo
correcto — `floor(35 aguacates ÷ 0.3 por plato) = 116`. El campo `menu.stock`
simplemente no se usa y está en 0.

El defecto real era otro: cuando el cálculo no se podía hacer, el código caía
a `999` o `stock_maximo`, pintando como disponible algo que no se podía
preparar. Eso sí se corrigió.

---

## 5. Defectos que quedan abiertos

### 5.1 RLS permisivo — el más grave

Las 21 policies decían `USING (true)`. Con la anon key pública, **sin
autenticarse**, se leen:

- `usuarios.password_hash` (bcrypt de los 3 usuarios)
- `config.admin_password` (texto plano)

Verificado desde la consola del navegador:

```js
from('usuarios').select('password_hash')  // → error: null, 2 filas, hash incluido
```

La migración `20261021_03` está **escrita pero NO aplicada**. Ver la sección 7
para el motivo: activarla ahora cerraría el acceso también para el admin,
porque las apps no tienen sesión real todavía.

### 5.2 Tasa desactualizada

El frontend usa **544,58** (de `config`, congelada el 28-may). El BCV actual
está en **883,39**. Los precios se muestran 38% por debajo.

Ejemplo medido: 8,99 USD → `Bs. 3.596,00` (a 544,58) cuando debería ser
≈ `Bs. 7.941`.

Dos causas:
1. `supabase-config.js:51` arranca con `400` hardcodeado.
2. `cliente-init.js:29` llama `cargarConfiguracion()` **sin `await`**; el
   render corre en paralelo y pinta con 400 si la config llega tarde.

**La buena noticia:** la Edge Function que consulta el BCV
(`tasa-bcv-scraper`) ya existe y **funciona**. Probada: devuelve
`{"success":true,"tasa":883.3963,...}`. Solo está desconectada.

### 5.3 `descontar_ingredientes_pedido` no existe

El Cajero la llama al cobrar y no existe en la base (`PGRST202`). El error se
traga en un `console.error` y el cobro continúa.

**Nota:** con la migración 01, la reserva de ingredientes ya ocurre al crear
el pedido. Falta la parte complementaria: al cobrar, convertir lo *reservado*
en *consumido*; al cancelar, liberarlo con `liberar_ingredientes` (que sí
existe).

### 5.4 Mesoneros sin forma de identificarse

La tabla `mesoneros` **no tenía** vínculo con `usuarios`. La migración 03
agrega `usuario_id`, `pin_hash` y `turno_abierto`. Falta el flujo del PIN.

### 5.5 El `ssid` de los QR está vacío

Los 6 registros de `codigos_qr` tienen `ssid` nulo. Si el QR debe entregar el
wifi, hay que cargarlo.

---

## 6. Entorno de trabajo (esto ahorra horas)

Android/Termux, aarch64. **No hay Chromium instalado.**

### Navegador

Dos opciones, y elegir mal hace perder tiempo:

| Navegador | Sirve para | Limitación |
|---|---|---|
| **Lemu** (Chrome 127 real, puerto 9222) | **Auditar estas apps** | Requiere la app abierta; es una ventana real |
| **lightpanda** (en proot Debian) | páginas simples, sondeos rápidos | **No ejecuta el SDK de Supabase**: `window.supabase` queda `undefined` y el Cliente muestra "No hay platillos" |

**Regla práctica:** si `window.supabase` es `undefined`, es lightpanda, no un
defecto de la app. Cambiar a Lemu.

Comando `ab` (está en `$PREFIX/bin/ab`), que resuelve todo:

```bash
ab open "https://lokeraar.github.io/SakiSushi0/Cliente/"
ab --json eval "document.title"
ab --json console
ab up | ab down | ab status
```

Lemu se levanta con `cdp-start` (abre la app y monta el puente). El
`.bashrc` solo arranca lightpanda si el puerto 9222 está **vacío**, para no
competir con Lemu.

**La tool `agent_browser` de Pi está rota** (`pi-agent-browser-native@0.9.6`
devuelve `Parser cannot parse input` con cualquier comando que necesite
sesión). No es configuración del equipo: se descartaron LD_PRELOAD, PATH,
variables de entorno, el journal de sesión y la versión del paquete. Usar el
CLI vía `ab`.

### Base de datos por terminal

`psql` 18.6 nativo (paquete `postgresql` de Termux). Conexión guardada:

```bash
psql "$(cat ~/.pguri-ip)"
```

Se usa la variante **con IP fija** (`~/.pguri-ip`) porque el resolver de
Android falla de forma intermitente con el nombre del pooler.

- Conexión: **Session pooler** (`aws-1-us-east-2.pooler.supabase.com:5432`).
- **No** usar "Direct connection": el dispositivo **no tiene IPv6**
  (`Network is unreachable`), y esa opción la requiere.
- **No** usar "Transaction pooler" para migraciones: parte las sentencias
  entre conexiones y `CREATE POLICY` / `ALTER TABLE` fallan.

---

## 7. Por qué la migración 03 (RLS) no está aplicada

Es la decisión más importante de este handoff.

Hoy el login del admin llama a una Edge Function que devuelve un token, pero
**ese token no tiene `auth.uid()`**, porque los usuarios viven en la tabla
propia `usuarios` y no en `auth.users`. Consecuencia: si se aplican las
policies escritas, `rol_actual()` devuelve `null` para todos y el admin
pierde acceso a todo. Se cerraría el candado también para el dueño.

### Dos caminos

**A. Reversible (recomendado para la próxima sesión).** Aplicar solo las
policies de lectura pública (menú, inventario, QR, vista `config_publica`) y
dejar escritura y datos sensibles cerrados. Eso ya elimina el agujero de los
hashes y no depende de la sesión. Los permisos por rol se activan después.

**B. Completo.** Reescribir el login para que use `auth.users` de Supabase
(con los mesoneros y su PIN), y recién entonces aplicar las policies de rol.
Es lo definitivo, pero son dos migraciones más y hay que probar cada rol.

### Requisito previo para el camino B

El login anónimo está **desactivado** en el proyecto (`anonymous_users:
False`; la petición devuelve 422). Para que el cliente sin contraseña reciba
notificaciones privadas hace falta activarlo en:

**Supabase → Authentication → Sign In / Providers → Anonymous sign-ins**

Es un interruptor del panel; no se puede hacer por `psql`.

---

## 8. Migraciones

Ubicadas en `supabase/migrations/`.

| Archivo | Estado | Qué hace |
|---|---|---|
| `20261021_01_crear_pedido_con_reserva_v2.sql` | ✅ **aplicada** | Pedido + reserva de ingredientes + notificación, en una transacción |
| `20261021_02_ingredientes_principales.sql` | ✅ **aplicada** | Marca `principal` en las 6 recetas; `disponibilidad_platillo()`; vista `menu_disponibilidad` |
| `20261021_03_rls_cinco_roles.sql` | ⚠️ **escrita, NO aplicada** | Policies de los 5 roles, vínculo `mesoneros.usuario_id`, `pin_hash`, `turno_abierto` |

Para aplicar una:

```bash
psql "$(cat ~/.pguri-ip)" -v ON_ERROR_STOP=1 -f supabase/migrations/ARCHIVO.sql
```

---

## 9. Próximos pasos, en orden sugerido

1. **Decidir camino A o B para RLS** (sección 7). Es lo que desbloquea el resto.
2. **Adaptar el JS del Cliente** a la regla principal/secundario: hoy el
   código local ya cae a "agotado" cuando no puede calcular, pero todavía no
   consume la vista `menu_disponibilidad`. Hay que usar
   `faltan_principales` para bloquear y `faltan_secundarios` para avisar.
3. **Parche de tasa:** `await` en `cliente-init.js:29` y llamada al scraper
   con fallback a la última guardada. Ojo: persistir la tasa nueva requiere
   que `config` sea escribible por el rol correcto (depende de RLS).
4. **Completar el ciclo de stock al cobrar:** convertir reservado en
   consumido; liberar con `liberar_ingredientes` al cancelar.
5. **PIN de 4 dígitos para mesoneros:** validar por Edge Function (nunca en
   el cliente), abrir turno en `mesoneros.turno_abierto`.
6. **Cargar el `ssid`** de los QR si deben entregar el wifi.

### Deuda menor

- `menu.stock` está en 0 y no se usa. Decidir si se documenta como muerto o se
  elimina del esquema.
- `test-results/` del proyecto original tiene 18 corridas fallidas contra
  producción (apuntaban a un deploy sin el fix). No se copió a esta carpeta.
- Los `.bat` de Windows, `Pong/` y `backup/` quedaron fuera por ruido.

---

## 10. Invariantes que no hay que romper

1. **El stock se deriva de los ingredientes.** `menu.stock` no es la fuente.
2. **Falta un principal → se bloquea. Falta un secundario → solo se avisa.**
3. **El mesonero nunca escribe propinas.** Las registra el cajero.
4. **El motorizado no es un rol de acceso.** Es un dato que el cajero gestiona.
5. **La validación de contraseña y PIN va en Edge Function**, nunca en el
   navegador: `password_hash` no debe salir al cliente.
6. **`psql` con IP fija** (`~/.pguri-ip`), por el resolver de Android.
7. **Para auditar UI, usar Lemu.** lightpanda no ejecuta el SDK de Supabase.

---

## 11. Credenciales y archivos sensibles

Están **fuera** de esta carpeta, a propósito:

| Qué | Dónde | Nota |
|---|---|---|
| URI de conexión a la base | `~/.pguri-ip` (modo 600) | Contiene la contraseña de Postgres |
| URI por nombre | `~/.pguri` | Falla de forma intermitente |
| Anon key | `supabase-config.js` | Es pública por diseño; no es un secreto |

**Nunca** commitear `~/.pguri*` ni pegar la contraseña de la base en el
repositorio.

---

## 12. Cómo retomar en una sesión nueva

```bash
cd "/storage/emulated/0/Download/Proyectos/SakiSushi 1"

# 1. Verificar que la base responde
psql "$(cat ~/.pguri-ip)" -c "select now()"

# 2. Ver qué migraciones están aplicadas
psql "$(cat ~/.pguri-ip)" -t -c "
  SELECT proname FROM pg_proc
  WHERE proname IN ('crear_pedido_con_reserva','disponibilidad_platillo');"

# 3. Levantar navegador para auditar UI
cdp-start          # Lemu, puerto 9222
ab status

# 4. Probar la app
ab open "https://lokeraar.github.io/SakiSushi0/Cliente/"
ab --json eval "JSON.stringify({supa:typeof window.supabase,platillos:window.Saki?.state?.menuItems?.length})"
```

Si `supa` es `"undefined"`, el navegador es lightpanda: hay que levantar Lemu.

---

## 13. Lo que NO está probado

Por honestidad, esto se afirma sin verificación completa:

- Las policies de la migración 03 **no se ejecutaron nunca**. Su sintaxis es
  plausible pero no está validada contra Postgres real.
- El parche de stock está probado en el archivo (`node --check` sin errores) y
  la función SQL que lo respalda está probada en la base, **pero la UI con el
  parche aplicado no se verificó en el navegador**: los cambios son locales y
  GitHub Pages sigue sirviendo el código anterior.
- El flujo completo de mesa (cliente escanea → cajero cobra) no se ejecutó de
  punta a punta con un usuario real.
