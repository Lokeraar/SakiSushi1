import { serve } from 'https://deno.land/std@0.168.0/http/server.ts'
import { SmtpClient } from 'https://deno.land/x/smtp@v0.7.0/mod.ts'

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
}

serve(async (req) => {
  // Handle CORS preflight requests
  if (req.method === 'OPTIONS') {
    return new Response('ok', { headers: corsHeaders })
  }

  try {
    // Obtener el header de autorización
    const authHeader = req.headers.get('Authorization')
    
    console.log('Authorization header recibido:', authHeader ? 'Presente' : 'AUSENTE')
    
    // Para esta función pública, NO requerimos autenticación estricta
    // Solo validamos que el header exista si se envía, pero permitimos continuar sin él
    let supabaseKey = null
    
    if (authHeader && authHeader.startsWith('Bearer ')) {
      supabaseKey = authHeader.substring(7)
      console.log('✅ Clave de autorización recibida:', '***' + supabaseKey.slice(-10))
    } else {
      console.log('⚠️ No se recibió header de autorización, continuando...')
    }
    
    const { destinatario, token, username, enlace } = await req.json()

    // Validar datos requeridos
    if (!destinatario || !token || !username || !enlace) {
      throw new Error('Faltan parámetros requeridos')
    }

    // Validar formato de email
    const emailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/
    if (!emailRegex.test(destinatario)) {
      throw new Error('Formato de email inválido')
    }

    // Obtener configuración SMTP desde variables de entorno
    const smtpHost = Deno.env.get('SMTP_HOST')
    const smtpPort = Deno.env.get('SMTP_PORT')
    const smtpUser = Deno.env.get('SMTP_USER')
    const smtpPass = Deno.env.get('SMTP_PASS')
    const smtpFrom = Deno.env.get('SMTP_FROM') || 'Saki Sushi <noreply@sakisushi.com>'

    console.log('Configuración SMTP detectada:')
    console.log('- SMTP_HOST:', smtpHost ? '***' + smtpHost.slice(-5) : 'NO CONFIGURADO')
    console.log('- SMTP_PORT:', smtpPort || 'NO CONFIGURADO')
    console.log('- SMTP_USER:', smtpUser || 'NO CONFIGURADO')
    console.log('- SMTP_FROM:', smtpFrom)

    // Opción 1: Usar Resend (recomendado) - SOLO si está configurado
    const resendApiKey = Deno.env.get('RESEND_API_KEY')
    
    if (resendApiKey) {
      console.log('Usando servicio Resend')
      // Importar Resend dinámicamente
      const { Resend } = await import('npm:resend@2.0.0')
      const resend = new Resend(resendApiKey)

      const { data, error } = await resend.emails.send({
        from: smtpFrom,
        to: [destinatario],
        subject: '🍣 Recuperación de Contraseña - Saki Sushi',
        html: `
<!DOCTYPE html>
<html lang="es">
<head>
    <meta charset="UTF-8">
    <meta name="viewport" content="width=device-width, initial-scale=1.0">
    <title>Recuperación de Contraseña - Saki Sushi</title>
    <style>
        * {
            margin: 0;
            padding: 0;
            box-sizing: border-box;
        }
        body {
            font-family: 'Arial', 'Helvetica', sans-serif;
            background-color: #f4f4f4;
            line-height: 1.6;
            color: #333;
        }
        .container {
            max-width: 600px;
            margin: 40px auto;
            background: #ffffff;
            border-radius: 12px;
            overflow: hidden;
            box-shadow: 0 4px 20px rgba(0,0,0,0.1);
        }
        .header {
            background: linear-gradient(135deg, #D32F2F 0%, #b71c1c 100%);
            color: white;
            padding: 40px 30px;
            text-align: center;
        }
        .header h1 {
            margin: 0;
            font-size: 32px;
            font-weight: 700;
        }
        .header p {
            margin: 10px 0 0 0;
            opacity: 0.9;
            font-size: 16px;
        }
        .content {
            padding: 40px 30px;
        }
        .content h2 {
            color: #333;
            margin-bottom: 20px;
            font-size: 24px;
        }
        .content p {
            color: #666;
            margin-bottom: 20px;
            font-size: 16px;
        }
        .button-container {
            text-align: center;
            margin: 30px 0;
        }
        .button {
            display: inline-block;
            background: linear-gradient(135deg, #D32F2F 0%, #b71c1c 100%);
            color: white;
            text-decoration: none;
            padding: 16px 48px;
            border-radius: 8px;
            font-weight: bold;
            font-size: 16px;
            transition: transform 0.2s ease, box-shadow 0.2s ease;
            box-shadow: 0 4px 12px rgba(211, 47, 47, 0.3);
        }
        .button:hover {
            transform: translateY(-2px);
            box-shadow: 0 6px 20px rgba(211, 47, 47, 0.4);
        }
        .link-text {
            word-break: break-all;
            color: #999;
            font-size: 12px;
            margin-top: 20px;
            padding: 10px;
            background: #f8f9fa;
            border-radius: 4px;
        }
        .warning {
            background: linear-gradient(90deg, #fff3cd 0%, #ffe8a1 100%);
            border-left: 4px solid #ffc107;
            padding: 20px;
            margin: 25px 0;
            border-radius: 4px;
        }
        .warning strong {
            color: #856404;
            display: block;
            margin-bottom: 10px;
            font-size: 16px;
        }
        .warning ul {
            margin: 10px 0 0 0;
            padding-left: 20px;
            color: #856404;
        }
        .warning li {
            margin-bottom: 5px;
        }
        .footer {
            background: #f8f9fa;
            padding: 25px 30px;
            text-align: center;
            color: #999;
            font-size: 13px;
            border-top: 1px solid #e9ecef;
        }
        .footer p {
            margin: 5px 0;
        }
        .social-links {
            margin-top: 15px;
        }
        .social-links a {
            display: inline-block;
            margin: 0 8px;
            color: #D32F2F;
            text-decoration: none;
            font-size: 20px;
        }
        @media only screen and (max-width: 600px) {
            .container {
                margin: 20px;
                border-radius: 8px;
            }
            .header {
                padding: 30px 20px;
            }
            .header h1 {
                font-size: 26px;
            }
            .content {
                padding: 30px 20px;
            }
            .button {
                padding: 14px 36px;
                font-size: 15px;
            }
        }
    </style>
</head>
<body>
    <div class="container">
        <div class="header">
            <h1>🍣 Saki Sushi</h1>
            <p>Recuperación de Contraseña</p>
        </div>

        <div class="content">
            <h2>Hola ${username},</h2>

            <p>Hemos recibido una solicitud para restablecer tu contraseña. Haz clic en el botón siguiente para establecer una nueva contraseña:</p>

            <div class="button-container">
                <a href="${enlace}" class="button">🔐 Restablecer Contraseña</a>
            </div>

            <p style="text-align: center; color: #999; font-size: 14px;">O copia y pega este enlace en tu navegador:</p>
            <div class="link-text">${enlace}</div>

            <div class="warning">
                <strong>⚠️ Información Importante:</strong>
                <ul>
                    <li>Este enlace expirará en <strong>1 hora</strong></li>
                    <li>Puedes usar este enlace múltiples veces durante los primeros <strong>10 minutos</strong></li>
                    <li>Si no solicitaste este cambio, puedes ignorar este email con seguridad</li>
                    <li>Por tu seguridad, no compartas este enlace con nadie</li>
                </ul>
            </div>

            <p style="color: #666; font-size: 14px; margin-top: 25px;">
                ¿Tienes problemas con el botón? Intenta copiar y pegar el enlace completo en la barra de direcciones de tu navegador.
            </p>
        </div>

        <div class="footer">
            <p>Este es un mensaje automático, por favor no respondas a este correo.</p>
            <p>Si tienes alguna duda, contacta a nuestro equipo de soporte.</p>
            <div class="social-links">
                <a href="#" title="Facebook">📘</a>
                <a href="#" title="Instagram">📷</a>
                <a href="#" title="Twitter">🐦</a>
            </div>
            <p style="margin-top: 20px; font-size: 12px;">
                &copy; 2024 Saki Sushi. Todos los derechos reservados.
            </p>
        </div>
    </div>
</body>
</html>
        `,
      })

      if (error) {
        console.error('Error enviando email con Resend:', error)
        throw new Error(error.message)
      }

      return new Response(
        JSON.stringify({ 
          success: true, 
          data,
          metodo: 'Resend'
        }), 
        {
          headers: { ...corsHeaders, 'Content-Type': 'application/json' },
          status: 200,
        }
      )
    }

    // Opción 2: Usar SMTP directamente (CONFIGURACIÓN PRINCIPAL)
    if (smtpHost && smtpPort && smtpUser && smtpPass) {
      console.log('Usando servicio SMTP directo')
      console.log(`Conectando a ${smtpHost}:${smtpPort}`)
      
      const client = new SmtpClient()

      // Configurar conexión SMTP
      const port = parseInt(smtpPort)
      
      try {
        // Para Gmail o puerto 587 usar TLS
        if (smtpHost.includes('gmail.com') || smtpHost.includes('googlemail.com') || port === 587) {
          console.log('Usando conexión TLS')
          await client.connectTLS({
            hostname: smtpHost,
            port: port,
            username: smtpUser,
            password: smtpPass,
          })
        } else if (port === 465) {
          // Puerto 465 usa SSL directo
          console.log('Usando conexión SSL')
          await client.connectTLS({
            hostname: smtpHost,
            port: port,
            username: smtpUser,
            password: smtpPass,
          })
        } else {
          // Otros puertos usan STARTTLS o conexión simple
          console.log('Usando conexión estándar')
          await client.connect({
            hostname: smtpHost,
            port: port,
            secure: false,
            username: smtpUser,
            password: smtpPass,
          })
        }

        console.log('✅ Conexión SMTP establecida')

        const emailContent = `
<!DOCTYPE html>
<html lang="es">
<head>
    <meta charset="UTF-8">
    <title>Recuperación de Contraseña - Saki Sushi</title>
</head>
<body style="font-family: Arial, sans-serif; background: #f4f4f4; margin: 0; padding: 0;">
    <div style="max-width: 600px; margin: 40px auto; background: #fff; border-radius: 10px; overflow: hidden; box-shadow: 0 4px 20px rgba(0,0,0,0.1);">
        <div style="background: linear-gradient(135deg, #D32F2F, #b71c1c); color: white; padding: 30px; text-align: center;">
            <h1 style="margin: 0; font-size: 28px;">🍣 Saki Sushi</h1>
            <p style="margin: 10px 0 0 0;">Recuperación de Contraseña</p>
        </div>
        <div style="padding: 40px 30px;">
            <h2 style="color: #333; margin-bottom: 20px;">Hola ${username},</h2>
            <p style="color: #666; line-height: 1.6; margin-bottom: 20px;">
                Hemos recibido una solicitud para restablecer tu contraseña. 
                Haz clic en el botón siguiente para establecer una nueva contraseña:
            </p>
            <div style="text-align: center; margin: 30px 0;">
                <a href="${enlace}" style="display: inline-block; background: #D32F2F; color: white; text-decoration: none; padding: 15px 40px; border-radius: 5px; font-weight: bold;">
                    🔐 Restablecer Contraseña
                </a>
            </div>
            <p style="color: #999; font-size: 12px; word-break: break-all; background: #f8f9fa; padding: 10px; border-radius: 4px;">
                ${enlace}
            </p>
            <div style="background: #fff3cd; border-left: 4px solid #ffc107; padding: 15px; margin: 20px 0;">
                <strong style="color: #856404;">⚠️ Importante:</strong>
                <ul style="margin: 10px 0 0 0; color: #856404;">
                    <li>Este enlace expirará en 1 hora</li>
                    <li>Puedes usar este enlace múltiples veces durante 10 minutos</li>
                    <li>Si no solicitaste este cambio, ignora este email</li>
                </ul>
            </div>
        </div>
        <div style="background: #f8f9fa; padding: 20px; text-align: center; color: #999; font-size: 12px; border-top: 1px solid #e9ecef;">
            <p>&copy; 2024 Saki Sushi. Todos los derechos reservados.</p>
        </div>
    </div>
</body>
</html>
        `

        await client.send({
          from: smtpFrom,
          to: [destinatario],
          subject: '🍣 Recuperación de Contraseña - Saki Sushi',
          content: emailContent,
          html: true,
        })

        await client.close()
        console.log('✅ Email enviado exitosamente vía SMTP')

        return new Response(
          JSON.stringify({ 
            success: true, 
            message: 'Email enviado exitosamente',
            metodo: 'SMTP'
          }), 
          {
            headers: { ...corsHeaders, 'Content-Type': 'application/json' },
            status: 200,
          }
        )
      } catch (smtpError) {
        console.error('❌ Error en conexión SMTP:', smtpError)
        throw new Error(`Error SMTP: ${smtpError.message}`)
      }
    }

    // Si no hay ningún servicio configurado, retornar error detallado
    throw new Error('No hay ningún servicio de email configurado. Debes configurar las variables SMTP_HOST, SMTP_PORT, SMTP_USER y SMTP_PASS en Supabase')

  } catch (error) {
    console.error('❌ Error en Edge Function:', error)
    return new Response(
      JSON.stringify({ 
        success: false, 
        error: error.message,
        details: error.stack
      }), 
      {
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
        status: 400,
      }
    )
  }
})
