import { serve } from 'https://deno.land/std@0.177.0/http/server.ts'
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2'

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
  'Access-Control-Max-Age': '86400',
}

serve(async (req) => {
  if (req.method === 'OPTIONS') {
    return new Response(null, { 
      status: 204, 
      headers: corsHeaders 
    })
  }

  try {
    if (req.method !== 'POST') {
      return new Response(
        JSON.stringify({ error: 'Method not allowed' }),
        { status: 405, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      )
    }

    const apiKey = req.headers.get('apikey') || 
                   req.headers.get('Authorization')?.replace('Bearer ', '') ||
                   new URL(req.url).searchParams.get('apikey');
    
    if (!apiKey) {
      console.error('❌ No API key found in request');
      return new Response(
        JSON.stringify({ error: 'No API key found in request' }),
        { status: 401, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      )
    }

    const { username, password } = await req.json()
    
    if (!username || !password) {
      return new Response(
        JSON.stringify({ error: 'Usuario y contraseña requeridos' }),
        { status: 400, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      )
    }

    const supabase = createClient(
      Deno.env.get('SUPABASE_URL')!,
      Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!
    )

    const { data, error } = await supabase
      .rpc('verify_user_credentials', {
        p_username: username,
        p_password: password
      })

    if (error) {
      console.error('Error en RPC:', error)
      return new Response(
        JSON.stringify({ error: 'Error interno del servidor' }),
        { status: 500, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      )
    }

    const result = data && data[0]

    if (!result) {
      return new Response(
        JSON.stringify({ error: 'Error en la respuesta del servidor' }),
        { status: 500, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      )
    }

    if (!result.success) {
      return new Response(
        JSON.stringify({ error: result.error || 'Usuario o contraseña incorrectos' }),
        { status: 401, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      )
    }

    // ── Shadow user en Supabase Auth + access_token (ECC P-256) ──
    const authEmail = `${result.user_username}@sakisushi.auth`
    const tempPassword = crypto.randomUUID()
    const svcKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!
    const authUrl = Deno.env.get('SUPABASE_URL')!

    // 1. Eliminar shadow user existente (si hay)
    try {
      const searchResp = await fetch(
        `${authUrl}/auth/v1/admin/users?filter=${encodeURIComponent(authEmail)}`,
        { headers: { apikey: svcKey, Authorization: `Bearer ${svcKey}` } }
      )
      const searchData = await searchResp.json()
      const existingUser = searchData.users?.[0]
      if (existingUser?.id) {
        console.log('🗑️ Eliminando shadow user existente...')
        await supabase.auth.admin.deleteUser(existingUser.id)
      }
    } catch (e) {
      console.log('⚠️ No se pudo eliminar shadow user:', e?.message)
    }

    // 2. Crear shadow user fresco
    const { error: createError } = await supabase.auth.admin.createUser({
      email: authEmail,
      password: tempPassword,
      email_confirm: true,
      user_metadata: {
        custom_user_id: result.user_id,
        username: result.user_username,
        nombre: result.user_nombre,
        rol: result.user_rol,
      },
    })

    if (createError) {
      console.error('Error creando shadow user:', createError?.message || createError)
      return new Response(
        JSON.stringify({ error: 'Error de configuración del servidor' }),
        { status: 500, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      )
    }

    // 3. Obtener session token de Supabase Auth (firmado con ECC P-256)
    const { data: authData, error: signInError } = await supabase.auth.signInWithPassword({
      email: authEmail,
      password: tempPassword,
    })

    if (signInError || !authData?.session) {
      console.error('Error obteniendo session:', signInError?.message || signInError)
      return new Response(
        JSON.stringify({ error: 'Error de autenticación del servidor' }),
        { status: 500, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      )
    }

    const user = {
      id: result.user_id,
      nombre: result.user_nombre,
      username: result.user_username,
      rol: result.user_rol
    }

    console.log(`✅ Login exitoso: ${username} (${result.user_rol})`)

    return new Response(
      JSON.stringify({
        success: true,
        token: authData.session.access_token,
        user: user
      }),
      { status: 200, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
    )

  } catch (error) {
    console.error('Error en login:', error)
    return new Response(
      JSON.stringify({ error: error.message }),
      { status: 500, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
    )
  }
})
