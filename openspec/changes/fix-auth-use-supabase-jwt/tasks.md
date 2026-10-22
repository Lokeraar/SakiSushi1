# Tasks: Refactor Login to Use Supabase Auth JWT

## Review Workload Forecast

| Field | Value |
|-------|-------|
| Estimated changed lines | ~80 (in 136-line file) |
| 400-line budget risk | Low |
| Chained PRs recommended | No |
| Suggested split | Single PR |
| Delivery strategy | single-pr |
| Chain strategy | pending |

Decision needed before apply: No
Chained PRs recommended: No
Chain strategy: pending
400-line budget risk: Low

## Phase 1: Dependency Cleanup

- [ ] 1.1 Remove `import * as jose` line from `supabase/functions/login/index.ts`
- [ ] 1.2 Remove `JWT_SECRET` env lookup block (lines 86-94)
- [ ] 1.3 Remove `SignJWT` payload construction and signing logic (lines 96-109)
- [ ] 1.4 Remove `jose` from `deno.json` import map if present

## Phase 2: Supabase Auth Shadow User Flow

- [ ] 2.1 Generate random temp password after successful RPC validation (crypto.randomUUID)
- [ ] 2.2 Add `supabase.auth.admin.createUser()` call with email=username, temp password, email_confirm=true
- [ ] 2.3 Add try-create catch for "already exists" → fallback to `supabase.auth.admin.updateUserById()` with new password
- [ ] 2.4 Add `supabase.auth.signInWithPassword()` call with email=username, temp password
- [ ] 2.5 Wire `session.data.session.access_token` into response `token` field, preserving `user` shape

## Phase 3: Error Handling

- [ ] 3.1 Add try/catch for `admin.createUser` failure → return 500 "Error al crear usuario de autenticación"
- [ ] 3.2 Add try/catch for `signInWithPassword` failure → return 500 "Error al obtener sesión de autenticación"

## Phase 4: Verification

- [ ] 4.1 Verify no remaining `jose` import or `SignJWT` call in the file
- [ ] 4.2 Verify response shape `{ success, token, user: { id, nombre, username, rol } }` is preserved
- [ ] 4.3 Verify error responses return correct status codes and messages per spec scenarios
