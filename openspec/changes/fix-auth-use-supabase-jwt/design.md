# Design: Refactor Login to Use Supabase Auth JWT

## Technical Approach

Refactor the `supabase/functions/login/index.ts` Edge Function to obtain JWTs from Supabase Auth via `signInWithPassword` instead of manually signing HS256 tokens with `jose`. The shadow user approach creates temporary auth users with email=username, sets a random password, and authenticates to get an ECC P-256 signed token that PostgREST accepts.

## Architecture Decisions

### Decision: Shadow User Strategy

**Choice**: Create temporary auth users with email=username, random password, signInWithPassword
**Alternatives considered**:
1. Use `supabase.auth.admin.generateLink()` — requires email verification flow
2. Use `supabase.auth.admin.createSSOUser()` — complex SAML/OIDC setup
3. Use service_role to sign JWT directly — not supported in Supabase Edge Functions

**Rationale**: signInWithPassword is the simplest approach that yields a valid session token. Shadow users are ephemeral; their passwords rotate on each login, making them secure but disposable.

### Decision: Error Handling for Existing Users

**Choice**: Try `createUser`, catch "already exists" error, fallback to `updateUserById`
**Alternatives considered**:
1. Query `auth.users` first then create/update — extra round trip
2. Use `upsert` — not available in Supabase Auth admin API
3. Ignore errors — could leave stale passwords

**Rationale**: Try-create-then-fallback is idempotent and handles race conditions. The "already exists" error is expected and recoverable.

### Decision: Keep JWT_SECRET Removal

**Choice**: Remove `jose` import and JWT_SECRET lookup entirely
**Alternatives considered**:
1. Keep as fallback — adds complexity, JWT_SECRET not available anyway
2. Use SUPABASE_JWT_SECRET — migrated to JWKS, not available in this project

**Rationale**: The whole point is to stop manual signing. Clean removal reduces attack surface and dependency overhead.

## Data Flow

```
Client POST {username, password}
    │
    ▼
Edge Function login/index.ts
    │
    ├──→ RPC verify_user_credentials ──→ Custom auth.users table
    │         │
    │         ▼
    │    Validate credentials
    │         │
    │         ▼
    ├──→ admin.createUser({email: username, password: random})
    │         │
    │         ▼ (if exists) admin.updateUserById()
    │         │
    │         ▼
    ├──→ signInWithPassword({email: username, password: random})
    │         │
    │         ▼
    │    Session {access_token}
    │         │
    │         ▼
    └──→ Return {success, token, user}
```

## File Changes

| File | Action | Description |
|------|--------|-------------|
| `supabase/functions/login/index.ts` | Modify | Replace jose JWT signing with Supabase Auth signInWithPassword flow |
| `supabase/functions/login/index.ts` | Modify | Remove `import * as jose` line |
| `supabase/functions/login/index.ts` | Modify | Remove JWT_SECRET lookup (lines 86-94) |
| `supabase/functions/login/index.ts` | Modify | Remove SignJWT payload construction (lines 96-109) |
| `supabase/functions/login/index.ts` | Modify | Add shadow user creation/update logic after RPC validation |
| `supabase/functions/login/index.ts` | Modify | Add signInWithPassword call and session token extraction |

## Interfaces / Contracts

No new interfaces. Existing contract preserved:

```typescript
// Response contract (unchanged)
interface LoginResponse {
  success: boolean;
  token: string; // Now session.access_token instead of manually signed JWT
  user: {
    id: number;
    nombre: string;
    username: string;
    rol: string;
  };
}

// Error contract (unchanged)
interface ErrorResponse {
  error: string;
}
```

## Testing Strategy

| Layer | What to Test | Approach |
|-------|-------------|----------|
| Integration | Login with valid credentials returns token accepted by PostgREST | curl test with real Supabase project |
| Integration | Shadow user created in auth.users after login | Query auth.users table |
| Integration | Existing shadow user gets password updated | Login twice, verify same user_id |
| E2E | Frontend admin login works end-to-end | Manual test with admin panel |
| E2E | Session restore works (restaurarSesionAdmin) | Check token validity on reload |

## Migration / Rollout

No migration required. The change is backwards-compatible at the API level. The frontend sees the same `{success, token, user}` shape.

**Rollout**: Deploy Edge Function, test with curl, then test frontend login.

## Open Questions

- [ ] Does `signInWithPassword` work with service_role key in apikey header? (Proposal says Low risk)
- [ ] What's the default token expiry for Supabase Auth sessions? (Proposal mentions 1h default)
- [ ] Should we clean up shadow users periodically? (Out of scope for this change)