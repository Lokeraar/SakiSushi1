import { serve } from 'https://deno.land/std@0.177.0/http/server.ts'

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
  'Access-Control-Allow-Methods': 'GET, POST, OPTIONS',
  'Access-Control-Max-Age': '86400',
}

const BCV_URL = 'https://www.bcv.org.ve/'

serve(async (req) => {
  if (req.method === 'OPTIONS') {
    return new Response(null, { status: 204, headers: corsHeaders })
  }

  try {
    const res = await fetch(BCV_URL, {
      headers: {
        'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/125.0.0.0 Safari/537.36',
        'Accept': 'text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8',
        'Accept-Language': 'es-VE,es;q=0.9,en;q=0.8',
      },
    })

    if (!res.ok) {
      throw new Error(`BCV respondió con status ${res.status}`)
    }

    const html = await res.text()

    // Buscar USD y capturar el valor numérico (formato: "USD\n540,04310000")
    // Patrón: USD seguido de cualquier cosa no numérica, luego número con coma decimal
    const usdMatch = html.match(/USD\s*[^0-9]*([0-9]{1,3}(?:[.,][0-9]{3})*[.,][0-9]+)/)

    if (!usdMatch) {
      throw new Error('No se pudo encontrar la tasa USD en la página del BCV')
    }

    // Convertir formato venezolano a número: "540,04310000" → 540.04310000
    const tasaRaw = usdMatch[1]
    const tasaNumerica = parseFloat(tasaRaw.replace(/\./g, '').replace(',', '.'))

    if (isNaN(tasaNumerica) || tasaNumerica <= 0) {
      throw new Error(`Valor de tasa inválido: ${tasaRaw}`)
    }

    // Extraer fecha valor (opcional)
    const fechaMatch = html.match(/Fecha Valor:\s*([^<]+)/)
    const fechaValor = fechaMatch ? fechaMatch[1].trim() : null

    return new Response(
      JSON.stringify({
        success: true,
        tasa: tasaNumerica,
        tasa_formateada: tasaNumerica.toFixed(2),
        fecha_valor: fechaValor,
        fuente: 'bcv.org.ve',
      }),
      {
        status: 200,
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      },
    )
  } catch (error) {
    console.error('❌ Error en tasa-bcv-scraper:', error.message)

    return new Response(
      JSON.stringify({
        success: false,
        error: error.message || 'Error al obtener la tasa del BCV',
        fuente: 'bcv.org.ve',
      }),
      {
        status: 502,
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      },
    )
  }
})
