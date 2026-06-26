# AISBP-Onboard — Coder Handoff / Current Status

> **For the next coding agent picking up this work.**

---

## 1. Current KB Production State

| Item | Value |
|------|-------|
| Production label | KB Production v1.1 — Operator-Readable Ops Dashboard + Controlled Pilot Runbook |
| App URL | `https://kb.aisalesbot.pro` |
| Ops dashboard | `https://kb.aisalesbot.pro/app/agency/ops` |
| VPS | `<PRODUCTION_SERVER>` |
| Latest commit | `d9dbbf1` |
| Stable rollback tag | `stable-single-brain-tested-2026-06-26` |
| Runtime flags | All 6 production safety flags active |
| `AISBP_OUTBOUND_THROUGH_KB_ENABLED` | `false` (must stay false) |
| Supabase | Hosted, production project |
| Redis | Up 2 months, production |

KB is stable. The ops dashboard is readable. The controlled pilot runbook works. Do not break anything.

---

## 2. Current Repo Status

| Item | Status |
|------|--------|
| Monorepo | `aisbp` — pnpm workspace, turbo |
| Backend | NestJS 10, 39 modules, 1115 passing tests |
| Frontend | Next.js 14 App Router, ~50 route segments, Vitest + Playwright |
| Database | Supabase Postgres, Prisma ORM, 25 migrations |
| Queue | BullMQ via Redis, 10 processors |
| Auth | Supabase Auth with JWT verification |
| Docs | 11 docs files in `docs/` |

---

## 3. What Already Exists (Before This Pack)

- KB production app — stable, running, monitored
- Ops dashboard — all 10 tabs, read APIs, metrics, audit
- Pilot onboarding checklist — manual workflow for Wyn
- Client setup template — paper-template for manual setup
- Production smoke test docs — GHL → AISBP → GHL loop
- Design system — `docs/AISBP_DESIGN_SYSTEM.md`
- Full API client — `apps/frontend/src/lib/api.ts` (2395 lines)
- Auth context — `apps/frontend/src/contexts/AuthContext.tsx`
- Audit + metrics infrastructure — `AuditService`, `MetricsService`
- Component patterns — gates, chrome, shell/content, confirm, toast

---

## 4. What This Documentation Pack Created

16 files under `docs/aisbp-onboard/`:

1. `README.md` — Index, reading order, build roadmap
2. `01-prd-and-spec.md` — Product vision, scope, roles
3. `02-technical-design.md` — Architecture, sync worker, status lifecycles
4. `03-existing-codebase-map.md` — Full repo map, what to reuse
5. `04-dependencies-and-config-files.md` — Deps review, env patterns
6. `05-database-schema-and-mock-json.md` — 15 tables, enums, mock JSON
7. `06-coder-handoff-current-status.md` — This file
8. `07-api-contract.md` — Full API spec
9. `08-env-var-checklist.md` — All env vars
10. `09-security-and-auth-rules.md` — Threat model, permissions
11. `10-user-flow-map.md` — Step-by-step flows
12. `11-ui-ux-design-guide.md` — Pages, components, display rules
13. `12-qa-testing-checklist.md` — Test coverage
14. `13-known-bugs-limitations.md` — Current limitations
15. `14-definition-of-done.md` — MVP DoD, phase gates
16. `15-deployment-guide.md` — Deploy, smoke test, rollback

---

## 5. What is NOT Built Yet

- [ ] Onboard frontend app at `apps/onboard/` (not yet scaffolded)
- [ ] Onboard database tables (not in Supabase yet)
- [ ] Backend `modules/onboard/` in KB (no NestJS module yet)
- [ ] Agent API endpoints (no routes)
- [ ] Operator UI pages (no frontend code)
- [ ] KB sync integration (no sync logic)
- [ ] GHL sync integration (no sync logic)
- [ ] WhatsApp notification (no notification logic)
- [ ] Approval workflow (no workflow logic)

---

## 6. What Must NOT Be Touched

| Area | Rule |
|------|------|
| KB runtime flags | `AISBP_*`, `GHL_*` — never change without approval |
| KB production module | `modules/kb/` in kb-explore — read-only reference |
| GHL production module | `modules/ghl/` in kb-explore — read-only reference |
| KB auth guards | Reuse pattern, don't modify |
| Supabase production | Don't modify existing KB tables, only add new Onboard tables |
| KB API client | Don't modify `apps/frontend/src/lib/api.ts` |
| Production env files | Don't modify `.env` files in KB repo |
| `AISBP_OUTBOUND_THROUGH_KB_ENABLED` | Must stay `false` |

---

## 7. Exact Safe Next PR

### PR 2: Onboard App Foundation

**Goal**: Scaffold the Onboard Next.js app at `apps/onboard/` with auth guard placeholder, layout shell, dashboard shell, and basic navigation. **No DB, no Prisma, no migrations, no Agent API, no KB/GHL sync.**

**Files to create**:
- `apps/onboard/package.json` — Next.js app package
- `apps/onboard/.env.example` — Environment template
- `apps/onboard/tsconfig.json` — TypeScript config
- `apps/onboard/next.config.js` — Next.js config
- `apps/onboard/vitest.config.ts` — Test config
- `apps/onboard/src/app/layout.tsx` — Root layout with auth provider placeholder
- `apps/onboard/src/app/page.tsx` — Dashboard shell
- `apps/onboard/src/lib/api.ts` — API client (follow KB pattern, calls `/api/v1/onboard/*`)
- `apps/onboard/src/lib/supabase.ts` — Supabase client init (same project as KB)
- `apps/onboard/src/contexts/AuthContext.tsx` — Auth context (follow KB pattern)
- `turbo.json` — Add `onboard` build/dev tasks

**Verification**:
- `pnpm install` succeeds
- `turbo dev` (or `pnpm --filter @aisbp/onboard dev`) starts
- Dashboard renders at configured port
- Auth gate placeholder redirects unauthenticated users
- No PrismaClient, no DB connections, no migrations

---

## 8. Recommended Build Order

| PR | Name | Depends On | Risk |
|----|------|------------|------|
| PR 2 | Onboard App Foundation | PR 1 (docs) | Low |
| PR 3 | Database Schema | PR 2 | Low |
| PR 4 | Manual Client Setup UI | PR 3 | Low |
| PR 5 | Review/Approval Workflow | PR 4 | Low |
| PR 6 | Agent Intake API | PR 3 | Low |
| PR 7 | AI Analysis Storage | PR 6 | Low |
| PR 8 | KB Sync Dry Run | PR 5, PR 7 | Medium |
| PR 9 | KB Approved Sync Apply | PR 8 | Medium |
| PR 10 | GHL Validation/Dry Run | PR 5, PR 7 | Medium |
| PR 11 | Wyn Notification | PR 5 | Low |
| PR 12 | Controlled Pilot End-to-End | PR 9, PR 10 | Medium |

---

## 9. Assumptions

1. Onboard connects to the same Supabase project as KB (same Auth, same DB)
2. DB access is through the backend Onboard module only — frontend never writes to DB directly
3. Wyn uses the same Supabase login as existing KB
4. KB backend gets a new `onboard` NestJS module for the API endpoints (PR 3+)
5. The WhatsApp AI agent is a separate system that calls Onboard's Agent API
6. The API contracts are proposed target contracts. Actual KB/GHL sync endpoints are deferred to PR 8-10 and must be validated during implementation.
7. GHL locations exist before onboarding (clients have GHL accounts)
8. `AISBP_OUTBOUND_THROUGH_KB_ENABLED` remains `false`

---

## 10. Open Questions

| Question | Status | Impact |
|----------|--------|--------|
| Exact KB sync API endpoint | To confirm during PR 8 | Low — placeholder contract exists |
| Exact GHL write scope for Onboard | To confirm during PR 10 | Low — dry-run first, apply later |
| Notification channel (WhatsApp, email, in-app) | Deferred to PR 11 | Low — in-app review works without notifications |
| Auth role for Wyn (agency_owner, agency_operator, admin) | Use existing role system | Low |
| Deployment target for Onboard | Same VPS as KB, separate container | Low |
| Deployment target for Onboard | Same VPS as KB initially | Low |

---

## 11. Known Risks

| Risk | Likelihood | Mitigation |
|------|-----------|------------|
| KB API not designed for external sync | Low | Contract in this pack; adapt during PR 8 |
| GHL API rate limits during sync | Medium | Dry-run validates before applying |
| AI agent submits wrong data | High | Wyn review gate catches it |
| Accidental KB table modifications | Low | New tables only, never modify existing |
| Onboard deployment affects KB uptime | Low | Separate container, separate routes |
| Auth token scope confusion | Medium | Clear role/permission matrix in spec |

---

## 12. Production Safety Rules (Always)

1. **Never disable runtime flags** — `AISBP_OUTBOUND_IDEMPOTENCY_ENABLED`, `AISBP_STALE_SEND_CHECK_ENABLED`, `AISBP_CONV_ORDERING_ENABLED`, `AISBP_TENANT_CAPS_ENABLED`, `GHL_PRE_REPLY_CONTEXT_SYNC` must stay `true`
2. **`AISBP_OUTBOUND_THROUGH_KB_ENABLED` must stay `false`**
3. **Never commit secrets** — API keys, tokens, passwords, webhook secrets
4. **Never run live tests** — No production WhatsApp/GHL messages without approval
5. **Never deploy without staging verification**
6. **Never skip the dry-run step** before any sync apply
7. **Never allow agent approval or sync** — code-level enforcement

---

## 13. Rollback Mindset

Every PR should be independently revertable:
- New tables → migration can be rolled back
- New API endpoints → can be disabled via feature flag
- New UI pages → can be hidden via route guard
- Sync operations → idempotency prevents duplicates on retry

---

## 14. Current Runtime Flags to Preserve

```
AISBP_OUTBOUND_IDEMPOTENCY_ENABLED=true
AISBP_STALE_SEND_CHECK_ENABLED=true
AISBP_CONV_ORDERING_ENABLED=true
AISBP_TENANT_CAPS_ENABLED=true
GHL_PRE_REPLY_CONTEXT_SYNC=true
AISBP_OUTBOUND_THROUGH_KB_ENABLED=false
```

**Do not disable any of these. Do not change `AISBP_OUTBOUND_THROUGH_KB_ENABLED`.**

---

## 15. Quick Start for New Coding Agent

1. Read this file
2. Read `docs/aisbp-onboard/README.md` for reading order
3. Read `docs/aisbp-onboard/01-prd-and-spec.md` for product vision
4. Read `docs/aisbp-onboard/02-technical-design.md` for architecture
5. Read `docs/aisbp-onboard/03-existing-codebase-map.md` for repo layout
6. Start with PR 2: Onboard App Foundation
