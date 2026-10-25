import { serve } from 'https://deno.land/std@0.177.0/http/server.ts'

// ============================================================
// tasa-bcv-scraper — de dónde sale la tasa que devuelve esta función
// ============================================================
//
// HISTORIA (para que nadie repita el error)
//
// La primera versión de este archivo hacía scraping de bcv.org.ve con una
// expresión regular sobre el HTML. Funcionó, pero dejó de hacerlo cuando el
// BCV cambió el marcado, y además NO informaba la fecha valor de forma
// confiable: devolvía un texto suelto que había que interpretar.
//
// Lo desplegado terminó siendo otra cosa: consulta `ve.dolarapi.com`, que
// replica la tasa oficial del BCV e informa `fechaActualizacion`. Este archivo
// se sincroniza con lo que está desplegado, porque un repo que miente sobre su
// propio código es peor que no tener repo.
//
// LA TRAMPA QUE NO SE PUEDE REPETIR
//
// Las APIs de cotización devuelven un número. Algunas devuelven, además, UNA
// FECHA que no es la de hoy. Medido con las publicaciones del BCV de octubre
// de 2026:
//
//   post nuevo   : 887,30200000  -> Fecha Valor MARTES 27
//   post anterior: 886,22710000  -> Fecha Valor VIERNES 23
//
// Un sábado 24, la tasa VIGENTE era la del viernes. Pero `open.er-api.com` ya
// devolvía 887,302, la del martes. Usarla habría adelantado cinco días una tasa
// que todavía no regía.
//
// Conclusión: esta función DEVUELVE el número y su fecha valor. No decide qué
// se aplica. Esa decisión vive en la base (`registrar_tasa_bcv` marca las
// futuras como 'pendiente') y, si alguien decide adelantarla, en el panel del
// admin, donde queda registrado con motivo.
//
// FUENTES, EN ORDEN
//
//   1. ve.dolarapi.com          principal. Informa `fechaActualizacion`.
//   2. open.er-api.com          respaldo. NO informa fecha valor del BCV:
//                               su `time_last_update_utc` es cuándo se actualizó
//                               la cotización, no la fecha valor oficial. Se
//                               devuelve marcada como no confiable para que
//                               quien la reciba sepa que hace falta un humano.
//
// Si ninguna responde, se devuelve error. Nunca se inventa un número.

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
  'Access-Control-Allow-Methods': 'GET, POST, OPTIONS',
  'Access-Control-Max-Age': '86400',
}

const FUENTE_PRINCIPAL = 'https://ve.dolarapi.com/v1/dolares/oficial'
const FUENTE_RESPALDO_POR_DEFECTO = 'https://open.er-api.com/v6/latest/USD'

function respuesta(cuerpo: unknown, status = 200) {
  return new Response(JSON.stringify(cuerpo), {
    status,
    headers: { ...corsHeaders, 'Content-Type': 'application/json' },
  })
}

// ── Fuente principal: dolarapi, replica la oficial del BCV ──
async function desdeDolarapi() {
  const res = await fetch(FUENTE_PRINCIPAL, {
    headers: { 'Accept': 'application/json' },
    signal: AbortSignal.timeout(10_000),
  })
  if (!res.ok) throw new Error(`dolarapi respondió ${res.status}`)

  const j = await res.json()
  const tasa = Number(j?.promedio)
  if (!Number.isFinite(tasa) || tasa <= 0) {
    throw new Error('dolarapi devolvió un valor que no es un número válido')
  }

  // `fechaActualizacion` viene como "2026-10-23T00:00:00-04:00". Su parte de
  // fecha ES la fecha valor. Se devuelve tal cual y además normalizada.
  const crudo = j?.fechaActualizacion
  const fechaValor = crudo ? String(crudo).slice(0, 10) : null

  if (!fechaValor) throw new Error('dolarapi no informó fecha de actualización')

  return {
    tasa,
    fecha_valor: fechaValor,
    fuente: 'dolarapi.com (BCV)',
    es_principal: true,
    fecha_valor_confiable: true,
  }
}

// ── Respaldo: er-api. Sirve el número, no la fecha valor oficial ──
async function desdeErApi() {
  const res = await fetch(FUENTE_RESPALDO_POR_DEFECTO, {
    headers: { 'Accept': 'application/json' },
    signal: AbortSignal.timeout(10_000),
  })
  if (!res.ok) throw new Error(`er-api respondió ${res.status}`)

  const j = await res.json()
  const tasa = Number(j?.rates?.VES)
  if (!Number.isFinite(tasa) || tasa <= 0) {
    throw new Error('er-api no devolvió una tasa VES válida')
  }

  // OJO: `time_last_update_utc` es cuándo la API refrescó su dato, NO la
  // fecha valor del BCV. Puede estar días adelantada respecto de lo que rige.
  const crudo = j?.time_last_update_utc ? new Date(j.time_last_update_utc) : null
  const fechaValor = crudo && !isNaN(crudo.getTime())
    ? crudo.toISOString().slice(0, 10)
    : null

  return {
    tasa,
    fecha_valor: fechaValor,
    fuente: 'open.er-api.com',
    es_principal: false,
    // Marcado a propósito: quien reciba esto SABE que la fecha no es la del
    // BCV. En la base entra como pendiente y un humano la confirma.
    fecha_valor_confiable: false,
  }
}

serve(async (req) => {
  if (req.method === 'OPTIONS') {
    return new Response(null, { status: 204, headers: corsHeaders })
  }

  const intentos: string[] = []

  // Principal primero. Si falla, se intenta el respaldo.
  for (const [nombre, fn] of [
    ['dolarapi', desdeDolarapi],
    ['er-api', desdeErApi],
  ] as const) {
    try {
      const r = await fn()
      return respuesta({
        success: true,
        tasa: r.tasa,
        tasa_formateada: r.tasa.toFixed(2),
        fecha_valor: r.fecha_valor,
        fuente: r.fuente,
        es_principal: r.es_principal,
        // Si es false, el llamador NO puede aplicar el número sin que una
        // persona confirme la fecha valor. Lo dice el dato, no la prosa.
        fecha_valor_confiable: r.fecha_valor_confiable,
        respaldo: nombre !== 'dolarapi',
        intentos_fallidos: intentos,
      })
    } catch (e) {
      intentos.push(`${nombre}: ${(e as Error).message}`)
      console.warn(`❌ ${nombre}:`, (e as Error).message)
    }
  }

  return respuesta({
    success: false,
    error: 'Ninguna fuente de la tasa respondió. No se inventa un valor.',
    intentos_fallidos: intentos,
  }, 502)
})
