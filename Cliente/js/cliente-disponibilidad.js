// cliente-disponibilidad.js — Regla de negocio principal/secundario
//
// LA REGLA (definida por el dueño)
//
//   Falta un ingrediente PRINCIPAL  -> el platillo SE BLOQUEA (agotado,
//                                      grisáceo, sin botón de agregar).
//   Falta un ingrediente SECUNDARIO -> el platillo SIGUE SIENDO ORDENABLE.
//                                      Solo se avisa al cliente.
//   Receta completa                 -> disponible normal.
//
// POR QUÉ ESTE ARCHIVO EXISTE
//
// `cliente-stock.js` calcula el máximo preparable tomando el MÍNIMO entre
// TODOS los ingredientes de la receta:
//
//     minStock = Math.min(minStock, floor(libre / cantidad))
//
// Con esa fórmula, que falte aguacate bloquea el California Roll igual que
// si faltara el cangrejo. La regla de negocio no distingue principal de
// secundario, porque el cálculo nunca miraba el campo `principal`.
//
// NO SE TOCA EL CÁLCULO EXISTENTE
//
// `_stockPrecalculado` sigue siendo la fuente del NÚMERO (cuántos se pueden
// preparar), que es correcto y ya descuenta el carrito. Este archivo agrega
// una capa ENCIMA que decide la DISPONIBILIDAD con la regla nueva.
//
// Ventaja de no tocar cliente-stock.js: si algo sale mal acá, el peor caso
// es el comportamiento anterior. No hay riesgo de romper el conteo.
//
// DE DÓNDE SALE `principal`
//
// De `menu.ingredientes`, que ya lo trae por ingrediente:
//
//   "ing_4560...": { "nombre": "Cangrejo", "cantidad": 0.1, "principal": true }
//
// O sea: NO hace falta consultar la vista `menu_disponibilidad` para esta
// regla. El dato ya viaja en el menú que la app carga. La vista sigue siendo
// útil como fuente de verdad del lado del servidor (la usa la RPC al crear el
// pedido), pero el navegador no necesita una consulta extra.

(function () {
    'use strict';

    /**
     * Calcula la disponibilidad de un platillo aplicando la regla.
     *
     * @param {Object} item      platillo de menuItems (trae .ingredientes)
     * @param {Object} inventario lista de inventario con {id, stock, reservado}
     * @param {Object} reservadoPorCarrito mapa ingId -> cantidad apartada por el carrito
     * @returns {{disponible:boolean, bloqueado:boolean, faltanPrincipales:string[],
     *            faltanSecundarios:string[], maximoPreparables:number, motivo:string}}
     */
    function calcularDisponibilidad(item, inventario, reservadoPorCarrito) {
        reservadoPorCarrito = reservadoPorCarrito || {};

        var faltanPrincipales = [];
        var faltanSecundarios = [];
        var maximo = Infinity;
        var tieneReceta = false;

        if (item && item.ingredientes && typeof item.ingredientes === 'object') {
            for (var ingId in item.ingredientes) {
                if (!item.ingredientes.hasOwnProperty(ingId)) continue;

                var ingInfo  = item.ingredientes[ingId] || {};
                var esPrincipal = ingInfo.principal === true;
                var cantidadPorPlato = parseFloat(ingInfo.cantidad) || 1;
                var nombre = ingInfo.nombre || ingId;

                tieneReceta = true;

                var ing = null;
                for (var i = 0; i < (inventario || []).length; i++) {
                    if (inventario[i].id === ingId) { ing = inventario[i]; break; }
                }

                if (!ing) {
                    // Ingrediente de la receta que no existe en inventario.
                    // Es un error de datos: se trata como principal faltante,
                    // porque no se puede garantizar su preparación.
                    (esPrincipal ? faltanPrincipales : faltanSecundarios).push(nombre);
                    continue;
                }

                var libre = (parseFloat(ing.stock) || 0)
                          - (parseFloat(ing.reservado) || 0)
                          - (reservadoPorCarrito[ingId] || 0);

                // Cuántos platos alcanzan con este ingrediente
                var alcanza = Math.floor(libre / cantidadPorPlato);
                if (alcanza < maximo) maximo = alcanza;

                if (libre < cantidadPorPlato) {
                    (esPrincipal ? faltanPrincipales : faltanSecundarios).push(nombre);
                }
            }
        }

        if (!tieneReceta) {
            // Sin receta no hay forma de calcular. Se asume agotado, igual que
            // hace cliente-stock.js, para no pintar disponible algo imposible.
            return {
                disponible: false,
                bloqueado: true,
                faltanPrincipales: [],
                faltanSecundarios: [],
                maximoPreparables: 0,
                motivo: 'sin-receta'
            };
        }

        var maximoFinal = (maximo === Infinity) ? 0 : Math.max(0, maximo);

        // REGLA DEL DUEÑO, que MANDA sobre el número:
        //   Falta un PRINCIPAL  -> se bloquea.
        //   Falta un SECUNDARIO -> SIGUE disponible, aunque el mínimo
        //                          calculado haya dado 0. El platillo se
        //                          puede preparar sin el secundario.
        //
        // Por eso el `maximoFinal <= 0` NO bloquea cuando el único problema
        // son secundarios: el 0 viene de dividir por un ingrediente que
        // puede omitirse. Bloquear ahí sería contradecir la regla.
        var bloqueado;
        if (faltanPrincipales.length > 0) {
            bloqueado = true;
        } else if (maximoFinal <= 0 && faltanSecundarios.length === 0) {
            // Agotado de verdad: nada falta por receta, pero no alcanza.
            bloqueado = true;
        } else {
            bloqueado = false;
        }

        var motivo = 'ok';
        if (faltanPrincipales.length > 0)      motivo = 'falta-principal';
        else if (faltanSecundarios.length > 0) motivo = 'falta-secundario';
        else if (maximoFinal <= 0)             motivo = 'agotado';

        return {
            disponible: !bloqueado,
            bloqueado: bloqueado,
            faltanPrincipales: faltanPrincipales,
            faltanSecundarios: faltanSecundarios,
            maximoPreparables: maximoFinal,
            motivo: motivo
        };
    }

    /**
     * Recalcula la disponibilidad de TODOS los platillos del menú.
     * Devuelve un mapa platilloId -> resultado.
     */
    function calcularTodas(menuItems, inventario, carrito) {
        var reservadoPorCarrito = {};

        (carrito || []).forEach(function (inst) {
            var pl = null;
            for (var i = 0; i < (menuItems || []).length; i++) {
                if (menuItems[i].id === inst.platilloId) { pl = menuItems[i]; break; }
            }
            if (!pl || !pl.ingredientes) return;

            Object.keys(pl.ingredientes).forEach(function (ingId) {
                // Ingrediente quitado por el cliente: no consume
                if (inst.personalizacion && inst.personalizacion.indexOf(ingId) !== -1) return;
                if (inst.ingredientesQuitados && inst.ingredientesQuitados.indexOf(ingId) !== -1) return;

                var cant = parseFloat(pl.ingredientes[ingId].cantidad) || 1;
                var veces = parseFloat(inst.cantidad) || 1;
                reservadoPorCarrito[ingId] = (reservadoPorCarrito[ingId] || 0) + cant * veces;
            });
        });

        var resultado = {};
        (menuItems || []).forEach(function (item) {
            resultado[item.id] = calcularDisponibilidad(item, inventario, reservadoPorCarrito);
        });
        return resultado;
    }

    /**
     * Aplica el resultado al DOM: bloquea las tarjetas de los platillos cuyo
     * principal falta, y deja solo un aviso en los que solo pierden un
     * secundario.
     */
    function aplicarAlDom(resultado) {
        document.querySelectorAll('.menu-card').forEach(function (card) {
            var id = card.dataset.id;
            if (!id) return;
            var r = resultado[id];
            if (!r) return;

            var btnAdd = card.querySelector('.btn-add');

            if (r.bloqueado) {
                card.classList.add('agotado');
                if (btnAdd) {
                    btnAdd.disabled = true;
                    btnAdd.setAttribute('disabled', 'disabled');
                    btnAdd.title = 'Agotado';
                }
            } else {
                card.classList.remove('agotado');
                if (btnAdd) {
                    btnAdd.disabled = false;
                    btnAdd.removeAttribute('disabled');
                    btnAdd.title = 'Agregar al carrito';
                }
            }

            // Aviso de secundarios faltantes. Se muestra aunque el platillo
            // siga disponible: el cliente tiene que saber que viene incompleto.
            var aviso = card.querySelector('.aviso-secundarios');
            if (r.faltanSecundarios.length > 0 && r.motivo === 'falta-secundario') {
                if (!aviso) {
                    aviso = document.createElement('div');
                    aviso.className = 'aviso-secundarios';
                    aviso.style.cssText = 'font-size:.72rem;color:#FF9800;padding:.35rem .5rem;' +
                        'border-top:1px solid rgba(255,255,255,.08);display:flex;gap:.3rem;align-items:center';
                    var cont = card.querySelector('.menu-card-content');
                    if (cont) cont.appendChild(aviso);
                }
                aviso.innerHTML = '<i class="fas fa-exclamation-triangle"></i> Sin ' +
                    r.faltanSecundarios.join(', ');
            } else if (aviso && aviso.parentNode) {
                aviso.parentNode.removeChild(aviso);
            }
        });
    }

    window.calcularDisponibilidad = calcularDisponibilidad;
    window.calcularDisponibilidadTodas = calcularTodas;
    window.aplicarDisponibilidadAlDom = aplicarAlDom;

    /** Punto de entrada: recalcula y pinta. Idempotente y seguro de llamar. */
    window.actualizarDisponibilidadMenu = function () {
        if (!window.Saki || !window.Saki.state) return null;
        var r = calcularTodas(
            window.Saki.state.menuItems || [],
            window.Saki.state.inventario || [],
            window.Saki.state.carrito || []
        );
        window._disponibilidad = r;
        aplicarAlDom(r);
        return r;
    };
})();
