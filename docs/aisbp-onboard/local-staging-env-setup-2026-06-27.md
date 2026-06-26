# AISBP-Onboard Local / Staging Environment Setup Guide — 2026-06-27

> **Status**: Guide only. No real `.env` files have been created. Secrets must be filled by Wyn manually.
> **Prerequisite**: Read `docs/aisbp-onboard/environment-safety-verification-2026-06-27.md` (PR 16) first.

---

## 1. Create Environment Files From Examples

### Backend `.env`

```bash
# From repo root:
cp apps/backend/.env.example apps/backend/.env
```

Then **edit** `apps/backend/.env` and fill these values:

### Backend Variables Wyn Must Fill

| Variable | Where to Get / How to Generate | Example (do NOT use) |
|----------|-------------------------------|---------------------|
| `DATABASE_URL` | Supabase Dashboard → Settings → Database → Connection string | `postgresql://postgres:...@db.xxx.supabase.co:5432/postgres` |
| `SUPABASE_URL` | Supabase Dashboard → Settings → API → Project URL | `https://xxxx.supabase.co` |
| `SUPABASE_ANON_KEY` | Supabase Dashboard → Settings → API → anon/public key | `eyJhbGciOiJ...` |
| `SUPABASE_SERVICE_ROLE_KEY` | Supabase Dashboard → Settings → API → service_role key | `eyJhbGciOiJ...` |
| `JWT_SECRET` | `openssl rand -hex 32` | `a1b2c3d4e5f6...` (64 hex chars) |
| `ENCRYPTION_KEY` | `openssl rand -hex 16` | `a1b2c3d4e5f6...` (32 hex chars, convert to UTF-8 string) |
| `ONBOARD_AGENT_API_TOKEN` | `openssl rand -hex 32` | `a1b2c3d4e5f6...` (64 hex chars) |
| `REDIS_HOST` | `localhost` | `localhost` |
| `REDIS_PORT` | `6379` | `6379` |

### Keep These Safe Defaults

| Variable | Value | Why |
|----------|-------|-----|
| `ONBOARD_KB_SYNC_ENABLED` | `false` (commented or explicit) | Blocks KB apply until explicitly enabled for testing |
| `AISBP_OUTBOUND_THROUGH_KB_ENABLED` | N/A — belongs to KB backend, not Onboard | Verify it's `false` in KB environment |
| `NODE_ENV` | `development` or `staging` | Ensures safety defaults |
| `ALLOW_INSECURE_DEV_KEY` | `false` | Never set to true |

All other variables can stay as defaults from `.env.example`.

### Onboard Frontend `.env.local`

```bash
# From repo root:
cp apps/onboard/.env.example apps/onboard/.env.local
```

Then **edit** `apps/onboard/.env.local` and fill:

| Variable | Where to Get | Example |
|----------|-------------|---------|
| `NEXT_PUBLIC_SUPABASE_URL` | Same as backend `SUPABASE_URL` | `https://xxxx.supabase.co` |
| `NEXT_PUBLIC_SUPABASE_ANON_KEY` | Same as backend `SUPABASE_ANON_KEY` | `eyJhbGciOiJ...` |
| `NEXT_PUBLIC_ONBOARD_APP_URL` | `http://localhost:3002` | (keep default) |
| `NEXT_PUBLIC_APP_TIMEZONE` | `Asia/Singapore` | (keep default) |

---

## 2. Secrets Confirmation

**Before committing anything, verify these files are ignored:**

```bash
git status
# Should NOT show: apps/backend/.env, apps/onboard/.env.local
```

The `.gitignore` already covers:
- `.env`
- `.env.local`
- `.env.*.local`
- `.env.production`

---

## 3. Safe Startup Order

### Step 1: Start Redis
```bash
pnpm dev:redis
# or: docker run -d --name aisbp-redis -p 6379:6379 redis:7-alpine
```

### Step 2: Validate Schema (No DB Write)
```bash
# Replace <your-db-url> with actual DATABASE_URL value
DATABASE_URL="<your-db-url>" pnpm --filter @aisbp/backend exec prisma validate
```

If this passes, the schema is valid. No data has been written.

### Step 3: Generate Prisma Client (No DB Write)
```bash
DATABASE_URL="<your-db-url>" pnpm --filter @aisbp/backend exec prisma generate
```

### Step 4: Apply Migration (First DB Write — Confirm Safe First)
```bash
# prisma migrate deploy is idempotent — only applies new migrations.
# It will only add onboard_* tables. Existing KB tables are untouched.
DATABASE_URL="<your-db-url>" pnpm --filter @aisbp/backend exec prisma migrate deploy
```

**Alternative for disposable local DB only:**
```bash
pnpm --filter @aisbp/backend exec prisma db push
```
This skips migration history. Use only for throwaway local databases.

### Step 5: Start Backend (Terminal 1)
```bash
pnpm --filter @aisbp/backend dev
# Verify: curl http://localhost:3001/api/v1
# Should respond (may be empty/401 — that's OK, means auth is working)
```

### Step 6: Start Frontend (Terminal 2)
```bash
pnpm --filter @aisbp/onboard dev
# Opens at: http://localhost:3002
```

### Step 7: Verify Backend Tests
```bash
pnpm --filter @aisbp/backend test
# Should show: 147 suites, 1134 tests pass
```

---

## 4. Create Operator Account

1. Go to Supabase Dashboard → Authentication → Users
2. Click "Add User" → create user with email + password
3. Get the user's UUID from the Users table
4. Go to Supabase SQL Editor and run:

```sql
-- Add user to agency (replace values)
INSERT INTO agencies (id, name) VALUES (gen_random_uuid(), 'Onboard Test Agency');

-- Add user as agency owner (replace with actual UUIDs)
INSERT INTO agency_users (id, agency_id, profile_id, role)
VALUES (gen_random_uuid(), '<agency-id>', '<user-uuid>', 'OWNER');
```

5. Log in at `http://localhost:3002` with the created email + password

---

## 5. Test Agent Token

```bash
# Replace <token> with ONBOARD_AGENT_API_TOKEN value
curl -X POST http://localhost:3001/api/v1/onboard/agent/sessions \
  -H "Authorization: Bearer <token>" \
  -H "Content-Type: application/json" \
  -d '{"projectId": "00000000-0000-0000-0000-000000000001", "agentType": "whatsapp_ai"}'
# Should return 400 (project not found) or 401 (invalid token) — both prove auth works
```

---

## 6. Stop Conditions

**Immediately stop and check if any of these are true:**

| # | Condition | Action |
|---|-----------|--------|
| 1 | `DATABASE_URL` points to production KB database | Stop — do NOT run migration |
| 2 | `git status` shows `.env` or `.env.local` | Stop — add to .gitignore or remove before commit |
| 3 | Backend starts but logs show queue workers consuming jobs | Stop — Onboard shouldn't register queues |
| 4 | Frontend shows full phone numbers | Stop — masking is broken |
| 5 | Phone displayed unmasked | Stop — check `maskPhone()` implementation |
| 6 | Agent token can access operator endpoints | Stop — guard separation failed |
| 7 | Backend URLs reference production `kb.aisalesbot.pro` | Stop — wrong environment |

---

## 7. After Setup — Next Steps

1. Execute the PR 14 Controlled Pilot Runbook
2. Record results in a new execution report doc
3. Keep `ONBOARD_KB_SYNC_ENABLED=false` until explicitly testing KB apply
4. Never enable GHL apply (not implemented)
5. Never change `AISBP_OUTBOUND_THROUGH_KB_ENABLED`

---

## 8. Related Docs

| Doc | Purpose |
|-----|---------|
| `docs/aisbp-onboard/environment-safety-verification-2026-06-27.md` | PR 16 — what must be true before starting |
| `docs/aisbp-onboard/controlled-pilot-runbook-2026-06-27.md` | PR 14 — step-by-step test workflow |
| `docs/aisbp-onboard/final-e2e-safety-review-2026-06-27.md` | PR 13 — all 13 boundaries verified |
| `docs/aisbp-onboard/08-env-var-checklist.md` | PR 1 — full env var reference |
| `apps/backend/.env.example` | Backend env template (updated PR 17A) |
| `apps/onboard/.env.example` | Frontend env template (updated PR 17A) |
