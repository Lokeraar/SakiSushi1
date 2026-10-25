# Handoff — Saki Sushi 1

> Documento de continuidad. Fecha de corte: **24 de octubre de 2026**.
> Todo lo aquí escrito fue verificado contra la base real y el código, no
> inferido. Si algo no se pudo probar, se dice explícitamente.

---

## 0. Estado al 24/10/2026 — leer primero

### Últimos commits

`34d5161` (panel de tasa) → `40880d3` (cadena de respaldos + ventana del día)

### Migraciones aplicadas (01 a 24)

Nuevas desde el corte anterior: **23** (panel de la tasa: `tasa_panel()`,
`aplicar_tasa_elegida()`, `pedidos_tasa_historica`) y **24** (cadena de
respaldos, `tasa_intento`, `tasa_revision_diaria`). La 03 sigue siendo
inaplicable.

### Lo cerrado en esta tanda

| Tema | Estado | Verificado |
|---|---|---|
| Panel de la tasa | Muestra el valor del BCV, su **fecha valor** en palabras y el origen tal cual. Diferencia en Bs, % y por cada 100 USD | En pantalla, local y producción |
| Elegir la tasa | Botones *Usar la vigente* / *Usar la próxima* / *Poner otra a mano*. El adelanto queda registrado con motivo | Ciclo completo, `adelanto = true` en la base |
| Cadena de respaldos | `dolarapi` → `er-api` → `currency-api`. Un respaldo **nunca** queda `aplicada` | Las tres fuentes, con respuestas reales |
| Ventana del día | El primero (admin **o** cajero) decide una vez: *Mantener esta tasa: X* | Login real de las dos cuentas |
| Historial de capturas | Modal con estado y motivo de cada captura | En pantalla |

### DEFECTO CERRADO: la captura automática no guardaba nada

La migración 22 dejó el circuito a medias. Medido al empezar:

```
cron que procesa respuestas : 0
respuestas descargadas       : 1
capturas automáticas         : 0
```

El cron disparaba la petición con pg_net, la respuesta quedaba en
`net._http_response`, y **nadie la procesaba**. `procesar_respuesta_tasa()`
existía y ningún job la llamaba. Ahora `resolver_captura_tasa()` corre cada
3 minutos entre las 21:00 y 21:29 UTC.

### TRAMPA: Realtime necesita el GRANT, no solo la policy

Sin `GRANT SELECT` sobre la tabla, el canal de Realtime se suscribe, responde
`joined`, y **no llega nunca un evento**. La policy sola no alcanza:

```sql
has_table_privilege('authenticated','tasa_revision_diaria','SELECT')  -- era false
```

Corregido. Si algún día una tabla nueva no replica, revisar esto primero.

### La contraseña del cajero

`cajero1` / **`123456`**. No es `cajero123` ni ninguna variante. El admin es
`admin` / `admin123`.

### LO QUE SIGUE, en orden

1. **Confirmar la réplica entre dos equipos reales.** El GRANT faltante está
   corregido y un JWT de cajero lee la tabla por REST, pero el motor de prueba
   (lightpanda) no completa páginas nuevas: deja los canales en `joining`.
2. **Verificar que la cadena dispara sola** mañana a las 5 pm (corre de lunes
   a viernes).
3. **Decidir el camino de la captura**: la base usa `pg_net` directo contra
   las tres URLs; la Edge Function `tasa-bcv-scraper` tiene su propia cadena y
   nadie la llama. Dos caminos para lo mismo es deuda.
4. Comprobar que la ventana no molesta en un segundo ingreso del mismo día.

### Decisiones del dueño que no hay que re-preguntar

- La etiqueta de la fuente dice **el origen real** (`dolarapi.com`), no
  "respaldo".
- La próxima se puede elegir a mano aunque no rija todavía, **y queda
  registrado** que fue una decisión.
- La ventana la puede confirmar **cualquiera con rol admin o cajero**.
- Si se cierra sin decidir, **no insiste en todo el día**.


<!-- tabla anterior conservada como histórico -->

### Lo cerrado en la tanda del 24/10

| Tema | Estado | Verificado |
|---|---|---|
| Ofertas con reloj | `menu_con_oferta`, `oferta_vigente()`, panel admin, tarjeta del cliente con tachado y `-30%` entero. Se apaga SOLA al vencer | En pantalla y por HTTP |
| 15 fotos de ingredientes | Spoonacular (11), TheMealDB (1), Pexels (1), Wikimedia CC0 (2) | 15 de 15 cargan a 420px |
| Licencias | **Ninguna de las 15 exige crédito** | Documentado en `assets/ingredientes/LICENCIAS.md` |
| Despiece del platillo | Miniatura 34×34 por ingrediente en el modal | En pantalla |
| Wifi real | `MERCUSYS_64BD` / `47421202` en `config`. Llega por `wifi_publico()`; un anónimo que pide la tabla `config` recibe 0 filas | En pantalla |
| PINes de mesonero | Ana 6718 · Carlos 5002 · José 1713 · Luis 9771 · María 5537 | Los 5 reconocen su PIN |
| Tasa | 886,23 = oficial **vigente** (fecha valor viernes 23/10) | — |
| Cierre del local | Candado en la base + panel admin + franja en el cliente | Ciclo completo en pantalla |
| Captura BCV | `tasa_bcv` con fecha valor, cron 5pm/7am, `pg_net` | Contra internet real |

### DEFECTO CRÍTICO corregido (migración 21)

`es_admin()` llamaba a `_t()`, y `_t()` devolvía `'admin'` **fijo**. Cualquier
anónimo era administrador: todo lo protegido con `es_admin()` estaba abierto.
Era un mock de pruebas olvidado, anterior a este trabajo.

Restaurado a `rol_actual() = 'admin'`, `_t()` borrada, y la migración **falla a
propósito** si alguien vuelve a dejar ese agujero.

### TRAMPA confirmada: la tasa necesita su FECHA VALOR

Posts del BCV (Instagram, sábado 24/10/2026):

| Valor | Fecha Valor |
|---|---|
| 887,30200000 | **Martes 27** ← el más nuevo |
| 886,22710000 | **Viernes 23** ← el anterior |

Ese sábado la tasa **vigente** era la del viernes. Pero `open.er-api.com` ya
devolvía 887,302 (la del martes): usarla habría adelantado cinco días una tasa
que no regía.

**Regla:** ninguna tasa se guarda sin fecha valor, y una fecha valor **futura
nunca se aplica**. Implementado en `registrar_tasa_bcv()` y verificado.

### Trampa de pg_net

`net._http_response` **no tiene columna `url`**. Se consulta por `id`, el mismo
que devuelve `net.http_get()`. Es asíncrono: no se puede esperar la respuesta
en la misma sentencia.

### Configuración de Engram corregida

`.zshrc` tenía `ENGRAM_PROJECT="${ENGRAM_PROJECT:-home}"`, que anula la
detección por carpeta y manda todas las memorias a un solo proyecto. Quitado
(respaldo en `~/.zshrc.bak-engram`). Aplica desde la próxima terminal.

### LO QUE SIGUE, en orden

1. **Panel del admin para la tasa**: mostrar la aplicada, su **fecha valor**, de
   qué fuente vino y si fue respaldo. Un humano tiene que poder desmentirla
   abriendo el Instagram del BCV.
2. **Cadena de respaldos** cuando `dolarapi` falle, registrando de dónde vino y
   avisando cuando no sea la principal.
3. **Ventana del primer admin o cajero del día**, con la opción
   "Mantener esta tasa: X", y replicación para cerrarla en las demás
   computadoras cuando uno confirma.
4. Verificar que **cambiar la tasa no altera lo ya cobrado**.

### Decisiones del dueño que no hay que re-preguntar

- El aumento diario y el acumulado **siguen corriendo aunque el local cierre**.
- La oferta vencida mientras el cliente arma el carrito **se mantiene**: el
  precio se congela al agregar.
- El cierre **solo lo activa y desactiva el rol admin**. El cajero no.
- El **mesonero no define la tasa**: solo se identifica por PIN para que el
  pedido quede a su nombre.
- El mensaje del cierre **lo escribe el admin**, no va hardcodeado.
- Entorno de **desarrollo**: el cliente definirá sus propias imágenes y pedirá
  renombres y cambios de estilo al pasar a producción.

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
