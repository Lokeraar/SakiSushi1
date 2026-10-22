# Login Authentication — Supabase Auth JWT

## Purpose

Refactor the login Edge Function to obtain JWTs from Supabase Auth (`signInWithPassword`) instead of manually signing HS256 tokens with `jose`. This fixes PostgREST rejection (PGRST301) after JWKS migration to ECC P-256.

## Requirements

### Requirement: Credential Validation via RPC

The system MUST validate user credentials by calling the `verify_user_credentials` RPC with `p_username` and `p_password` parameters.

#### Scenario: Valid credentials

- GIVEN a registered user with correct username and password
- WHEN the login endpoint receives POST with `username` and `password`
- THEN `verify_user_credentials` RPC is called
- AND the result contains `success: true` with `user_id`, `user_nombre`, `user_username`, `user_rol`

#### Scenario: Invalid credentials

- GIVEN a user with incorrect password
- WHEN the login endpoint receives POST
- THEN `verify_user_credentials` returns `success: false`
- AND the response returns 401 with the error message from RPC or default "Usuario o contraseña incorrectos"

### Requirement: Shadow User in Supabase Auth

The system MUST create or retrieve a shadow user in `auth.users` using the validated username as email, then authenticate via `signInWithPassword` to obtain a session token.

#### Scenario: New shadow user

- GIVEN RPC validation succeeds and no `auth.users` entry exists for the username email
- WHEN the system calls `supabase.auth.admin.createUser({ email: username, password: tempPassword, email_confirm: true })`
- THEN a shadow user is created in `auth.users`

#### Scenario: Existing shadow user

- GIVEN RPC validation succeeds and an `auth.users` entry already exists for the username email
- WHEN the system detects the user already exists
- THEN the system updates the shadow user's password via `supabase.auth.admin.updateUserById()` instead of failing
- AND proceeds to signInWithPassword

#### Scenario: Session token obtained

- GIVEN a shadow user exists (created or updated)
- WHEN the system calls `signInWithPassword({ email: username, password: tempPassword })`
- THEN a session is returned with a valid `access_token` signed by Supabase Auth (ECC P-256)

### Requirement: Response Format

The system MUST return the following JSON structure on successful login:

```json
{
  "success": true,
  "token": "<session.access_token>",
  "user": {
    "id": "<user_id>",
    "nombre": "<user_nombre>",
    "username": "<user_username>",
    "rol": "<user_rol>"
  }
}
```

#### Scenario: Successful login response

- GIVEN credentials are valid and session is obtained
- WHEN the login endpoint completes
- THEN the response has status 200
- AND the body matches the required JSON structure
- AND `token` is the `access_token` from the Supabase Auth session (not manually signed)

### Requirement: Error Handling

The system MUST handle errors at each stage (RPC failure, auth user creation failure, signIn failure) and return appropriate HTTP status codes.

#### Scenario: RPC failure

- GIVEN `verify_user_credentials` RPC returns an error
- WHEN the error is caught
- THEN the response returns 500 with "Error interno del servidor"

#### Scenario: Auth user creation failure

- GIVEN `admin.createUser` or `admin.updateUserById` fails
- WHEN the error is caught
- THEN the response returns 500 with "Error al crear usuario de autenticación"

#### Scenario: signInWithPassword failure

- GIVEN `signInWithPassword` returns an error
- WHEN the error is caught
- THEN the response returns 500 with "Error al obtener sesión de autenticación"

### Requirement: Dependency Cleanup

The system MUST NOT import or use the `jose` library. The `JWT_SECRET` / `SUPABASE_JWT_SECRET` environment variable lookup MUST be removed.

#### Scenario: No jose import

- GIVEN the login function is loaded
- WHEN the source is inspected
- THEN there is no `import` statement for `jose`
- AND no manual `SignJWT` or `new jose.SignJWT` call exists

### Requirement: Request Validation

The system MUST reject non-POST methods (405), requests without an API key (401), and requests missing `username` or `password` (400).

#### Scenario: Missing username or password

- GIVEN a POST request with only `username` but no `password`
- WHEN the body is parsed
- THEN the response returns 400 with "Usuario y contraseña requeridos"

#### Scenario: No API key

- GIVEN a POST request without `apikey` header or `Authorization` header
- WHEN the request is processed
- THEN the response returns 401 with "No API key found in request"
