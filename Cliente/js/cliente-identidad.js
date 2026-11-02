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

    /** ¿Hay sesión real de Supabase Auth? Entonces el cliente está registrado. */
    function estaRegistrado() {
        return !!(window.supabaseClient && window.supabaseClient.auth);
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
            return window.supabaseClient.auth.getSession().then(function (r) {
                var sesion = r && r.data && r.data.session;
                if (sesion && sesion.user) {
                    return { tipo: 'registrado', id: sesion.user.id, ficha: null };
                }
                return obtenerFicha().then(function (f) {
                    return { tipo: 'anonimo', id: idActual(f), ficha: f };
                });
            });
        }
        return obtenerFicha().then(function (f) {
            return { tipo: 'anonimo', id: idActual(f), ficha: f };
        });
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
        idActual: idActual,
        olvidar: olvidar
    };
})();
