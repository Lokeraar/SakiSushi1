/**
 * Identidad del cliente de Saki Sushi.
 *
 * Hay dos caminos, y el cliente los usa sin que se le pregunte nada al entrar:
 *
 *   ANÓNIMO (por defecto)
 *     La primera vez que abre la carta pide una ficha al servidor. La ficha
 *     lleva un identificador de 128 bits y una firma que solo el servidor
 *     puede producir. Se guarda en el teléfono y se reutiliza siempre.
 *
 *   REGISTRADO (si el cliente lo elige)
 *     Tiene sesión de Supabase Auth. En ese caso la ficha sobra: el servidor
 *     ya sabe quién es por `auth.uid()`.
 *
 * Por qué una ficha firmada y no un identificador inventado acá:
 * si el número lo inventara el navegador, cualquiera que lo adivinara podría
 * leer el historial de otro. Con firma, cambiar un solo carácter invalida la
 * ficha entera y el servidor la rechaza.
 *
 * Por qué 128 bits y no lo que había antes:
 * el identificador anterior era `cli-<fecha en base36>-<8 de Math.random()>`.
 * `Math.random()` NO es criptográfico, y 8 caracteres son unos 41 bits: algo
 * que una computadora puede recorrer. El nuevo lo emite el servidor con
 * `gen_random_bytes(16)`, que sí es criptográfico.
 */
(function () {
    'use strict';

    var CLAVE = 'saki_ficha_cliente';
    var CLAVE_VIEJA = 'saki_push_session';

    var fichaMemoria = null;
    var pidiendoFicha = null;

    // El cliente con sesión, una vez verificado contra el servidor.
    // `null` = navegando como anónimo.
    var usuarioActual = null;

    function guardar(ficha) {
        fichaMemoria = ficha;
        try { localStorage.setItem(CLAVE, ficha); } catch (e) { /* modo privado */ }
    }

    function leerGuardada() {
        try { return localStorage.getItem(CLAVE); } catch (e) { return null; }
    }

    /**
     * Devuelve el identificador que la base verificó, o null si todavía no
     * hay ficha.
     *
     * Ojo: esto es solo para mostrar y para depurar. Nada de seguridad
     * depende de este valor, porque lo que vale es la firma que lo acompaña.
     */
    function idActual(ficha) {
        if (!ficha) return null;
        var i = ficha.indexOf('.');
        return i > 0 ? ficha.slice(0, i) : null;
    }

    /**
     * Pide una ficha nueva al servidor. Es idempotente mientras esté en curso:
     * varias llamadas simultáneas comparten la misma promesa, para no emitir
     * dos fichas si dos partes de la carta piden identidad al mismo tiempo.
     */
    function pedirFicha() {
        if (!window.supabaseClient) {
            return Promise.reject(new Error('sin_cliente_supabase'));
        }
        if (pidiendoFicha) return pidiendoFicha;

        pidiendoFicha = window.supabaseClient
            .rpc('emitir_ficha_cliente')
            .then(function (resp) {
                pidiendoFicha = null;
                if (resp.error || !resp.data) {
                    throw new Error(resp.error ? resp.error.message : 'sin_ficha');
                }
                guardar(resp.data);
                return resp.data;
            })
            .catch(function (e) {
                pidiendoFicha = null;
                throw e;
            });

        return pidiendoFicha;
    }

    /**
     * La ficha del cliente, creándola si hace falta.
     *
     * Nunca lanza: si no hay conexión, devuelve la que hubiera guardada (o
     * null). La carta tiene que seguir funcionando sin señal.
     */
    function obtenerFicha() {
        if (fichaMemoria) return Promise.resolve(fichaMemoria);

        var guardada = leerGuardada();
        if (guardada) {
            fichaMemoria = guardada;
            return Promise.resolve(guardada);
        }

        return pedirFicha().catch(function () {
            // Sin conexión o sin servidor: se sigue como se pueda. Quien llame
            // decide qué hacer; casi siempre es "el cliente puede pedir igual
            // cuando vuelva la señal".
            return null;
        });
    }

    /**
     * ¿Hay una sesión real de cliente registrado?
     *
     * Antes esta función devolvía `!!(window.supabaseClient && window.supabaseClient.auth)`.
     * `supabaseClient.auth` existe SIEMPRE, incluso sin sesión, así que
     * devolvía `true` para todo el mundo. Funcionaba por accidente —quien
     * llamaba caía al respaldo de la ficha— pero la señal era falsa.
     *
     * El cliente se crea con `persistSession: false`, así que no hay sesión
     * guardada que consultar de forma síncrona. Lo que sí es fiable y barato
     * es la marca que deja `iniciarSesion()` en `usuarioActual`.
     */
    function estaRegistrado() {
        return !!(usuarioActual && usuarioActual.id);
    }

    /** Devuelve el usuario con sesión, o null. */
    function usuario() {
        return usuarioActual ? usuarioActual : null;
    }

    /**
     * Espera a tener identidad, sea del tipo que sea.
     *
     * Es lo que hay que llamar antes de crear un pedido: los pedidos sin
     * identidad se rechazan desde la migración 43.
     */
    function asegurarIdentidad() {
        if (!window.supabaseClient) {
            return Promise.reject(new Error('sin_cliente_supabase'));
        }
        if (estaRegistrado()) {
            return Promise.resolve({
                tipo: 'registrado',
                id: usuarioActual.id,
                ficha: null
            });
        }
        return obtenerFicha().then(function (f) {
            return { tipo: 'anonimo', id: idActual(f), ficha: f };
        });
    }

    // ══════════════════════════════════════════════════════════════
    //  CUENTA: registrarse, entrar, salir
    // ══════════════════════════════════════════════════════════════
    //
    // POR QUÉ NO SE USA `supabaseClient.auth`
    //
    // El primer intento llamaba a `supabaseClient.auth.signInWithPassword()`
    // y `signOut()` directamente. Colgaba: el botón se quedaba en "Entrando..."
    // para siempre, y "Cerrar sesión" no hacía nada.
    //
    // El motivo es que `inicializarSupabaseCliente()` crea un cliente nuevo en
    // cada entrada y en cada salida (con `persistSession: false`), y GoTrue se
    // protege con un candado interno ligado al `storageKey`. Con dos instancias
    // vivas sobre el mismo `storageKey`, `signOut()` se queda esperando un
    // candado que la otra instancia nunca libera. La promesa no resuelve ni
    // falla: solo espera. De ahí el botón congelado.
    //
    // La salida es la misma que usa el panel de administración desde siempre:
    // hablar con la API de Auth por `fetch`, con el token en una cabecera. Sin
    // candados, sin estado escondido, y verificable desde una terminal.

    var CLAVE_TOKEN = 'saki_token_cliente';
    var CLAVE_USUARIO = 'saki_usuario_cliente';

    // El último correo con el que se entró, para no obligar a escribirlo otra
    // vez. No es un dato sensible: es lo que la persona tecleó, y sirve para
    // que al volver a entrar solo ponga la contraseña.
    var CLAVE_ULTIMO_CORREO = 'saki_ultimo_correo';

    // Tope de espera para toda llamada de cuenta. Sin esto, cualquier cuelgue
    // futuro vuelve a dejar el botón en "Entrando..." sin explicación. Con
    // esto, a los 20 segundos hay un mensaje y la persona puede reintentar.
    var SEGUNDOS_MAXIMOS = 20;
    var SIN_RESPUESTA = 'La conexión tardó demasiado. Revisa tu internet e inténtalo otra vez.';

    var SIN_CONEXION = 'No hay conexión. Revisa tu internet e inténtalo otra vez.';

    /**
     * Corta una promesa que se quedó esperando.
     *
     * Las carreras de promesas no cancelan el trabajo de fondo: si la llamada
     * original responde después, su resultado se descarta. Para lo que importa
     * acá —que la persona no quede mirando un botón trabado— alcanza y sobra.
     */
    function conTiempoLimite(promesa) {
        return new Promise(function (resolver, rechazar) {
            var cerrado = false;
            var reloj = setTimeout(function () {
                if (cerrado) return;
                cerrado = true;
                rechazar(new Error(SIN_RESPUESTA));
            }, SEGUNDOS_MAXIMOS * 1000);

            promesa.then(function (valor) {
                if (cerrado) return;
                cerrado = true;
                clearTimeout(reloj);
                resolver(valor);
            }, function (error) {
                if (cerrado) return;
                cerrado = true;
                clearTimeout(reloj);
                rechazar(error);
            });
        });
    }

    /**
     * Una llamada a la API de Auth de Supabase.
     *
     * Devuelve el cuerpo ya convertido. Si el servidor responde con error,
     * lanza un `Error` que lleva `datos` con el cuerpo original, para que
     * `traducirErrorDeCuenta()` pueda leer el código exacto.
     */
    function peticionAuth(ruta, cuerpo) {
        if (!window.SUPABASE_URL || !window.SUPABASE_ANON_KEY) {
            return Promise.reject(new Error('La aplicación no terminó de cargar. Cierra y vuelve a abrir.'));
        }

        var envio = fetch(window.SUPABASE_URL + '/auth/v1' + ruta, {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json',
                'apikey': window.SUPABASE_ANON_KEY,
                'Authorization': 'Bearer ' + window.SUPABASE_ANON_KEY
            },
            body: JSON.stringify(cuerpo || {})
        }).then(function (respuesta) {
            return respuesta.text().then(function (bruto) {
                var datos = null;
                try { datos = JSON.parse(bruto); } catch (e) { datos = null; }

                if (!respuesta.ok) {
                    var error = new Error('auth_error');
                    error.status = respuesta.status;
                    error.datos = datos || {};
                    throw error;
                }
                return datos || {};
            });
        }).catch(function (error) {
            // `fetch` rechaza con TypeError cuando no hay red. Se traduce ANTES
            // del tiempo límite, para que ese mensaje no lo pise el de
            // "tardó demasiado": si no hay conexión, lo útil es decirlo, no
            // esperar 20 segundos para avisar de una espera.
            if (error && error.name === 'TypeError') throw new Error(SIN_CONEXION);
            throw error;
        });

        return conTiempoLimite(envio);
    }

    /**
     * Saca la sesión del cuerpo de Auth.
     *
     * `/signup` y `/token` devuelven el token arriba, pero por si el servidor
     * cambia de forma se mira también `session`.
     */
    function sesionDesde(datos) {
        if (!datos) return null;
        var crudo = datos.session || datos;
        if (!crudo || !crudo.access_token) return null;
        return {
            access_token: crudo.access_token,
            refresh_token: crudo.refresh_token || null,
            user: crudo.user || datos.user || null
        };
    }

    /**
     * Mensajes de error de Supabase Auth, traducidos a algo que se entienda.
     *
     * Los originales vienen en inglés y con jerga ('Invalid login
     * credentials'). En una carta de restaurante eso no se le muestra a nadie.
     * Se decide por el código cuando viene, y por el texto como respaldo.
     */
    function traducirErrorDeCuenta(error) {
        if (!error) return 'No se pudo completar la operación.';
        var datos = error.datos || {};
        var codigo = error.code || error.error_code || datos.error_code || datos.code || '';
        var texto = String(
            error.message || datos.msg || datos.message || datos.error_description || ''
        ).toLowerCase();

        if (codigo === 'invalid_credentials' || texto.indexOf('invalid login') >= 0 ||
            texto.indexOf('invalid credentials') >= 0) {
            return 'El correo o la contraseña no son correctos.';
        }
        if (codigo === 'user_already_exists' || codigo === 'email_exists' ||
            texto.indexOf('already registered') >= 0 || texto.indexOf('already exists') >= 0) {
            return 'Ya existe una cuenta con este correo. Inicia sesión.';
        }
        if (codigo === 'weak_password' || texto.indexOf('password should be') >= 0) {
            return 'La contraseña es muy corta. Usa al menos 6 caracteres.';
        }
        if (codigo === 'email_address_invalid' || texto.indexOf('invalid email') >= 0 ||
            texto.indexOf('unable to validate email') >= 0) {
            return 'Escribe un correo válido, por ejemplo nombre@correo.com.';
        }
        if (codigo === 'email_not_confirmed' || texto.indexOf('not confirmed') >= 0) {
            return 'Falta confirmar tu correo. Revisa tu bandeja de entrada.';
        }
        if (codigo === 'over_email_send_rate_limit' || codigo === 'over_request_rate_limit' ||
            texto.indexOf('rate limit') >= 0 || texto.indexOf('too many') >= 0) {
            return 'Demasiados intentos seguidos. Espera un minuto y vuelve a probar.';
        }
        if (codigo === 'signup_disabled') {
            return 'El registro está desactivado en este momento.';
        }
        if (error.status === 429) {
            return 'Demasiados intentos seguidos. Espera un minuto y vuelve a probar.';
        }
        if (error.status >= 500) {
            return 'El servidor no respondió bien. Inténtalo otra vez en un momento.';
        }
        // Cuando el mensaje ya viene en español (nuestras propias
        // validaciones), se deja tal cual.
        if (error.message && error.message !== 'auth_error') return error.message;
        return 'No se pudo completar la operación.';
    }

    function guardarSesion(sesion) {
        if (!sesion || !sesion.user || !sesion.access_token) return null;
        usuarioActual = {
            id: sesion.user.id,
            correo: sesion.user.email || '',
            token: sesion.access_token
        };
        try {
            localStorage.setItem(CLAVE_TOKEN, sesion.access_token);
            localStorage.setItem(CLAVE_USUARIO, JSON.stringify({
                id: usuarioActual.id,
                correo: usuarioActual.correo
            }));
        } catch (e) { /* modo privado */ }

        // Reconstruir el cliente con el token: así RLS y Realtime ven al
        // usuario. Sin esto las consultas seguirían viajando como anónimo
        // aunque la persona crea que ya entró.
        if (typeof window.inicializarSupabaseCliente === 'function') {
            window.supabaseClient = window.inicializarSupabaseCliente(sesion.access_token);
        }
        return usuarioActual;
    }

    /**
     * Crea la cuenta con correo y contraseña.
     *
     * Después de crearla, reclama los pedidos que el cliente hubiera hecho
     * como anónimo en este mismo teléfono (migración 49).
     */
    function registrar(correo, contrasena) {
        var email = String(correo || '').trim();
        var pass = String(contrasena || '');

        if (!email || email.indexOf('@') < 1) {
            return Promise.reject(new Error('Escribe un correo válido, por ejemplo nombre@correo.com.'));
        }
        if (pass.length < 6) {
            return Promise.reject(new Error('La contraseña es muy corta. Usa al menos 6 caracteres.'));
        }

        var fichaAntes = fichaMemoria || leerGuardada();

        return peticionAuth('/signup', { email: email, password: pass })
            .then(function (datos) {
                var sesion = sesionDesde(datos);

                // Sin sesión: el proyecto exige confirmar el correo. No es un
                // error, pero tampoco hay cuenta usable todavía.
                if (!sesion || !sesion.user) {
                    return {
                        success: true,
                        requiereConfirmacion: true,
                        correo: email,
                        mensaje: 'Te enviamos un correo para confirmar la cuenta. ' +
                                 'Ábrelo y después vuelve a entrar.'
                    };
                }

                guardarSesion(sesion);
                _carritoAlEntrar(sesion);
                return reclamarPedidos(fichaAntes).then(function (rec) {
                    return {
                        success: true,
                        requiereConfirmacion: false,
                        usuario: usuarioActual,
                        reclamados: rec
                    };
                });
            })
            .catch(function (error) {
                throw new Error(traducirErrorDeCuenta(error));
            });
    }

    /** Entra con correo y contraseña, y reclama los pedidos anónimos. */
    function iniciarSesion(correo, contrasena) {
        var email = String(correo || '').trim();
        var pass = String(contrasena || '');

        if (!email || !pass) {
            return Promise.reject(new Error('Escribe tu correo y tu contraseña.'));
        }

        var fichaAntes = fichaMemoria || leerGuardada();

        return peticionAuth('/token?grant_type=password', { email: email, password: pass })
            .then(function (datos) {
                var sesion = sesionDesde(datos);
                if (!sesion || !sesion.user) {
                    throw new Error('El correo o la contraseña no son correctos.');
                }

                guardarSesion(sesion);
                _carritoAlEntrar(sesion);
                return reclamarPedidos(fichaAntes).then(function (rec) {
                    return { success: true, usuario: usuarioActual, reclamados: rec };
                });
            })
            .catch(function (error) {
                throw new Error(traducirErrorDeCuenta(error));
            });
    }

    /**
     * Pide al servidor que pase los pedidos de la ficha a la cuenta.
     *
     * Nunca rechaza: si falla, la sesión ya está abierta y lo único que se
     * pierde es el traslado. Devolver un error acá abortaría un registro que
     * en realidad salió bien.
     */
    function reclamarPedidos(ficha) {
        if (!ficha) return Promise.resolve(null);
        return window.supabaseClient
            .rpc('reclamar_pedidos_anonimos', { p_ficha: ficha })
            .then(function (r) {
                if (r.error) {
                    console.warn('No se pudieron reclamar los pedidos:', r.error.message);
                    return null;
                }
                return r.data;
            })
            .catch(function (e) {
                console.warn('No se pudieron reclamar los pedidos:', e.message);
                return null;
            });
    }

    /** El último correo con el que se entró, o cadena vacía. */
    function ultimoCorreo() {
        try { return localStorage.getItem(CLAVE_ULTIMO_CORREO) || ''; }
        catch (e) { return ''; }
    }

    /**
     * Avisa al carrito que se abrió una cuenta.
     *
     * Si la persona venía armando un pedido como invitado, ese pedido manda:
     * es la misma persona, ahora con nombre, y no debe perder lo que llevaba.
     * El carrito decide el resto (ver `alEntrarACuenta` en cliente-carrito.js).
     *
     * Nunca rechaza: si el carrito todavía no cargó, la sesión igual vale.
     */
    function _carritoAlEntrar(sesion) {
        try {
            var id = sesion && sesion.user ? sesion.user.id : null;
            if (id && typeof window.alEntrarACuenta === 'function') {
                window.alEntrarACuenta(id);
            }
        } catch (e) {
            console.warn('No se pudo ajustar el carrito al entrar:', e && e.message);
        }
    }

    /**
     * Cierra la sesión y vuelve a navegar como anónimo.
     *
     * La ficha se CONSERVA: si el cliente vuelve a pedir sin entrar, sus
     * pedidos nuevos quedan en este teléfono y podrá reclamarlos la próxima
     * vez, igual que antes de registrarse.
     *
     * Esto NO espera a la red. Antes se llamaba a `signOut()` de GoTrue y la
     * promesa se quedaba colgada, así que el modal nunca se cerraba. Cerrar
     * sesión acá es soltar el token guardado y volver al cliente anónimo: eso
     * es instantáneo y no depende de que el servidor conteste. El aviso al
     * servidor se manda igual, pero sin bloquear nada.
     */
    function cerrarSesion() {
        var tokenViejo = usuarioActual ? usuarioActual.token : null;
        var correoViejo = usuarioActual ? usuarioActual.correo : '';
        var idViejo = usuarioActual ? usuarioActual.id : null;

        usuarioActual = null;
        try {
            localStorage.removeItem(CLAVE_TOKEN);
            localStorage.removeItem(CLAVE_USUARIO);
            // El correo SÍ se conserva: es lo que la persona vuelve a escribir
            // si quiere entrar otra vez, y ya está probado que existe.
            if (correoViejo) localStorage.setItem(CLAVE_ULTIMO_CORREO, correoViejo);
        } catch (e) { /* modo privado */ }

        if (typeof window.inicializarSupabaseCliente === 'function') {
            window.supabaseClient = window.inicializarSupabaseCliente();
        }

        // El carrito pertenecía a la cuenta que se va. Se guarda bajo su id y
        // la pantalla vuelve a quedar como un invitado recién llegado. Si no
        // se hiciera, quien entre después con OTRA cuenta vería el pedido de
        // la anterior: mismo teléfono, misma pestaña, mismo `localStorage`.
        try {
            if (typeof window.alSalirDeCuenta === 'function') {
                window.alSalirDeCuenta(idViejo);
            }
        } catch (e) {
            console.warn('No se pudo limpiar el carrito al salir:', e && e.message);
        }

        // Se le avisa al servidor para que invalide la sesión, pero el
        // resultado no le importa a nadie acá: si falla, el token ya no está
        // guardado en este teléfono, que es lo que hacía falta.
        if (tokenViejo) {
            try {
                fetch(window.SUPABASE_URL + '/auth/v1/logout', {
                    method: 'POST',
                    headers: {
                        'apikey': window.SUPABASE_ANON_KEY,
                        'Authorization': 'Bearer ' + tokenViejo
                    }
                }).catch(function () { /* el token local ya se borró */ });
            } catch (e) { /* el token local ya se borró */ }
        }

        return Promise.resolve(true);
    }

    /**
     * Entra con Google OAuth.
     *
     * Redirige al navegador a Google. Cuando la persona acepta, Google vuelve
     * a la carta y Supabase procesa el callback. En ese momento,
     * `recuperarSesionOAuth()` (llamada al arrancar la carta) detecta la
     * sesión y la deja activa.
     *
     * El `redirectTo` es la propia carta, para que vuelva aquí después de
     * autenticar con Google.
     */
    function iniciarConGoogle() {
        if (!window.supabaseClient) {
            return Promise.reject(new Error('sin_cliente_supabase'));
        }

        // El método es `signInWithOAuth`, NO `signInWithOAuthProvider`.
        // Con el nombre equivocado no pasa nada al tocar el botón: la llamada
        // revienta con un TypeError que nadie ve la Promise, así que la pantalla
        // se queda quieta y parece que el botón no funciona.
        //
        // Por defecto este método redirige la página entera a Google. Eso es
        // justo lo que queremos: el selector de cuentas de Google aparece ahí.
        return window.supabaseClient.auth
            .signInWithOAuth({
                provider: 'google',
                options: {
                    redirectTo: 'https://lokeraar.github.io/SakiSushi1/Cliente/index.html'
                }
            })
            .then(function (resp) {
                if (resp && resp.error) throw resp.error;
                return resp;
            });
    }

    /**
     * Detecta una sesión de OAuth tras volver de Google.
     *
     * Se llama al arrancar la carta. Si hay sesión (Google acaba de redirigir
     * acá), la guarda y la deja activa. Devuelve el usuario o null.
     */
    /**
     * Lee los parámetros que Supabase devuelve en el hash al volver de Google.
     *
     * POR QUÉ HACE FALTA ESTO A MANO
     *
     * Supabase redirige de vuelta con los tokens en el hash:
     *   index.html#access_token=...&refresh_token=...&type=bearer
     *
     * El SDK los lería solo si `detectSessionInUrl` estuviera en `true`, pero
     * nuestro cliente lo tiene en `false` (se creó así para no mezclar la
     * sesión de GoTrue con el token que la app manda por cabecera).
     *
     * Consecuencia si nadie los lee: la persona vuelve de Google, la carta
     * carga normal, y SIGUE ANÓNIMA. Sin error, sin aviso. Por eso se leen acá.
     */
    function leerHashOAuth() {
        var hash = window.location.hash || '';
        if (hash.charAt(0) === '#') hash = hash.slice(1);
        if (!hash) return null;

        var datos = {};
        hash.split('&').forEach(function (par) {
            var i = par.indexOf('=');
            if (i < 0) return;
            var clave = decodeURIComponent(par.slice(0, i));
            var valor = decodeURIComponent(par.slice(i + 1).replace(/\+/g, ' '));
            datos[clave] = valor;
        });
        return datos;
    }

    /** Quita el hash de la barra de direcciones, sin recargar ni saltar. */
    function limpiarHashOAuth() {
        try {
            var limpia = window.location.pathname + window.location.search;
            window.history.replaceState({}, document.title, limpia);
        } catch (e) { /* si el navegador no deja, el hash se queda; no es grave */ }
    }

    /**
     * Detecta una sesión de OAuth tras volver de Google.
     *
     * Se llama al arrancar la carta. Hace dos cosas que el SDK no hace por
     * nosotros (ver `leerHashOAuth`):
     *
     *   1. Lee el `access_token` del hash de la URL.
     *   2. Pregunta al servidor quién es el dueño de ese token.
     *
     * El paso 2 es obligatorio: el hash trae el token pero NO el id ni el
     * correo del usuario, y sin el id no se puede guardar la sesión ni
     * reclamar los pedidos anónimos.
     *
     * Devuelve el usuario, o null si no venía de Google.
     */
    function recuperarSesionOAuth() {
        if (!window.supabaseClient && !window.SUPABASE_URL) return Promise.resolve(null);

        var datos = leerHashOAuth();
        if (!datos) return Promise.resolve(null);

        // Google puede volver con un rechazo explícito (la persona canceló,
        // o el proveedor está mal configurado). Se limpia el hash igual para
        // que no quede pegado en la URL, y se sigue como anónimo.
        if (datos.error) {
            console.warn('Google devolvió un error:', datos.error, datos.error_description || '');
            limpiarHashOAuth();
            return Promise.resolve(null);
        }

        var token = datos.access_token;
        if (!token) return Promise.resolve(null);

        var refresh = datos.refresh_token || null;
        limpiarHashOAuth();

        // El hash ya no sirve para nada más; se pide el usuario al servidor.
        return fetch(window.SUPABASE_URL + '/auth/v1/user', {
            headers: {
                'apikey': window.SUPABASE_ANON_KEY,
                'Authorization': 'Bearer ' + token
            }
        })
            .then(function (respuesta) {
                if (!respuesta.ok) throw new Error('token_no_valido');
                return respuesta.json();
            })
            .then(function (usuarioGoogle) {
                if (!usuarioGoogle || !usuarioGoogle.id) throw new Error('sin_usuario');

                guardarSesion({
                    access_token: token,
                    refresh_token: refresh,
                    user: usuarioGoogle
                });
                _carritoAlEntrar({ user: usuarioGoogle });

                // Los pedidos hechos como invitado en este teléfono pasan a la
                // cuenta, igual que al entrar con contraseña.
                var fichaAntes = fichaMemoria || leerGuardada();
                return reclamarPedidos(fichaAntes).then(function () {
                    return usuarioActual;
                });
            })
            .catch(function (e) {
                console.warn('No se pudo completar la sesión de Google:', e.message);
                return null;
            });
    }

    /**
     * Devuelve la sesión guardada, si la hay, y rearma el cliente con ella.
     *
     * Se llama al arrancar la carta. No valida el token contra el servidor:
     * si venció, la primera consulta que lo use fallará y se puede volver a
     * pedir. Validarlo acá retrasaría la carga de la carta sin ganar nada.
     */
    function restaurarSesion() {
        var token = null, datos = null;
        try {
            token = localStorage.getItem(CLAVE_TOKEN);
            datos = JSON.parse(localStorage.getItem(CLAVE_USUARIO) || 'null');
        } catch (e) { return Promise.resolve(null); }

        if (!token || !datos || !datos.id) return Promise.resolve(null);

        usuarioActual = { id: datos.id, correo: datos.correo || '', token: token };
        if (typeof window.inicializarSupabaseCliente === 'function') {
            window.supabaseClient = window.inicializarSupabaseCliente(token);
        }
        return Promise.resolve(usuarioActual);
    }

    /** Borra la identidad local. Sirve para las pruebas y para "cerrar sesión". */
    function olvidar() {
        fichaMemoria = null;
        pidiendoFicha = null;
        try {
            localStorage.removeItem(CLAVE);
            // El identificador viejo se retira: era débil y ya no se usa.
            localStorage.removeItem(CLAVE_VIEJA);
        } catch (e) { /* modo privado */ }
    }

    window.SakiCliente = {
        CLAVE: CLAVE,
        obtenerFicha: obtenerFicha,
        asegurarIdentidad: asegurarIdentidad,
        estaRegistrado: estaRegistrado,
        usuario: usuario,
        ultimoCorreo: ultimoCorreo,
        registrar: registrar,
        iniciarSesion: iniciarSesion,
        cerrarSesion: cerrarSesion,
        restaurarSesion: restaurarSesion,
        recuperarSesionOAuth: recuperarSesionOAuth,
        iniciarConGoogle: iniciarConGoogle,
        traducirErrorDeCuenta: traducirErrorDeCuenta,
        idActual: idActual,
        olvidar: olvidar
    };
})();
