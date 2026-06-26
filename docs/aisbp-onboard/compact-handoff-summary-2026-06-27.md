# AISBP-Onboard Compact Handoff Summary — 2026-06-27

> **For future agents continuing without full chat context.**
> **Latest commit**: `3b43437` — PR 17B No-Env Pilot Fixtures

---

## 1. Current Build Status

| Item | Status |
|------|--------|
| PR 1–17B committed | Yes — 37 commits in `main` |
| Frontend (`apps/onboard/`) | 9 routes, Next.js 14, real API client |
| Backend (`apps/backend/src/modules/onboard/`) | Full NestJS module (controller, service, agent, guards, kb-sync, fixtures) |
| Database | Prisma schema + 1 migration (`add_onboard_tables`), not applied |
| Environment | **Not configured** — no `.env` files, no Supabase, no Redis |
| Runtime testing | **Not performed** — backend/frontend not started |
| Live WhatsApp/GHL tests | **Not performed** |

---

## 2. Core Architecture

```
AI Agent → AISBP-Onboard Draft → Wyn Review → Approved Sync → KB/GHL
```

---

## 3. Agent Boundary

| Can Do | Cannot Do |
|--------|-----------|
| Create/resume interview sessions | Approve sections |
| Submit answers (upsert by key) | Approve projects |
| Submit workflow analysis | Run KB dry-run |
| Submit automation recommendations | Run KB apply |
| Request operator review | Run GHL validation/dry-run |
| Get project status | Call KB/GHL directly |
| Get missing fields | Send messages |
| | Activate bot |

Agent auth: `AgentTokenGuard` (Bearer token vs `ONBOARD_AGENT_API_TOKEN` env var)

---

## 4. Operator Boundary

Operator auth: `JwtAuthGuard + OnboardOperatorGuard` (OWNER/ADMIN/OPERATOR agency roles)

| Endpoint Group | Count | Guard |
|---------------|-------|-------|
| Client CRUD | 4 | JwtAuthGuard + OnboardOperatorGuard |
| Project CRUD | 4 | JwtAuthGuard + OnboardOperatorGuard |
| Approval | 6 | JwtAuthGuard + OnboardOperatorGuard |
| KB sync | 6 | JwtAuthGuard + OnboardOperatorGuard |
| GHL | 2 | JwtAuthGuard + OnboardOperatorGuard |
| Alerts | 1 | JwtAuthGuard + OnboardOperatorGuard |
| **Total operator** | **23** | — |

---

## 5. Implemented Modules

| Module | Location | Key Files |
|--------|----------|-----------|
| Frontend app | `apps/onboard/` | 9 route segments, auth context, API client, components |
| Backend module | `apps/backend/src/modules/onboard/` | controller (23 endpoints), service (2,600+ lines) |
| Agent API | `agent/` | 7 endpoints, AgentTokenGuard, DTOs |
| Approval workflow | `onboard.service.ts` | 6 endpoints, status transitions, approval_events |
| KB sync | `onboard.service.ts` | dry-run + 5 apply scopes, snapshot hash, feature flag |
| GHL | `onboard.service.ts` | validate + dry-run, local-only, no GHL API calls |
| Guards | `guards/` | onboard-operator.guard.ts, agent-token.guard.ts |
| KB mapper | `kb-sync/` | Pure mapper, 19 tests |
| Fixtures | `__fixtures__/` | 4 fixture files (client, agent, KB, GHL) |
| Database | `prisma/` | 15 Onboard models, 24 enums, 1 migration |

---

## 6. KB Apply Scopes

| Scope | Tenant | Bot Profile | FAQ | Booking | Handover | Follow-Up |
|-------|--------|-------------|-----|---------|----------|-----------|
| TENANT_IDENTITY_ONLY | Creates | — | — | — | — | — |
| BOT_PROFILE_PROMPT_ONLY | Requires | Creates (inactive) | — | — | — | — |
| FAQ_KNOWLEDGE_ONLY | Requires | — | Creates/updates | — | — | — |
| BOOKING_HANDOVER_ONLY | Requires | — | — | Upserts (disabled) | Upserts (disabled) | — |
| FOLLOW_UP_SETTINGS_ONLY | Requires | — | — | — | — | Upserts (disabled) |

All scopes require: project APPROVED, DRY_RUN_PASSED syncRunId, matching snapshot hash, confirmApply, idempotencyKey, ONBOARD_KB_SYNC_ENABLED=true.

Safety defaults across all scopes: bot inactive, booking/handover/follow-up disabled, no messages, no GHL, no outbound.

---

## 7. GHL Status

- GHL validation: local checks only (identity map, tenant_ghl_connections), no GHL API calls
- GHL dry-run: proposed operations only, all marked `disabledForNow: true`, `noWrite: true`
- GHL apply: **not implemented**
- Sync runs and audit events recorded for both validate and dry-run

---

## 8. Env Status — Missing Until Wyn Fills Manually

| File | Required Vars |
|------|--------------|
| `apps/backend/.env` | DATABASE_URL, SUPABASE_URL, SUPABASE_ANON_KEY, SUPABASE_SERVICE_ROLE_KEY, JWT_SECRET, ENCRYPTION_KEY, ONBOARD_AGENT_API_TOKEN, REDIS_HOST, REDIS_PORT |
| `apps/onboard/.env.local` | NEXT_PUBLIC_SUPABASE_URL, NEXT_PUBLIC_SUPABASE_ANON_KEY |

Setup guide: `docs/aisbp-onboard/local-staging-env-setup-2026-06-27.md`

---

## 9. Do-Not-Touch List

- No secrets, no real env files, no real Supabase keys
- No migrations (`prisma db push` / `prisma migrate deploy`)
- No backend/frontend startup
- No Redis
- No GHL API calls
- No WhatsApp/SMS/email
- No outbound, no bot activation
- `AISBP_OUTBOUND_THROUGH_KB_ENABLED` must remain `false`

---

## 10. Key Doc Files

| Doc | Purpose |
|-----|---------|
| `compact-handoff-summary-2026-06-27.md` | This file |
| `controlled-pilot-runbook-2026-06-27.md` | 60+ step manual test workflow |
| `environment-safety-verification-2026-06-27.md` | What must be true before starting |
| `final-e2e-safety-review-2026-06-27.md` | 13-area final review |
| `local-staging-env-setup-2026-06-27.md` | Step-by-step env setup |
| `no-env-pilot-test-fixtures-2026-06-27.md` | Fixture reference + no-env checklist |
| `kb-sync-integrity-review-2026-06-27.md` | KB sync boundaries verified |
| `kb-target-mapping-2026-06-27.md` | Onboard → KB field mapping |

---

## 11. Test Status

| Check | Result |
|-------|--------|
| Backend typecheck | Pass |
| Frontend typecheck | Pass |
| Backend tests (Jest) | 147 suites, 1134 tests |
| Mapper tests | 19/19 |
| Frontend lint | 0 warnings |
| Frontend build | 9 routes |
| Prisma validate | Pass |
