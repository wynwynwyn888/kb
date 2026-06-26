# AISBP-Onboard — Deployment Guide

## 1. Recommended Deployment Model

AISBP-Onboard should deploy alongside the existing KB infrastructure on the same VPS (`<PRODUCTION_SERVER>`), as a separate container or service.

```
┌─────────────────────────────────────────────────────────────┐
│                    VPS (<PRODUCTION_SERVER>)                   │
│                                                             │
│  ┌──────────┐  ┌──────────┐  ┌──────────┐  ┌──────────┐   │
│  │  Caddy   │  │  KB API  │  │  KB      │  │ Onboard  │   │
│  │ (proxy)  │  │ (NestJS) │  │ (Next.js)│  │ (Next.js)│   │
│  └──────────┘  └──────────┘  └──────────┘  └──────────┘   │
│                                                             │
│  ┌──────────┐  ┌──────────┐                                 │
│  │  Redis   │  │ Supabase │  (managed)                      │
│  └──────────┘  └──────────┘                                 │
└─────────────────────────────────────────────────────────────┘
```

**Domains** (to confirm after scaffold):
- KB: `https://kb.aisalesbot.pro`
- Onboard: `https://onboard.aisalesbot.pro` (or `https://kb.aisalesbot.pro/onboard`)

---

## 2. Environment Plan

### Dev
- Local Next.js dev server on port 3002
- Connects to local Supabase (or shared dev Supabase)
- Connects to local NestJS backend on port 3001
- All feature flags: enabled for testing

### Staging
- Before production deployment
- Separate Supabase project (or staging branch in production Supabase)
- Test all flows with test data only
- Dry-run KB sync verified
- No GHL apply sync

### Production
- Same VPS as KB
- Same Supabase as KB (new tables, existing auth)
- `ONBOARD_KB_SYNC_ENABLED=false` (set to `true` only after PR 9 implemented, staging dry-run passes, and Wyn explicitly approves)
- `ONBOARD_GHL_SYNC_ENABLED=false` (until explicitly approved, future PR 10+)
- `ONBOARD_EXTERNAL_NOTIFICATIONS_ENABLED=false`
- `AISBP_OUTBOUND_THROUGH_KB_ENABLED` remains `false`

---

## 3. Staging Before Production Checklist

- [ ] All unit tests pass
- [ ] All API tests pass
- [ ] Agent creates session → submits answers → requests review
- [ ] Wyn approves sections → approves project
- [ ] KB dry-run succeeds (no errors)
- [ ] KB sync apply succeeds (staging KB only)
- [ ] Identity map updated correctly
- [ ] Audit log complete
- [ ] Phone masking verified
- [ ] No secrets in responses
- [ ] Agent cannot approve (verified by test)
- [ ] Agent cannot sync (verified by test)
- [ ] Feature flags work as expected

---

## 4. Env Checklist (Production)

To confirm after scaffold. See [08-env-var-checklist.md](./08-env-var-checklist.md) for full list.

### Must-set:
- [ ] `ONBOARD_APP_URL` — production URL
- [ ] `ONBOARD_ENV=production`
- [ ] `DATABASE_URL` — Supabase connection string
- [ ] `ONBOARD_SESSION_SECRET` — generated, never committed
- [ ] `ONBOARD_JWT_SECRET` — can reuse existing KB JWT secret
- [ ] `ONBOARD_ADMIN_EMAILS` — Wyn's email
- [ ] `ONBOARD_SERVICE_TOKEN_SECRET` — generated, never committed
- [ ] `ONBOARD_AGENT_API_TOKEN` — generated, never committed
- [ ] `KB_INTEGRATION_BASE_URL` — internal KB API URL
- [ ] `KB_ONBOARD_INTEGRATION_TOKEN` — generated, shared with KB backend

### Must-stay-off:
- [ ] `ONBOARD_GHL_SYNC_ENABLED=false`
- [ ] `ONBOARD_EXTERNAL_NOTIFICATIONS_ENABLED=false`

---

## 5. Secret Setup

All secrets should be generated, never hardcoded, and never committed:

```bash
# Generate secrets
openssl rand -hex 32  # For: ONBOARD_SESSION_SECRET, ONBOARD_JWT_SECRET,
                       #       ONBOARD_SERVICE_TOKEN_SECRET, ONBOARD_AGENT_API_TOKEN,
                       #       KB_ONBOARD_INTEGRATION_TOKEN

# Set in production environment
# Via VPS env file or docker-compose environment section
# Never commit to git
```

---

## 6. Database Migration Approach

To confirm after scaffold — likely:

```bash
# After adding Onboard models to Prisma schema (in KB backend)
cd ~/Projects/KB/kb-explore
pnpm --filter @aisbp/backend exec prisma migrate dev --name add_onboard_tables

# In production:
pnpm --filter @aisbp/backend exec prisma migrate deploy
```

**Safety rules**:
- Migrations run in the KB backend (`kb-explore/apps/backend/`) since that's where Prisma lives
- Only additive migrations (CREATE TABLE, ALTER TABLE ADD COLUMN)
- Never drop columns or tables without backup
- Never modify existing KB tables
- Test migrations in staging first
- Take Supabase backup before production migration

---

## 7. Build Commands (to confirm after scaffold)

```bash
# Install dependencies
pnpm install

# Build Onboard
pnpm build

# Type check
pnpm typecheck

# Run tests
pnpm test
```

---

## 8. Deploy Commands (to confirm after scaffold)

```
# Pattern follows existing KB deployment (see infra/vps/)

# Build Docker image for Onboard
docker build -f infra/vps/Dockerfile.onboard -t aisbp-onboard .

# Or add to existing docker-compose
# Update docker-compose.hostinger.yml or infra/vps/docker-compose.yml
# Add onboard service:
#
#   onboard:
#     build:
#       context: .
#       dockerfile: infra/vps/Dockerfile.onboard
#     ports:
#       - "3002:3000"
#     env_file:
#       - .env.production
#
# docker compose up -d onboard
```

---

## 9. Health Checks

```
GET /api/health
→ 200 { "status": "ok", "db": "connected", "uptime": 3600 }
```

Monitor:
- Onboard app responds on its URL
- DB connection alive
- KB integration reachable (if sync enabled)
- No error spikes in logs

---

## 10. Smoke Test Plan (Post-Deploy)

1. Visit Onboard URL → login page loads
2. Login with Wyn's agency account → dashboard loads
3. Create a test project → form works, data persists
4. Edit a section → save works, reload shows data
5. Simulate agent API call:
   ```bash
   curl -X POST https://onboard.aisalesbot.pro/api/v1/onboard/agent/sessions \
     -H "Authorization: Bearer $ONBOARD_AGENT_API_TOKEN" \
     -H "Content-Type: application/json" \
     -d '{"projectId": "test-project-id", "agentType": "whatsapp_ai"}'
   ```
6. Approve a section → status updates
7. KB dry-run → preview page loads, no KB changes
8. Check audit log → events visible

---

## 11. Rollback Plan

If something goes wrong after Onboard deploy:

### Option 1: Stop Onboard container
```bash
docker compose stop onboard
```
KB continues to function normally.

### Option 2: Disable feature flags
Set environment variables and restart:
```
ONBOARD_KB_SYNC_ENABLED=false
ONBOARD_GHL_SYNC_ENABLED=false
ONBOARD_AGENT_INTAKE_ENABLED=false
```

### Option 3: Remove Onboard entirely
```bash
docker compose down onboard
```
Onboard tables remain in DB (no data loss), app is inaccessible.

### Key safety property:
**Onboard failure does not affect KB.** KB's webhook pipeline, AI orchestration, and ops dashboard are completely independent of Onboard.

---

## 12. Monitoring

- VPS health: CPU, memory, disk (existing monitoring)
- Onboard container: up/down status
- API error rate: track 5xx responses
- Sync failures: monitor sync_run status = apply_failed
- DB migrations: verify applied correctly

---

## 13. Logging

Follow existing KB pattern:
- Structured JSON logs to stdout
- Log levels: error, warn, info, debug
- Correlation IDs for request tracing
- No PII or secrets in logs

---

## 14. First Pilot Deployment Checklist

- [ ] Staging verified (all flows work on staging)
- [ ] Production env vars set (all secrets generated)
- [ ] Database migration run on production Supabase
- [ ] Onboard container deployed and healthy
- [ ] Health check passes
- [ ] Smoke test passes
- [ ] KB production unaffected (verified in Ops dashboard)
- [ ] Runtime flags unchanged
- [ ] `AISBP_OUTBOUND_THROUGH_KB_ENABLED` confirmed `false`
- [ ] Only one test client created (not real client yet)
- [ ] All feature flags in safe position:
  - `ONBOARD_KB_SYNC_ENABLED=false` (production KB apply sync disabled by default)
  - `ONBOARD_GHL_SYNC_ENABLED=false`
  - `ONBOARD_EXTERNAL_NOTIFICATIONS_ENABLED=false`

---

## 15. Safe Launch Checklist

- [ ] No production GHL apply sync (feature flag off)
- [ ] External notifications off by default
- [ ] Agent cannot approve/sync (code-level enforcement verified)
- [ ] Staging fully tested before production
- [ ] One controlled pilot client only at first
- [ ] Rollback plan confirmed and tested
- [ ] Wyn notified of launch

---

## 16. Post-Deploy Verification Checklist

**Hour 1**:
- [ ] Onboard dashboard loads
- [ ] Agent API responds (health check)
- [ ] KB Ops dashboard shows no new errors
- [ ] Supabase shows new tables with no errors

**Hour 24**:
- [ ] No error spikes in Onboard or KB logs
- [ ] Pilot client project created and verified
- [ ] KB sync (if performed) successful
- [ ] Audit log complete
- [ ] Rollback not needed (so far)
