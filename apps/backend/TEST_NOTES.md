# Backend auth & protected-route smoke tests (local)

**Start the API (pick one, not both):**

- From repo root: `npm run start --prefix apps/backend`
- From `apps/backend`: `npm run start`

Do not nest `cd apps/backend` under `apps/backend` (avoids wrong cwd / path issues).

**Environment:** `SUPABASE_URL`, `SUPABASE_SERVICE_ROLE_KEY`, and (for the frontend) matching project keys. Redis is **not** required for these JWT-protected reads; BullMQ may log `ECONNREFUSED` to Redis until Redis runs — that is expected and unrelated to auth.

**Token:** Use a Supabase **access** JWT (`session.access_token`), not the anon key. Send `Authorization: Bearer <token>`.

**Profiles / membership:** Your user should have a row in `profiles` and appropriate `agency_users` / `tenant_users` rows so `agencyId` / `tenantId` resolve on `/auth/me`. Set `AUTH_REQUIRE_PROFILE=1` only if you want the API to reject sessions without a `profiles` row (strict mode).

---

## Checklist (expect **200** when token and data are valid)

| # | Method | Path | Notes |
|---|--------|------|--------|
| 1 | GET | `/api/v1/auth/me` | Current user + roles |
| 2 | GET | `/api/v1/auth/agencies` | Agency memberships |
| 3 | GET | `/api/v1/agencies/me` | Primary agency for user |
| 4 | GET | `/api/v1/tenants/me` | Tenant context for user |
| 5 | GET | `/api/v1/agencies` | List agencies for user |

**Example (PowerShell, after `$token` and `$base` are set):**

```powershell
$base = "http://127.0.0.1:3001/api/v1"
curl.exe -s -i -H "Authorization: Bearer $token" "$base/auth/me"
```

---

## Optional next calls (same Bearer token)

Use `agencyId` / `tenantId` from `/auth/me` where needed.

1. `GET /api/v1/agencies/{agencyId}` — agency by id  
2. `GET /api/v1/tenants/agency/{agencyId}` — tenants for agency  
3. `GET /api/v1/tenants/{tenantId}` — tenant detail  
4. `GET /api/v1/agency-ai-config` — agency AI config (requires agency on session)  
5. `GET /api/v1/conversations?tenantId={tenantId}&pageSize=5` — list conversations (requires `tenantId`)

**One cautious write (optional, dev only):** prefer a small, reversible change in a non-production DB. Many `POST`/`PATCH` routes are still stubs or touch external systems — avoid webhooks, quota deductions, and queue-heavy paths until Redis/workflows are ready.

---

## Operational notes

- Run **one** backend process on the chosen port (e.g. 3001) to avoid `EADDRINUSE` and confusing 401s from a stale instance.
- For clearer auth errors during setup, set `AUTH_DEBUG=1` temporarily (see `.env.example`).
