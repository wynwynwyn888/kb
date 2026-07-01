# KB Staging/Testing-Copy Setup Plan — PR #23

> **Task Mode:** Plan only. No implementation, no deployments, no secret inspection.
> **Date:** 2026-06-28
> **Author:** Safe Autopilot (recon/plan)

---

## 1. Task Title

Plan: KB staging/testing-copy setup for PR #23 without production impact

## 2. Branch Name

`review/kb-stacked-onboard-cleanup-2026-06-28` (current branch, NOT yet merged to main)

## 3. Commit Hash

HEAD: `61966c6b6c8bfe44d3efb90b6271d149784f93f1`

## 4. Files Changed (from inspection)

PR #23 (`review/kb-stacked-onboard-cleanup-2026-06-28` vs `main`): **74 files**, ~14,906 insertions / 348 deletions

Key categories:
- **Backend Onboard module** (`apps/backend/src/modules/onboard/`): controllers, services, guards, DTOs, types, tests, fixtures
- **Prisma schema + migration** (`20260626150000_add_onboard_tables`): 424-line additive SQL (37 enum types, 16+ onboard_* tables)
- **Removal of separate `apps/onboard` Next.js app** (cleanup: removed stale `pnpm-lock` importer)
- **KB sync mapper** (`onboard-kb-sync.mapper.ts`): maps onboard data → KB plan (disabled by flag by default)
- **Agent API** (`agent/`): WhatsApp agent intake endpoints, token guard
- **Safety fixtures** (`__fixtures__/`): pilot data, KB sync fixtures, regression specs
- **Tests**: 1,134 total backend tests passing (per CI)

## 5. Existing Deploy/CI Config Summary

### Render Blueprint (`render.yaml`)
| Service | Runtime | Region | Branch | Health |
|---------|---------|--------|--------|--------|
| `aisbp-api` (NestJS) | Node, free | Singapore | `main` | `/docs` |
| `aisbp-web` (Next.js) | Node, free | Singapore | `main` | `/` |

Both auto-deploy on push to `main`. Env vars include `DATABASE_URL`, `SUPABASE_*`, `JWT_SECRET`, `ENCRYPTION_KEY`, `REDIS_*`, `CORS_ORIGIN`, `INVITE_APP_BASE_URL` — all marked `sync: false`.

### Hostinger VPS via GitHub Actions (`deploy-hostinger.yml`)
- Trigger: push to `main` + `workflow_dispatch`
- Workflow: CI (`test-and-build`) → SSH to VPS → git pull → Docker Compose build/restart
- Uses `docker-compose.hostinger.yml` with env from `.env.production`
- Backend entrypoint (`docker-entrypoint.sh`) runs `npx prisma migrate deploy` on startup (unless `SKIP_PRISMA_MIGRATE=1`)
- Production domain: `https://kb.aisalesbot.pro`
- Caddy reverse proxy terminates TLS

### Local Docker Compose (`infra/vps/docker-compose.yml`)
- Alternative VPS deploy with `context: ../..` build
- Same `docker-entrypoint.sh` with auto-migration

## 6. Existing Branch Trigger Summary

| Trigger | What Runs | Branches |
|---------|-----------|----------|
| `ci.yml` (pull_request + push) | `test-and-build`: install → prisma generate → build:libs → backend tests → frontend tests → full build | PRs + `main` |
| `deploy-hostinger.yml` (push + workflow_dispatch) | CI → SSH deploy to Hostinger VPS | `main` only |
| Render Blueprint | Auto-deploy API + Web | `main` only |

**Critical finding:** Any merge to `main` triggers:
1. Render auto-deploy (builds + deploys API and Web)
2. Hostinger SSH deploy (CI → VPS pull → Docker rebuild → `prisma migrate deploy` → restart)
3. The `prisma migrate deploy` step automatically applies the `add_onboard_tables` migration to the **production database**

## 7. Production-Risk Findings

### High-risk
| Risk | Detail |
|------|--------|
| **Auto-deploy on main merge** | Both Render and Hostinger auto-deploy on push to `main`. No staging gate exists. |
| **Auto-migration on deploy** | `docker-entrypoint.sh` runs `npx prisma migrate deploy` at container start. Migrating to production DB before staging verification. |
| **Single database** | Backend uses one `DATABASE_URL`. No environment-level DB separation between staging/test and production. Onboard tables live in same DB as KB production tables. |
| **Render also deploys from main** | Render Blueprint also deploys on `main` push. Two deployment targets, both from the same branch. |

### Medium-risk
| Risk | Detail |
|------|--------|
| **Migration is additive but large** | 424-line migration with 37 enums + 16+ tables. Additive + idempotent (IF NOT EXISTS), but untested on production schema. |
| **No staging environment exists** | No `staging` branch, no staging deployment target, no staging DB, no staging domain. |

### Low-risk (guarded by feature flags)
| Risk | Detail |
|------|--------|
| **Onboard KB sync** | `ONBOARD_KB_SYNC_ENABLED` defaults `false` — no KB apply can happen |
| **GHL sync** | `ONBOARD_GHL_SYNC_ENABLED` defaults `false` — not implemented |
| **Agent intake** | Requires `ONBOARD_AGENT_API_TOKEN` to be set |
| **Outbound through KB** | `AISBP_OUTBOUND_THROUGH_KB_ENABLED` defaults `false` — must stay false |

## 8. Recommended Staging Architecture

### RECOMMENDED: Local Staging with Isolated Supabase Project

```
┌─────────────────────────────────────────────────────────────┐
│                    Wyn's Local Machine                       │
│                                                             │
│  Docker (Redis:7-alpine)                                    │
│  ┌──────────┐  ┌──────────┐                                 │
│  │  KB API  │  │  KB Web  │  (localhost:3001 / :3000)      │
│  │ (NestJS) │  │ (Next.js)│                                 │
│  └────┬─────┘  └──────────┘                                 │
│       │                                                     │
│       │  DATABASE_URL → staging Supabase project            │
│       │  (separate from production kb.aisalesbot.pro)       │
│       ▼                                                     │
│  ┌──────────────────────────────────────┐                   │
│  │  Staging Supabase Project            │ (cloud)           │
│  │  - Isolated Postgres                 │                   │
│  │  - Separate auth users               │                   │
│  │  - No real GHL connections           │                   │
│  │  - No production webhook traffic     │                   │
│  └──────────────────────────────────────┘                   │
│                                                             │
│  Feature flags:                                             │
│    ONBOARD_KB_SYNC_ENABLED=true   (staging only, for test)  │
│    ONBOARD_AGENT_INTAKE_ENABLED=true                        │
│    All other flags: default off                             │
└─────────────────────────────────────────────────────────────┘
```

### Alternative: Separate Staging Branch + Staging Domain on Same VPS

```
┌─────────────────────────────────────────────────────────────┐
│                    Hostinger VPS                             │
│                                                             │
│  Production (main):                    Staging:             │
│    kb.aisalesbot.pro:3000              staging.kb.aisalesbot.pro:3002
│    docker-compose.hostinger.yml        docker-compose.staging.yml
│    .env.production                     .env.staging
│    → production Supabase               → staging Supabase   │
│                                                             │
│  Caddy routes by hostname to different ports               │
│  Separate Redis (or same with QUEUE_PREFIX=staging)         │
└─────────────────────────────────────────────────────────────┘
```

**Recommendation: Local staging (option 1) for PR #23 testing.** It's zero-cost, requires no DNS/domain setup, and provides full isolation. A VPS staging environment (option 2) can be added later for ongoing staging needs.

## 9. Required Staging Resources

### Minimum Viable Staging (Local)

| Resource | How to Obtain | Cost |
|----------|--------------|------|
| **Staging Supabase project** | Create new free project at supabase.com/dashboard | Free |
| **Staging Postgres** | Comes with Supabase project | Free |
| **Redis** | Local Docker: `docker run -d -p 6379:6379 redis:7-alpine` | Free |
| **Domain** | Not needed — use `localhost:3000` / `localhost:3001` | N/A |
| **Staging env vars** | Copy `.env.example` → `.env`, fill with staging Supabase values | N/A |
| **Git branch** | Create `staging` branch from PR branch | N/A |

### Optional VPS Staging (for ongoing use)

| Resource | How to Obtain | Cost |
|----------|--------------|------|
| **Staging subdomain** | Add DNS A record `staging.kb.aisalesbot.pro` → VPS IP | Free (existing domain) |
| **Caddy config** | Add site block for staging subdomain, route to alternate port | Free |
| **Staging Docker compose** | Copy `docker-compose.hostinger.yml` with staging ports/env | Free |
| **Staging `.env.staging`** | VPS file with staging Supabase values | Free |

## 10. Env/Secrets Separation Plan

### Files (no values inspected)

| File | Purpose | Status |
|------|---------|--------|
| `apps/backend/.env.example` | Backend env template (187 lines, includes all Onboard flags) | Inspected — safe |
| `apps/frontend/.env.example` | Frontend env template (20 lines) | Inspected — safe |
| `infra/vps/env.vps.example` | VPS env template | Inspected — safe |
| `apps/backend/.env` | Production backend env (gitignored) | NOT inspected |
| `.env.production` | VPS production env (gitignored) | NOT inspected |
| `apps/frontend/.env.local` | Frontend env (gitignored) | NOT inspected |

### Staging env var plan (keys only, no values)

**Backend `.env` (staging):**
- `DATABASE_URL` → staging Supabase connection string (separate from production)
- `SUPABASE_URL`, `SUPABASE_ANON_KEY`, `SUPABASE_SERVICE_ROLE_KEY` → staging Supabase project
- `JWT_SECRET` → generate new with `openssl rand -hex 32`
- `ENCRYPTION_KEY` → generate new (32 UTF-8 chars)
- `WEBHOOK_SIGNATURE_SECRET` → generate new (or leave unset for unsigned webhooks in staging)
- `REDIS_HOST=localhost`, `REDIS_PORT=6379`
- `CORS_ORIGIN=http://localhost:3000`
- `INVITE_APP_BASE_URL=http://localhost:3000`
- `GHL_CLIENT_ID`, `GHL_CLIENT_SECRET` → leave empty (no GHL OAuth in staging)
- `OPENAI_API_KEY` → leave empty or use restricted test key
- `ONBOARD_KB_SYNC_ENABLED=true` (staging only — allows KB apply testing)
- `ONBOARD_AGENT_INTAKE_ENABLED=true` (staging only)
- `ONBOARD_AGENT_API_TOKEN` → generate with `openssl rand -hex 32`
- All other Onboard flags: default `false`
- `AISBP_OUTBOUND_THROUGH_KB_ENABLED` → must remain `false`

**Frontend `.env.local` (staging):**
- `NEXT_PUBLIC_SUPABASE_URL` → staging Supabase project
- `NEXT_PUBLIC_SUPABASE_ANON_KEY` → staging Supabase anon key
- `NEXT_PUBLIC_APP_URL=http://localhost:3000`

## 11. Database/Migration Staging Plan

### Migration summary
- **File**: `apps/backend/prisma/migrations/20260626150000_add_onboard_tables/migration.sql` (424 lines)
- **Type**: Additive, idempotent (uses `IF NOT EXISTS` for all DDL)
- **Content**: Creates 37 Postgres enums + 16+ onboard_* tables
- **Impact on existing KB tables**: None (all new tables, no ALTER to existing)

### Safe migration procedure
1. **Before anything**: Take a Supabase backup of production database (Wyn does this manually)
2. **Stage 1 — Local staging DB**:
   ```bash
   # Set DATABASE_URL to staging Supabase
   pnpm --filter @aisbp/backend exec prisma validate    # validate schema
   pnpm --filter @aisbp/backend exec prisma generate     # generate client
   pnpm --filter @aisbp/backend exec prisma migrate deploy  # apply migration to staging DB
   pnpm --filter @aisbp/backend run db:seed              # seed test data
   ```
3. **Stage 2 — Run tests against staging DB**: `pnpm --filter @aisbp/backend test` (1,134 tests)
4. **Stage 3 — Smoke test the Onboard API** against staging DB
5. **Stage 4 — Only after all staging tests pass**: apply migration to production DB
   - Option A: Set `SKIP_PRISMA_MIGRATE=0` and deploy to production (auto-runs `prisma migrate deploy`)
   - Option B: Run `prisma migrate deploy` manually against production DB before deploy

### Migration rollback
- The migration is **additive only** — rollback = stop using onboard tables (they don't affect KB)
- To fully rollback: drop onboard_* tables manually (no data loss as KB doesn't use them)
- Feature flags can disable all onboard behavior without removing tables

## 12. CRM/GHL/Customer-Message Isolation Plan

### Built-in safety (no additional config needed)
| Guard | Mechanism | Default |
|-------|-----------|---------|
| KB sync disabled | `ONBOARD_KB_SYNC_ENABLED=false` | No KB writes happen |
| GHL sync not implemented | No `/sync/ghl/apply` endpoint in code | Cannot apply to GHL |
| Agent intake gated | `ONBOARD_AGENT_API_TOKEN` required | Agent endpoints return 401 without token |
| No outbound messaging | `AISBP_OUTBOUND_THROUGH_KB_ENABLED=false` | Cannot send messages |
| No bot activation | Code-level enforcement: bot profile `setActive: false` | Bots never activate |
| Webhook protection | `WEBHOOK_SIGNATURE_SECRET` required in production | Unsigned webhooks rejected |

### For staging: additional isolation
- **Separate Supabase project**: no GHL connection data exists in staging DB (no `tenant_ghl_connections` rows point to real locations)
- **No real Supabase users**: create test-only users in staging Supabase Auth
- **No real phone numbers**: use test data with masked phones
- **No real GHL API keys**: leave `GHL_CLIENT_ID` / `GHL_CLIENT_SECRET` empty in staging
- **No real OpenAI/Anthropic keys**: leave empty or use restricted test keys

### Staging-specific safeguards
- All webhooks go to production URL `kb.aisalesbot.pro/api/v1/webhooks/ghl` — staging on localhost never receives real webhooks
- Staging uses a `QUEUE_PREFIX` (or its own Redis) to avoid processing production queue jobs

## 13. Smoke-Test Checklist (Staging)

Based on existing docs (`docs/aisbp-onboard/environment-safety-verification-2026-06-27.md`):

### Backend
- [ ] B.1 Backend starts on port 3001 without errors
- [ ] B.2 `prisma validate` passes against staging DB
- [ ] B.3 `prisma generate` succeeds (client includes onboard models)
- [ ] B.4 `pnpm --filter @aisbp/backend test` → all 1,134+ tests pass
- [ ] B.5 `curl localhost:3001/api/v1/onboard/clients` → 401 (auth required)
- [ ] B.6 JWT auth works (`/auth/me` returns user from staging Supabase)
- [ ] B.7 Operator guard works (MEMBER role → 403 on operator endpoints)
- [ ] B.8 Agent token guard works (valid token → 200; invalid → 401)
- [ ] B.9 KB webhook pipeline still functions (existing feature, regression test)
- [ ] B.10 No onboard routes interfere with existing KB routes

### Frontend
- [ ] F.1 Frontend builds and starts on port 3000
- [ ] F.2 Login page loads with staging Supabase auth
- [ ] F.3 Dashboard loads after login
- [ ] F.4 `/review-queue` page loads
- [ ] F.5 `/sync` page loads with KB dry-run input
- [ ] F.6 `/clients` page loads
- [ ] F.7 No full phone numbers in UI

### Onboard flow (with feature flags ON for staging)
- [ ] O.1 Create test client `pilot-test`
- [ ] O.2 Create test project
- [ ] O.3 Agent creates session → submits answers → requests review
- [ ] O.4 Operator approves sections
- [ ] O.5 Operator approves project
- [ ] O.6 KB dry-run succeeds
- [ ] O.7 KB sync apply succeeds (targets staging KB only)
- [ ] O.8 Identity map updates correctly
- [ ] O.9 Audit log complete
- [ ] O.10 Agent cannot approve/sync (403)
- [ ] O.11 Feature flags work (disable KB sync → apply returns error)

### No-live-external-system
- [ ] No WhatsApp/SMS/email sent
- [ ] No GHL API mutations
- [ ] No real customer contacted
- [ ] `AISBP_OUTBOUND_THROUGH_KB_ENABLED` confirmed `false`

## 14. Promotion-to-Production Path

```
PR #23 branch → staging branch → local staging test → Wyn approval → merge to main → production deploy
```

### Step-by-step
1. Create `staging` branch from `review/kb-stacked-onboard-cleanup-2026-06-28`
2. Set up local staging environment (isolated Supabase + local Docker Redis)
3. Run migration on staging DB → run all tests → run smoke tests
4. Wyn reviews staging test results
5. **If all tests pass** and Wyn approves:
   a. Take production Supabase backup
   b. Merge PR to `main`
   c. Render auto-deploys from `main`
   d. Hostinger auto-deploys from `main` (runs `prisma migrate deploy`)
   e. Verify production health: `/docs`, `/`, `/api/v1`
   f. Verify no onboard feature flags enabled in production
   g. Verify KB webhook pipeline unaffected (smoke test)

### Merge safety
- Render and Hostinger both deploy from `main` — there's no gate between the two
- Consider: set `SKIP_PRISMA_MIGRATE=1` on first deploy, run migration manually after verifying container health
- Actually, `prisma migrate deploy` is idempotent — safe to run automatically

## 15. Rollback Strategy

### If production deploy fails
1. **Immediate**: Hostinger VPS → `git reset --hard` to previous commit, rebuild containers
2. **Render**: Dashboard → rollback to previous deploy
3. **Database**: No rollback needed — onboard tables are additive and don't affect KB. All onboard feature flags default `false`.

### If migration causes issues (unlikely — it's additive and idempotent)
1. Drop onboard tables: `DROP TABLE IF EXISTS onboard_* CASCADE;` + `DROP TYPE IF EXISTS Onboard*;`
2. KB tables are untouched — zero data loss

### If onboard code causes runtime errors
1. Set all onboard feature flags to `false` (they default false)
2. Onboard controllers are behind auth guards — no unauthenticated access
3. Worst case: deploy previous commit, onboard tables remain but unused

## 16. What Safe Autopilot May Do Without Asking

- **Read/inspect** any non-secret file in the repo for planning purposes
- **Create documentation** (like this plan) in the `docs/` directory
- **Run read-only git commands** (`git log`, `git branch`, `git status`)
- **Run local build checks** (`pnpm run typecheck`, `pnpm run lint`) — non-destructive
- **Run unit tests** (`pnpm test`) — do not touch production DB

## 17. What Requires Wyn Explicit Approval

| Action | Why Needs Approval |
|--------|-------------------|
| Creating a staging Supabase project | Requires Supabase account access + API key management |
| Setting real env var values | Involves secrets (DATABASE_URL, SUPABASE keys, JWT secret) |
| Creating the `staging` branch + pushing | Git operations that could trigger CI (though CI only deploys from main) |
| Running `prisma migrate deploy` against any DB | Database write operation |
| Deploying to any environment | Deploy operation |
| Merging PR #23 to `main` | Triggers production deploy + migration |
| Creating DNS records for staging subdomain | Infrastructure change |
| Modifying GitHub Actions workflows | CI/CD change |
| Modifying `render.yaml` | PaaS configuration change |
| Setting GitHub Actions secrets | Security-sensitive |

## 18. Final Recommendation

### Recommended staging path for PR #23

**Phase 1 — Local staging (now):**
1. Wyn creates a separate free Supabase project for staging
2. Wyn fills `apps/backend/.env` with staging Supabase values
3. Safe Autopilot (on approval) creates a `staging` branch from PR branch
4. Run `prisma generate` + `prisma migrate deploy` against staging DB (requires Wyn's DATABASE_URL)
5. Run full test suite → 1,134 tests must pass
6. Run smoke test checklist (Section 13 above)
7. Report results

**Phase 2 — Production merge (after Phase 1 passes + Wyn approval):**
1. Take production Supabase backup
2. Merge PR #23 to `main`
3. Monitor Render + Hostinger auto-deploy
4. Verify production webhook pipeline
5. Confirm all onboard feature flags `false` in production

### Why local staging is the right choice for PR #23
- **Zero cost**: Free Supabase project + local Docker Redis
- **Full isolation**: Separate DB, separate auth, no risk to production
- **Fast iteration**: No DNS, no VPS setup, no domain config
- **Sufficient for PR scope**: Adding a new module with feature flags off by default
- **VPS staging** can be added later if needed for ongoing staging needs

### Key safety properties preserved
- Onboard module is entirely gated behind feature flags (all default `false`)
- Onboard tables use separate prefix (`onboard_*`), no collision with KB tables
- Migration is additive and idempotent
- No GHL API mutations exist in code
- No messaging path is enabled
- Agent API requires a bearer token
- Operator endpoints require agency role (Supabase JWT)
