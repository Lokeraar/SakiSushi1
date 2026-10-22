# Proposal: Refactor Edge Function to use Supabase Auth JWT

## Intent

PostgREST en este proyecto migró de HS256 (shared secret) a ECC P-256 (JWKS) para la verificación de JWTs. El Edge Function `login` firma JWTs manualmente con HS256 usando `JWT_SECRET`, lo que PostgREST ya no acepta. Todas las queries REST (admin, cajero, cliente) devuelven 401 PGRST301 después del login.

Necesitamos que el Edge Function devuelva un `access_token` firmado por Supabase Auth (ECC P-256).

## Scope

### In Scope
- Refactorizar `supabase/functions/login/index.ts` para usar Supabase Auth (shadow users + signInWithPassword)
- Mantener el mismo contrato de respuesta `{ success, token, user }` para no romper el frontend
- Eliminar dependencia `jose` (ya no se firma JWT manualmente)
- Mantener la verificación de credenciales vía RPC `verify_user_credentials` (custom auth)

### Out of Scope
- Migrar usuarios de la tabla custom `usuarios` a `auth.users` (se crean shadow users on the fly)
- Refactorizar el frontend (solo cambia el token, el formato de respuesta es idéntico)
- Eliminar `verify_user_credentials` RPC (sigue siendo el método de autenticación)

## Capabilities

### New Capabilities
- `<supabase-auth-integration>`: Edge Function que usa Supabase Auth para emitir tokens JWT firmados con ECC P-256, manteniendo autenticación contra tabla custom.

### Modified Capabilities
- None (no existing specs in openspec/specs/)

## Approach

1. Después de que `verify_user_credentials` RPC valide usuario+contraseña, crear o recuperar un shadow user en `auth.users` con el email = `username`
2. Generar un password aleatorio, setearlo en el auth user (update si existe, create si no)
3. Llamar `supabase.auth.signInWithPassword({ email: username, password: tempPassword })` para obtener un session con `access_token` firmado por Supabase Auth (ECC P-256)
4. Retornar `{ success: true, token: session.access_token, user: { id, nombre, username, rol } }` (misma forma que antes)
5. Eliminar `import * as jose` y toda la lógica de `SignJWT`

## Affected Areas

| Area | Impact | Description |
|------|--------|-------------|
| `supabase/functions/login/index.ts` | Modified | Refactor completo del flujo post-verificación |

## Risks

| Risk | Likelihood | Mitigation |
|------|------------|------------|
| SignInWithPassword falla con service_role | Low | Usar service_role key en apikey header, GoTrue lo acepta |
| Shadow user duplicado por race condition | Low | Try create + fallback a update si ya existe |
| token de Supabase Auth expira antes que el custom | Med | El access_token de Supabase Auth ya tiene expiry configurado (1h default); el frontend ya maneja expiración via restaurarSesionAdmin |
| Error creando usuario en auth.users si email ya existe | Low | Capturar error "already exists" y actualizar password en vez de crear |

## Rollback Plan

Revertir el archivo `supabase/functions/login/index.ts` a su versión anterior (HS256 manual) usando `git revert` y redeployar la Edge Function.

## Dependencies

- Edge Function ya tiene acceso a `SUPABASE_URL`, `SUPABASE_SERVICE_ROLE_KEY` (env vars auto-inyectadas)
- No requiere nuevas env vars

## Success Criteria

- [ ] Login devuelve token JWT que es aceptado por PostgREST (query REST no devuelve PGRST301)
- [ ] Formato de respuesta `{ success, token, user }` se mantiene idéntico al anterior
- [ ] Sesión se restaura correctamente (restaurarSesionAdmin no detecta token inválido)
- [ ] Shadow user se crea en auth.users si no existe
