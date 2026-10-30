// admin-tasa-aviso.js — Aviso de tasa vieja, SIN escritura automática
//
// POR QUÉ EXISTE ESTE ARCHIVO
//
// El precio del comensal sale de `config.tasa_efectiva`, y ese valor SOLO
// cambia cuando el admin aprieta GUARDAR en el panel de tasa. Eso es una
// decisión de producto, no una limitación:
//
//   Si el sistema aplicara el aumento solo, un valor mal tipeado (0.1 en vez
//   de 0.01, o 10 en vez de 1) descuadraría todos los precios sin que nadie
//   lo note. El guardado manual es el punto de control humano: si se
//   presionó, fue intencional.
//
// El aumento diario/semanal es deliberadamente pequeño (del orden de 0.01%)
// para que el ajuste sea imperceptible día a día y compense la inflación en
// divisas a lo largo del año, sin espantar al cliente.
//
// Lo que faltaba no era automatismo: era AVISO. Si la tasa confirmada quedó
// vieja respecto al BCV, el admin tiene que enterarse. Este archivo compara
// y avisa. No escribe nada, no confirma nada, no toca `config`.
//
// Depende de `window.obtenerTasaBCV()` (supabase-config.js), que consulta la
// Edge Function y cachea por día.

(function () {
    'use strict';

    // Umbral de aviso: cuánto tiene que moverse el BCV para que valga la pena
    // interrumpir al admin. El aumento diario típico es 0.01%, así que un
    // 0.5% de deriva ya es 50 días de ajuste perdido: eso sí conviene avisarlo.
    var UMBRAL_PORCENTAJE = 0.5;

    // No molestar más de una vez por día por sesión
    function claveVisto(hoy) {
        return 'saki_aviso_tasa_visto_' + hoy;
    }

    function hoyISO() {
        return new Date().toLocaleDateString('en-CA', { timeZone: 'America/Caracas' });
    }

    function porcentajeDeriva(tasaConfirmada, tasaBCV) {
        if (!(tasaConfirmada > 0) || !(tasaBCV > 0)) return 0;
        return Math.abs((tasaBCV - tasaConfirmada) / tasaConfirmada) * 100;
    }

    /**
     * Compara la tasa confirmada en config contra el BCV del día.
     * Devuelve un objeto con el diagnóstico, sin efectos secundarios.
     */
    window.diagnosticarTasa = async function () {
        var cfg = window.configGlobal || {};
        var confirmada = parseFloat(cfg.tasa_cambio) || 0;
        var efectiva   = parseFloat(cfg.tasa_efectiva) || 0;

        var bcv = null;
        try {
            bcv = await window.obtenerTasaBCV();
        } catch (e) {
            console.warn('No se pudo consultar el BCV para el diagnóstico:', e.message);
        }

        var deriva = bcv ? porcentajeDeriva(confirmada, bcv) : 0;

        return {
            confirmada: confirmada,
            efectiva: efectiva,
            bcv: bcv,
            derivaPorcentaje: deriva,
            // `sinConfirmar` = la tasa base y la efectiva son iguales, así que
            // el aumento no está aplicado. Normal si no hay aumento activo;
            // sospechoso si el admin lo activó y no guardó.
            sinConfirmar: efectiva > 0 && Math.abs(efectiva - confirmada) < 0.005,
            aumentoActivo: !!(cfg.aumento_activo || cfg.aumento_semanal),
            necesitaRevision: deriva >= UMBRAL_PORCENTAJE,
            consultadoEn: new Date().toISOString()
        };
    };

    /**
     * Muestra el aviso en el dashboard si hace falta. Reemplaza al toast
     * genérico: dice qué pasó, cuánto es la diferencia y qué hacer.
     */
    window.avisarTasaVieja = async function () {
        var hoy = hoyISO();
        if (localStorage.getItem(claveVisto(hoy))) return;   // ya avisado hoy

        var d = await window.diagnosticarTasa();
        if (!d.bcv) return;                                   // sin BCV no hay nada que comparar

        // Caso 1: el BCV se movió lo suficiente respecto a lo confirmado
        if (!d.necesitaRevision) return;

        localStorage.setItem(claveVisto(hoy), '1');

        var signo = d.bcv > d.confirmada ? 'subió' : 'bajó';
        var mensaje = 'El BCV ' + signo + ' a ' + d.bcv.toFixed(2) +
            ' y la tasa confirmada es ' + d.confirmada.toFixed(2) +
            ' (diferencia ' + d.derivaPorcentaje.toFixed(2) + '%).';

        // Se informa y se ofrece abrir el panel. NO se modifica nada.
        if (typeof window.mostrarToast === 'function') {
            window.mostrarToast(
                '💱 ' + mensaje + ' Revisá el panel de tasa y guardá si corresponde.',
                'warning'
            );
        }

        // Se informa con el toast. Antes además se colgaba un chip
        // "⚠ Tasa desactualizada" al lado del botón del BCV, pero ese botón
        // pertenecía al flujo viejo y se retiró con su modal: el chip quedaba
        // huérfano. El dato sigue disponible en el panel de la tasa, que es
        // donde se decide.

        console.log('[tasa] Diagnóstico:', d);
    };

    /**
     * Diagnóstico manual desde la consola, útil para soporte:
     *   await window.diagnosticarTasa()
     */
    window._UMBRAL_TASA = UMBRAL_PORCENTAJE;
})();
