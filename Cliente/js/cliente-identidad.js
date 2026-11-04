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
    // El cliente NO usa la sesión de GoTrue del cliente Supabase: ese cliente
    // se crea con `persistSession: false` y `autoRefreshToken: false`, y
    // toda la app manda el token por cabecera. Acá se sigue el mismo camino
    // que el panel de administración: el token se guarda y se reconstruye el
    // cliente Supabase con él, para que Realtime y RLS lo vean.

    var CLAVE_TOKEN = 'saki_token_cliente';
    var CLAVE_USUARIO = 'saki_usuario_cliente';

    /**
     * Mensajes de error de Supabase Auth, traducidos a algo que se entienda.
     *
     * Los originales vienen en inglés y con jerga ('Invalid login
     * credentials'). En una carta de restaurante eso no se le muestra a nadie.
     * Se decide por el código cuando viene, y por el texto como respaldo.
     */
    function traducirErrorDeCuenta(error) {
        if (!error) return 'No se pudo completar la operación.';
        var codigo = error.code || error.error_code || '';
        var texto = (error.message || '').toLowerCase();

        if (codigo === 'invalid_credentials' || texto.indexOf('invalid login') >= 0) {
            return 'El correo o la contraseña no son correctos.';
        }
        if (codigo === 'email_exists' || texto.indexOf('already registered') >= 0) {
            return 'Ya existe una cuenta con este correo. Inicia sesión.';
        }
        if (codigo === 'weak_password' || texto.indexOf('password should be') >= 0) {
            return 'La contraseña es muy corta. Usa al menos 6 caracteres.';
        }
        if (codigo === 'email_address_invalid' || texto.indexOf('invalid email') >= 0) {
            return 'Escribe un correo válido, por ejemplo nombre@correo.com.';
        }
        if (codigo === 'email_not_confirmed' || texto.indexOf('not confirmed') >= 0) {
            return 'Falta confirmar tu correo. Revisa tu bandeja de entrada.';
        }
        if (codigo === 'over_email_send_rate_limit' || texto.indexOf('rate limit') >= 0) {
            return 'Demasiados intentos seguidos. Espera un minuto y vuelve a probar.';
        }
        if (texto.indexOf('failed to fetch') >= 0 || texto.indexOf('network') >= 0) {
            return 'No hay conexión. Revisa tu internet e inténtalo otra vez.';
        }
        return error.message || 'No se pudo completar la operación.';
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
        if (!window.supabaseClient) {
            return Promise.reject(new Error('sin_cliente_supabase'));
        }
        var email = String(correo || '').trim();
        var pass = String(contrasena || '');

        if (!email || email.indexOf('@') < 1) {
            return Promise.reject(new Error('Escribe un correo válido, por ejemplo nombre@correo.com.'));
        }
        if (pass.length < 6) {
            return Promise.reject(new Error('La contraseña es muy corta. Usa al menos 6 caracteres.'));
        }

        var fichaAntes = fichaMemoria || leerGuardada();

        return window.supabaseClient.auth
            .signUp({ email: email, password: pass })
            .then(function (resp) {
                if (resp.error) throw resp.error;
                var sesion = resp.data && resp.data.session;

                // Sin sesión: el proyecto exige confirmar el correo. No es un
                // error, pero tampoco hay cuenta usable todavía.
                if (!sesion) {
                    return {
                        success: true,
                        requiereConfirmacion: true,
                        correo: email,
                        mensaje: 'Te enviamos un correo para confirmar la cuenta. ' +
                                 'Ábrelo y después vuelve a entrar.'
                    };
                }

                guardarSesion(sesion);
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
        if (!window.supabaseClient) {
            return Promise.reject(new Error('sin_cliente_supabase'));
        }
        var email = String(correo || '').trim();
        var pass = String(contrasena || '');

        if (!email || !pass) {
            return Promise.reject(new Error('Escribe tu correo y tu contraseña.'));
        }

        var fichaAntes = fichaMemoria || leerGuardada();

        return window.supabaseClient.auth
            .signInWithPassword({ email: email, password: pass })
            .then(function (resp) {
                if (resp.error) throw resp.error;
                var sesion = resp.data && resp.data.session;
                if (!sesion) throw new Error('No se pudo iniciar sesión.');

                guardarSesion(sesion);
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

    /**
     * Cierra la sesión y vuelve a navegar como anónimo.
     *
     * La ficha se CONSERVA: si el cliente vuelve a pedir sin entrar, sus
     * pedidos nuevos quedan en este teléfono y podrá reclamarlos la próxima
     * vez, igual que antes de registrarse.
     */
    function cerrarSesion() {
        usuarioActual = null;
        try {
            localStorage.removeItem(CLAVE_TOKEN);
            localStorage.removeItem(CLAVE_USUARIO);
        } catch (e) { /* modo privado */ }

        var salida = window.supabaseClient && window.supabaseClient.auth
            ? window.supabaseClient.auth.signOut().catch(function () { return null; })
            : Promise.resolve(null);

        return salida.then(function () {
            if (typeof window.inicializarSupabaseCliente === 'function') {
                window.supabaseClient = window.inicializarSupabaseCliente();
            }
            return true;
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
        registrar: registrar,
        iniciarSesion: iniciarSesion,
        cerrarSesion: cerrarSesion,
        restaurarSesion: restaurarSesion,
        traducirErrorDeCuenta: traducirErrorDeCuenta,
        idActual: idActual,
        olvidar: olvidar
    };
})();
