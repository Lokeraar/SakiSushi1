# Plano: identidad de clientes (anónimo + registrado)

Estado: **propuesta para revisión**. No implementado.

## 1. La idea en una frase

Dos caminos que el cliente elige sin que se le pregunte nada al entrar. Anónimo por
defecto, con identidad local fuerte. Registrado cuando el cliente quiere que sus cosas
lo sigan a otro teléfono.

Nadie ve un formulario al abrir la carta. El registro se ofrece **cuando sirve**:
al tocar "Mis pedidos" o "Activar notificaciones".

## 2. Los dos perfiles

### Perfil anónimo — el que se crea solo

| Qué | Cómo |
|---|---|
| Identificador | 128 bits de `crypto.getRandomValues`, no `Math.random` |
| Dónde vive | `localStorage`, clave `saki_cliente_id` |
| Usuario en la base | **Ninguno.** No toca `auth.users` |
| Límite de saturación | **Ninguno.** No llama al registro de Supabase |
| Velocidad | Instantáneo, sin viaje a la red |
| Sin señal | Funciona igual |

Esto es lo que resuelve "Local lleno": el perfil anónimo **no consume la cuota de 30
por hora**, porque nunca crea un usuario. Esa cuota solo la gastan quienes se registran
de verdad.

### Perfil registrado — el que el cliente elige

| Qué | Cómo |
|---|---|
| Correo y contraseña | Supabase Auth. La contraseña se **hashea** con bcrypt en el servidor; nunca la vemos ni la guardamos |
| Google | OAuth de Supabase Auth |
| Identificador | El de Supabase Auth (`auth.uid()`), verificable por el servidor |
| Historial, favoritos, notificaciones | Viajan con la cuenta a cualquier teléfono |

## 3. Corrección: "cifrar" la contraseña

Importante y no es un detalle de vocabulario. Una contraseña **no se cifra, se hashea**.

Cifrar es reversible: con la llave se recupera el texto original. Hashear es de un solo
sentido: no hay forma de volver atrás, solo de comprobar si coincide.

Si cifráramos, cualquiera con acceso a la llave leería las contraseñas de todos tus
clientes. Con hash, no. Supabase Auth ya lo hace bien, y nosotros no escribimos ni una
línea de eso.

## 4. Las tres preguntas abiertas

### 4.1 "Local lleno" — tres opciones

**Opción 1 — El anónimo no usa el registro de Supabase (recomendada)**
El anónimo tiene identificador local de 128 bits. La cuota de 30 por hora solo aplica a
registros reales, que son pocos y espaciados. Cero cambios en el panel, cero captcha.
*Costo:* el identificador anónimo no lo emite el servidor, así que hay que firmarlo
(ver 4.3) para que no se pueda falsificar.

**Opción 2 — Subir el límite del panel a 500 por hora + captcha invisible**
El anónimo sí crea usuario en Supabase Auth. Se sube el tope y se activa Cloudflare
Turnstile, que no muestra nada al usuario.
*Costo:* cada visitante crea una fila en `auth.users` para siempre; hay que programar la
limpieza. Y el captcha, aunque invisible, puede fallar en navegadores viejos.

**Opción 3 — Cola con reintento en el dispositivo**
Si el servidor rechaza por saturación, el cliente sigue con identidad local y reintenta
en segundo plano.
*Costo:* dos modos de identidad conviviendo, y el doble de casos que probar. No la
recomiendo: es complejidad permanente para un problema de una noche.

### 4.2 "Si falla" — tres opciones

**Opción 1 — Degradar en silencio al perfil anónimo (recomendada)**
Si el registro o el inicio de sesión no responden, el cliente sigue como anónimo y puede
pedir igual. Se le avisa en una línea, sin bloquear: "Sin conexión. Puedes seguir
pidiendo como invitado."
*Costo:* el cliente queda anónimo sin haberlo pedido; hay que decírselo con claridad.

**Opción 2 — Reintentar con aviso visible**
Se muestra "Conectando…" con reintentos automáticos durante unos segundos.
*Costo:* si el local no tiene buena señal, el cliente ve una espera que no pidió, justo
cuando quiere pedir rápido.

**Opción 3 — Bloquear hasta que haya conexión**
No se puede pedir sin identidad.
*Costo:* alto. Un cliente con hambre y mala señal se va. No la recomiendo.

### 4.3 "Leer pedidos ajenos" en modo anónimo — tres opciones

El problema: si el identificador lo declara el navegador, cualquiera que lo adivine lee
ese historial. Las reglas de la base hoy confían en `auth.uid()`, que el anónimo no tiene.

**Opción 1 — Ficha firmada por el servidor (recomendada)**
El cliente pide una ficha a una función del servidor. La función firma el identificador
con una clave secreta que solo el servidor conoce. Cuando el cliente pide su historial,
manda la ficha; una función de la base comprueba la firma antes de devolver nada.
*Costo:* una función nueva en el servidor y otra en la base. El cliente no puede
falsificar su ficha porque no tiene la clave.

**Opción 2 — Solo identificador muy difícil de adivinar**
128 bits aleatorios con generador criptográfico. Adivinarlo es inviable en la práctica.
*Costo:* no es una garantía, es probabilidad. Si algún día el identificador se filtra
—un enlace compartido, una captura de pantalla, un registro de servidor— ese historial
queda expuesto para siempre. Simple, pero flojo.

**Opción 3 — El anónimo no lee historial del servidor**
El historial vive solo en el teléfono. La base no le devuelve nada.
*Costo:* se pierde la campanita en modo anónimo y el historial se va si borra datos.
Es la más segura y la que menos funciones da.

## 5. La campanita (tu punto 3)

Hoy la campanita del cliente está **estructuralmente vacía**, siempre. No es que falle:
no puede funcionar, porque la regla compara contra un identificador que el anónimo no
tiene.

Va junto con lo anterior:
- **Anónimo:** lee sus notificaciones con la ficha firmada (opción 1 de 4.3).
- **Registrado:** lee con su sesión, sin ficha.

## 6. Qué pasa al registrarse (el paso que suele olvidarse)

Un cliente que pidió tres veces como anónimo y después se registra no debería perder
esos pedidos. Al registrarse hay que **reclamar** los pedidos del identificador local y
pasarlos a la cuenta.

Es un paso aparte, con su propia función, y hay que decidir qué pasa si el cliente se
registra desde otro teléfono con un identificador local distinto.

## 7. Lo que hay que configurar fuera del código

| Dónde | Qué | Quién |
|---|---|---|
| Google Cloud Console | Credenciales OAuth, redirect `https://lokeraar.github.io/SakiSushi1/` | Tú, con mi guía |
| Panel de Supabase | Activar proveedor Google; correo y contraseña ya vienen activos | Tú, con mi guía |
| Panel de Supabase | Revisar el límite de registro (solo aplica a registrados) | Yo te digo el valor |
| Base de datos | Funciones nuevas, reglas nuevas, migración | Yo |

## 8. Orden de trabajo propuesto

1. Identificador local de 128 bits (reemplaza el actual, que es débil).
2. Ficha firmada por el servidor + función de lectura.
3. El pedido guarda el identificador (hoy guarda `null`; ahí nace todo el problema).
4. La campanita empieza a funcionar para anónimos.
5. Registro con correo y contraseña, y su inicio de sesión.
6. Registro con Google.
7. Reclamar pedidos al registrarse.
8. Prueba con dos teléfonos: uno pide, el otro no ve nada ajeno.

Los pasos 1 a 4 arreglan lo que hoy está roto. Los pasos 5 a 7 agregan lo nuevo.

## 9. Decisiones que necesito de ti

1. **4.1** — ¿Opción 1, 2 o 3 para la saturación?
2. **4.2** — ¿Opción 1, 2 o 3 si falla la conexión?
3. **4.3** — ¿Opción 1, 2 o 3 para la lectura segura del historial anónimo?
4. **Sección 6** — ¿Qué hacemos con los pedidos que un anónimo hizo antes de registrarse?
5. **Alcance** — ¿Hacemos los pasos 1-4 primero (arreglar lo roto) y los 5-7 después, o
   todo junto?

---

## Estado de ejecución (actualizado)

Decisiones aplicadas: 4.1 opción 1, 4.2 opción 1 con el mensaje acordado, 4.3 opción 1
en versión MVP, sección 5 conectada al código, sección 6 aceptada, sección 7 aprobada.

### Hecho

- Migración 43 aplicada: esquema `private`, secreto de 256 bits, `ficha_valida`,
  `emitir_ficha_cliente`, `cliente_actual`, `pedidos_de_cliente`,
  `notificaciones_de_cliente`, `registrar_push_cliente(p_ficha, ...)`.
- `crear_pedido_con_reserva` recibe `p_ficha` y rechaza el pedido sin identidad.
  Se eliminó la versión vieja de 7 argumentos, que seguía viva con el literal `'anon'`.
- `Cliente/js/cliente-identidad.js`: nuevo módulo de identidad.
- Conectado: registro push, creación de pedidos, campanita.
- El identificador viejo (`Math.random`, 41 bits) se retira de localStorage.

### Verificado contra la base real

| Prueba | Resultado |
|---|---|
| Ficha válida | devuelve su id |
| Ficha con un carácter cambiado | `null` |
| Ficha inventada | `null` |
| Pedido con ficha | creado |
| Pedido sin ficha | 403 `Falta la identidad del cliente` |
| A ve su pedido | sí |
| B ve su pedido | 0 filas |
| A ve el de B | no |
| B ve el de A | no |

### Falta

- Registro con Google (credenciales en Google Cloud Console y panel de Supabase).
- Prueba en dos teléfonos reales.
- Señal visible de "notificaciones activas" en la carta.

### Fase 2 — paso 5 hecho (commit `e555c15`)

- `SakiCliente.registrar`, `iniciarSesion`, `cerrarSesion`, `restaurarSesion`.
- `cliente-cuenta.js`: modal de cuenta y botón en el encabezado.
- Migración 49 (`48bd274`): `reclamar_pedidos_anonimos` mueve pedidos,
  notificaciones y suscripciones push de la ficha a la cuenta.
- Bug corregido: `estaRegistrado()` devolvía `true` siempre.

Verificado con la API real: registro, pedido anónimo, reclamación (1 pedido y
1 notificación movidos), el registrado ve lo suyo, la ficha ya no lo ve, otro
cliente no ve nada ajeno, y sin sesión no se puede reclamar.

**El registro exige "Confirm email" apagado en el panel de Supabase.** Con el
SMTP sin configurar, `/auth/v1/signup` devuelve 500 "Error sending confirmation
email" y la cuenta ni siquiera se crea. Ya quedó apagado.
