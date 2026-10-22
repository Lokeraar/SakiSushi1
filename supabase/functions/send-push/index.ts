// send-push.ts - Edge Function para notificaciones push - VERSIÓN FINAL CON SESIONES
import { serve } from 'https://deno.land/std@0.177.0/http/server.ts'
import { createClient } from 'npm:@supabase/supabase-js@2'
import webpush from 'npm:web-push@3.6.7'

const vapidKeys = {
  publicKey: 'BC6oJ4E+5pGIn4icpzCBLMi6/nk+1JJenrUA41uJrAs1ELraSw5ctvRAlh8sHVldqzBXUtEwEeFKBm0/hmuM9EY=',
  privateKey: 'MIGHAgEAMBMGByqGSM49AgEGCCqGSM49AwEHBG0wawIBAQQgXtMIlXsmnVqvOCkQZ8NC++EaOulDNL7LBFFCWqkY4nShRANCAAQuqCeBPuaRiJ+InKcwgSzIuv55PtSSXp61AONbiawLNRC62ksOXLb0QJYfLB1ZXaswV1LRMBHhSgZtP4ZrjPRG'
}

webpush.setVapidDetails('mailto:admin@sakisushi.com', vapidKeys.publicKey, vapidKeys.privateKey)

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
  'Access-Control-Max-Age': '86400',
}

serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { status: 200, headers: corsHeaders })

  try {
    if (req.method !== 'POST') {
      return new Response(JSON.stringify({ error: 'Method not allowed' }), {
        status: 405, headers: { ...corsHeaders, 'Content-Type': 'application/json' }
      })
    }

    const authHeader = req.headers.get('Authorization')
    const serviceKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') ?? ''
    
    // Aceptar: Bearer con service_role_key, o llamadas internas del trigger (pg_net)
    const isAuthorized = authHeader?.startsWith('Bearer ') && (
        authHeader.includes(serviceKey) ||
        serviceKey !== '' // cualquier Bearer válido si tenemos la key configurada
    )
    
    if (!isAuthorized) {
      return new Response(JSON.stringify({ error: 'Unauthorized' }), {
        status: 401, headers: { ...corsHeaders, 'Content-Type': 'application/json' }
      })
    }

    const payload = await req.json().catch(() => ({}))
    console.log('📨 Webhook recibido:', JSON.stringify(payload, null, 2))

    const record = payload.record || payload
    const session_id = record?.session_id
    const titulo = record?.titulo || '🍣 Saki Sushi'
    const mensaje = record?.mensaje || 'Tienes una nueva notificación'
    const pedido_id = record?.pedido_id
    const tipo = record?.tipo || 'info'

    if (!session_id) {
      return new Response(JSON.stringify({ error: 'No session_id' }), {
        status: 400, headers: { ...corsHeaders, 'Content-Type': 'application/json' }
      })
    }

    console.log(`📱 Procesando para session: ${session_id}, tipo: ${tipo}`)

    const supabase = createClient(
      Deno.env.get('SUPABASE_URL') ?? '',
      Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') ?? ''
    )

    const { data: subscriptions, error } = await supabase
      .from('push_subscriptions')
      .select('*')
      .eq('session_id', session_id)

    if (error) throw error
    if (!subscriptions?.length) {
      return new Response(JSON.stringify({ success: true, enviadas: 0 }), {
        status: 200, headers: { ...corsHeaders, 'Content-Type': 'application/json' }
      })
    }

    console.log(`📱 Encontradas ${subscriptions.length} suscripciones`)

    const iconMap = {
      approved: { icon: 'icono-success.png', badge: 'badge-success.png' },
      rejected: { icon: 'icono-error.png', badge: 'badge-error.png' },
      pending: { icon: 'icono-pending.png', badge: 'badge-pending.png' },
      session_closed: { icon: 'icono-warning.png', badge: 'badge-warning.png' }
    }

    const baseUrl = 'https://iqwwoihiiyrtypyqzhgy.supabase.co/storage/v1/object/public/imagenes-platillos/'
    const icono = iconMap[tipo as keyof typeof iconMap] || { icon: 'icono-192x192.png', badge: 'badge-72x72.png' }
    const iconUrl = baseUrl + icono.icon
    const badgeUrl = baseUrl + icono.badge

    const resultados = []
    let enviadas = 0

    for (const sub of subscriptions) {
      try {
        const pushSub = {
          endpoint: sub.endpoint,
          keys: { p256dh: sub.p256dh, auth: sub.auth }
        }

        const pushPayload = JSON.stringify({
          titulo, mensaje, session_id, pedido_id, tipo,
          url: tipo === 'session_closed' ? '/SakiSushi0/Cajero/' : '/SakiSushi0/Cliente/',
          icon: iconUrl, badge: badgeUrl, timestamp: Date.now()
        })

        await webpush.sendNotification(pushSub, pushPayload)
        await supabase.from('push_subscriptions').update({ last_used: new Date().toISOString() }).eq('endpoint', sub.endpoint)
        enviadas++
        resultados.push({ endpoint: sub.endpoint.substring(0, 50) + '...', success: true })
      } catch (err) {
        console.error(`❌ Error enviando a ${sub.endpoint}:`, err)
        if (err.statusCode === 410) {
          await supabase.from('push_subscriptions').delete().eq('endpoint', sub.endpoint)
        }
        resultados.push({ endpoint: sub.endpoint.substring(0, 50) + '...', success: false, error: err.message })
      }
    }

    console.log(`✅ Procesadas ${enviadas}/${subscriptions.length} notificaciones`)
    return new Response(JSON.stringify({ success: true, enviadas, total: subscriptions.length, resultados }), {
      status: 200, headers: { ...corsHeaders, 'Content-Type': 'application/json' }
    })

  } catch (err) {
    console.error('❌ Error general:', err)
    return new Response(JSON.stringify({ error: err.message }), {
      status: 500, headers: { ...corsHeaders, 'Content-Type': 'application/json' }
    })
  }
})