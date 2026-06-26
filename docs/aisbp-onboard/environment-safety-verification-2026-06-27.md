# AISBP-Onboard Environment Safety Verification — 2026-06-27

> **Status**: Documentation only. No environment has been verified yet.
> **Purpose**: Define exact requirements for a safe staging/isolated environment before any controlled pilot.
> **Related**: PR 15 — Dry run not executed (no running environment).

---

## 1. Purpose

PR 15 could not execute a live dry-run because no safe running environment was available. This document defines exactly what must be true before PR 17 can execute the controlled dry run from the PR 14 runbook.

**Every checklist item must be confirmed before proceeding to live testing.**

---

## 2. Required Safe Environment

| Requirement | Rationale |
|-------------|-----------|
| Isolated test database | No risk to production KB data |
| Non-production Supabase project (or explicitly approved isolated tenant) | No risk to production auth/config |
| Local dev or dedicated staging environment | No real client impact |
| No live WhatsApp sending capability | `AISBP_OUTBOUND_THROUGH_KB_ENABLED=false` |
| No live GHL mutation capability | GHL apply not implemented; local validation only |
| No real client go-live | Pilot test data only |
| Backend running with test DB connection | Required for API calls |
| Frontend running with test Supabase | Required for operator UI |

**Acceptable environments**: Local dev (`localhost`), dedicated staging server, isolated Supabase branch.
**Unacceptable**: Production KB environment, production Supabase, any live GHL-connected instance.

---

## 3. Required Environment Variables

> **Do NOT add real secrets. Use test/dev values only. Document what must be set, not the values.**

### Core

| Variable | Required For | Safe Test Value |
|----------|-------------|-----------------|
| `ONBOARD_APP_URL` | Frontend origin | `http://localhost:3002` |
| `ONBOARD_API_BASE_URL` | API calls | `http://localhost:3001/api/v1` |
| `ONBOARD_ENV` | Environment label | `development` or `staging` |

### Database

| Variable | Required For | Notes |
|----------|-------------|-------|
| `DATABASE_URL` | Backend DB connection | Use isolated test DB, never production |

### Auth

| Variable | Required For | Notes |
|----------|-------------|-------|
| `NEXT_PUBLIC_SUPABASE_URL` | Frontend auth | Same Supabase project as backend |
| `NEXT_PUBLIC_SUPABASE_ANON_KEY` | Frontend auth | Anon key from Supabase project |
| `SUPABASE_URL` | Backend auth | Same as frontend |
| `SUPABASE_ANON_KEY` | Backend client | Anon key |
| `SUPABASE_SERVICE_ROLE_KEY` | Backend service client | Service role key |
| `JWT_SECRET` | Backend JWT signing | Generated, never committed |
| `ONBOARD_SESSION_SECRET` | (future use) | Generated |
| `ONBOARD_JWT_SECRET` | (future use) | Generated |

### Agent

| Variable | Required For | Notes |
|----------|-------------|-------|
| `ONBOARD_AGENT_API_TOKEN` | Agent API auth | Generated token for WhatsApp agent |

### Feature Flags

| Variable | Required Value | Notes |
|----------|---------------|-------|
| `ONBOARD_KB_SYNC_ENABLED` | `false` (default) | Set to `true` only in safe env for apply testing |
| `AISBP_OUTBOUND_THROUGH_KB_ENABLED` | `false` | **Must never be true** |
| `ONBOARD_GHL_SYNC_ENABLED` | `false` | GHL apply not implemented |
| `ONBOARD_AGENT_INTAKE_ENABLED` | `true` | Enable agent API for testing |

### Backend

| Variable | Required For | Notes |
|----------|-------------|-------|
| `API_PREFIX` | Route prefix | `api/v1` (default) |
| `CORS_ORIGIN` | CORS | `http://localhost:3002` or frontend URL |
| `APP_TIMEZONE` | Timezone | `Asia/Singapore` |
| `PORT` | Backend port | `3001` (default) |

### Frontend

| Variable | Required For | Notes |
|----------|-------------|-------|
| `NEXT_PUBLIC_APP_TIMEZONE` | UI timezone | `Asia/Singapore` |
| `BACKEND_URL` | API proxy target | `http://127.0.0.1:3001` |

---

## 4. Required Flag States

| Flag | Required Value | Verify Method |
|------|---------------|---------------|
| `AISBP_OUTBOUND_THROUGH_KB_ENABLED` | `false` | Check env; grep codebase for writes |
| Bot activation | Off (`setActive: false`) | Code-verified; check after bot profile apply |
| GHL apply implemented | No | No GHL apply endpoint exists |
| GHL mutation | Disabled | No GHL mutation code in Onboard module |
| WhatsApp/SMS/email sending | Disabled | No messaging modules imported |
| Production webhook processing | Off | No webhook processing in Onboard module |
| Production queue workers | Off | No `@nestjs/bullmq` in Onboard module |

---

## 5. Database Safety Checklist

| Check | Status |
|-------|--------|
| Safe DB selected (not production) | [ ] Confirmed |
| `DATABASE_URL` points to test DB | [ ] Confirmed |
| Migrations reviewed (1 migration: `add_onboard_tables`) | [ ] Reviewed |
| No destructive reset planned | [ ] Confirmed |
| Test client data clearly labeled (e.g., `pilot-test` clientKey) | [ ] Confirmed |
| Rollback/pause steps known (see PR 14 runbook Section 6) | [ ] Reviewed |
| No real customer PII in test data | [ ] Confirmed |
| Masked phone only in test data | [ ] Confirmed |
| Prisma validate passes | [ ] Run `prisma validate` |
| Prisma generate passes | [ ] Run `prisma generate` |

---

## 6. Backend Startup Checklist

| Check | Action | Expected |
|-------|--------|----------|
| B.1 | `pnpm --filter @aisbp/backend dev` | Backend starts on port 3001 |
| B.2 | `DATABASE_URL=... prisma validate` | Schema valid |
| B.3 | `DATABASE_URL=... prisma generate` | Client generated |
| B.4 | `pnpm --filter @aisbp/backend test` | 147 suites, 1134 tests pass |
| B.5 | `curl http://localhost:3001/api/v1/onboard/clients -H "Authorization: Bearer <jwt>"` | 200 with data or 401 without JWT |
| B.6 | JWT auth works (test with valid Supabase session) | `/auth/me` returns user |
| B.7 | OnboardOperatorGuard works (test with MEMBER role) | 403 |
| B.8 | AgentTokenGuard works (test with valid token) | Agent endpoints return 200 |
| B.9 | No outbound workers started | No BullMQ/queue logs |
| B.10 | No live webhook processors required | No webhook logs |
| B.11 | No GHL apply path active | `/sync/ghl/apply` returns 404 |

---

## 7. Frontend Startup Checklist

| Check | Action | Expected |
|-------|--------|----------|
| F.1 | `pnpm --filter @aisbp/onboard dev` | Frontend starts on port 3002 |
| F.2 | `pnpm --filter @aisbp/onboard build` | 9 routes compiled |
| F.3 | `pnpm --filter @aisbp/onboard lint` | 0 warnings |
| F.4 | Visit `http://localhost:3002` | Login page loads |
| F.5 | Log in with operator Supabase account | Dashboard loads |
| F.6 | Dashboard shows 0 projects (initial) | Empty state |
| F.7 | Navigate to /review-queue | Page loads |
| F.8 | Navigate to /sync | Page loads with KB dry-run input |
| F.9 | Navigate to /clients | Page loads with client list |
| F.10 | No full phone numbers displayed anywhere | Masked format only |
| F.11 | No API keys/secrets in page source | Verified |

---

## 8. No-Live-External-System Checklist

| Check | Status |
|-------|--------|
| No live WhatsApp test will be run | [ ] Confirmed |
| No live GHL mutation will be performed | [ ] Confirmed |
| No GHL workflow will be triggered | [ ] Confirmed |
| No appointment will be created | [ ] Confirmed |
| No message will be sent (WhatsApp/SMS/email) | [ ] Confirmed |
| No email will be sent | [ ] Confirmed |
| No SMS will be sent | [ ] Confirmed |
| No queue job for outbound will be created | [ ] Confirmed |
| `AISBP_OUTBOUND_THROUGH_KB_ENABLED` confirmed `false` | [ ] Confirmed |
| Bot activation confirmed off | [ ] Confirmed |

---

## 9. Safe Smoke Test Plan

After environment verification, run these safe smoke tests:

| # | Test | Expected |
|---|------|----------|
| 1 | Log in as operator | Dashboard loads |
| 2 | Create test client `pilot-test` | Client created, masked phone |
| 3 | Create test project | Project created, status=DRAFT |
| 4 | Submit agent answers (simulated) | Answers stored, audit recorded |
| 5 | Submit agent analysis | Analysis stored, recommendations SUGGESTED |
| 6 | Agent cannot approve (test 403) | Blocked |
| 7 | Approve sections as operator | Sections approved, audit recorded |
| 8 | Approve project as operator | Status=APPROVED |
| 9 | Run KB dry-run | DRY_RUN_PASSED, hash generated |
| 10 | Run KB apply `TENANT_IDENTITY_ONLY` | Only if `ONBOARD_KB_SYNC_ENABLED=true` |
| 11 | Run GHL validate | Valid/failed, no GHL API calls |
| 12 | Run GHL dry-run | Plan preview, all disabled |
| 13 | Inspect sync_runs | KB and GHL runs visible |
| 14 | Inspect audit_events | All writes recorded |
| 15 | Review UI wording | No "live bot" / "GHL synced" / "messages sent" |

---

## 10. Stop Conditions

**Immediately stop and report if:**

| Condition | Why |
|-----------|-----|
| Environment is production (and not explicitly approved) | Production data at risk |
| `AISBP_OUTBOUND_THROUGH_KB_ENABLED` is `true` | Outbound must remain off |
| Bot profile can activate (`setActive: true` appears) | Bot must stay inactive |
| GHL mutation path appears | No GHL apply is implemented |
| Message send path appears | No messaging modules imported |
| Full phone number appears in UI, logs, or DB | PII exposure |
| Agent can approve or sync | Security boundary violation |
| Stale dry-run apply is allowed | Snapshot safety violation |
| `ONBOARD_KB_SYNC_ENABLED` is `true` in production | KB writes gated |

---

## 11. Evidence to Capture

| Item | Value |
|------|-------|
| Environment name | `________________` |
| Backend URL | `________________` |
| Frontend URL | `________________` |
| Database identifier (masked) | `________________` |
| Commit hash | `________________` |
| Operator account role | `________________` |
| Feature flags snapshot | `________________` |
| Test clientKey | `________________` |
| Test onboardingProjectId | `________________` |
| Test syncRunId (dry-run) | `________________` |
| Test syncRunId (apply) | `________________` |
| Screenshot: Backend startup logs | `________________` |
| Screenshot: Dashboard | `________________` |
| Screenshot: Sync page | `________________` |
| Test result: PASS / FAIL | `________________` |

---

## 12. Existing Docs References

For detailed test procedures, see:
- `docs/aisbp-onboard/controlled-pilot-runbook-2026-06-27.md` — PR 14 runbook (60+ steps)
- `docs/aisbp-onboard/kb-sync-integrity-review-2026-06-27.md` — PR 10I integrity review
- `docs/aisbp-onboard/final-e2e-safety-review-2026-06-27.md` — PR 13 final review
- `docs/aisbp-onboard/kb-target-mapping-2026-06-27.md` — PR 10B KB mapping
- `docs/aisbp-onboard/08-env-var-checklist.md` — Full env var reference

---

## 13. Verification Status

| Area | Status |
|------|--------|
| Environment set up | [ ] Not yet |
| Environment variables configured | [ ] Not yet |
| Database accessible | [ ] Not yet |
| Backend running | [ ] Not yet |
| Frontend running | [ ] Not yet |
| Auth working | [ ] Not yet |
| Smoke tests completed | [ ] Not yet |
| Stop conditions checked | [ ] Not yet |

**Current state**: Environment not verified. All code-level checks pass. Infrastructure setup required.

---

## 14. Recommended Next PR

**PR 17 — Controlled Dry Run Execution in Verified Safe Environment**

Execute the safe smoke test plan (Section 9) and the PR 14 runbook in a verified safe environment. Capture all evidence and report go/no-go.

If environment setup reveals issues:
**PR 17 — Environment Fixes / Staging Setup**
