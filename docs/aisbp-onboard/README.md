# AISBP-Onboard — Production Documentation Pack

> **Status**: Documentation only. App not built yet.
> **Baseline**: KB Production v1.1 — Operator-Readable Ops Dashboard + Controlled Pilot Runbook

---

## Purpose

This documentation pack defines the complete builder-grade specification for **AISBP-Onboard**, the onboarding control app for AI Sales Bot Pro. It is detailed enough for a coding agent to build safely in phases, without guessing about architecture, data models, API contracts, security rules, or deployment procedures.

## AISBP-Onboard Vision

AISBP-Onboard is the **staging, approval, audit, and sync-control layer** between the WhatsApp AI onboarding agent and the KB/GHL production systems.

```
AI Agent → AISBP-Onboard Draft → Wyn Review → Approved Sync → KB/GHL
```

**Core safety rule**: AI agents draft. Wyn approves. Onboard syncs. No direct AI-agent writes to KB or GHL.

## Warning

- This is a **documentation-only** deliverable. The app is not built yet.
- No app code, routes, endpoints, migrations, or env files were created or modified.
- No production behavior was changed.
- No live tests, messages, or deployments were performed.

## Recommended Reading Order

| Order | File | Purpose |
|-------|------|---------|
| 1 | [01-prd-and-spec.md](./01-prd-and-spec.md) | Product vision, scope, user roles, why this exists |
| 2 | [02-technical-design.md](./02-technical-design.md) | Architecture, build phases, safety model |
| 3 | [03-existing-codebase-map.md](./03-existing-codebase-map.md) | Current repo structure, what to reuse |
| 4 | [04-dependencies-and-config-files.md](./04-dependencies-and-config-files.md) | Dependencies, env patterns, toolchain |
| 5 | [05-database-schema-and-mock-json.md](./05-database-schema-and-mock-json.md) | Schema, enums, mock data |
| 6 | [06-coder-handoff-current-status.md](./06-coder-handoff-current-status.md) | Where things stand, what to build next |
| 7 | [07-api-contract.md](./07-api-contract.md) | Full API spec for agent, operator, KB, GHL |
| 8 | [08-env-var-checklist.md](./08-env-var-checklist.md) | All env vars, secrets, safe defaults |
| 9 | [09-security-and-auth-rules.md](./09-security-and-auth-rules.md) | Threat model, permissions, audit rules |
| 10 | [10-user-flow-map.md](./10-user-flow-map.md) | Step-by-step flows and status transitions |
| 11 | [11-ui-ux-design-guide.md](./11-ui-ux-design-guide.md) | Pages, components, display rules |
| 12 | [12-qa-testing-checklist.md](./12-qa-testing-checklist.md) | Test coverage across all layers |
| 13 | [13-known-bugs-limitations.md](./13-known-bugs-limitations.md) | Current limitations, deferred decisions |
| 14 | [14-definition-of-done.md](./14-definition-of-done.md) | MVP DoD, phase gates |
| 15 | [15-deployment-guide.md](./15-deployment-guide.md) | Deploy, smoke test, rollback |

## Recommended Build PR Roadmap

| PR | Name | Scope |
|----|------|-------|
| PR 1 | **God Mode Docs Pack** | Create all docs only (this PR) |
| PR 2 | **Onboard App Foundation** | App scaffold, auth guard placeholder, layout shell, dashboard shell, navigation. No DB tables, no Prisma, no migrations, no Agent API, no KB/GHL sync. |
| PR 3 | **Database Schema** | Onboard tables, Prisma schema, migrations. |
| PR 4 | **Manual Client Setup UI** | Fillable project/client forms |
| PR 5 | **Review/Approval Workflow** | Section approvals, request changes, final approval |
| PR 6 | **Agent Intake API** | WhatsApp agent creates sessions, submits draft answers |
| PR 7 | **AI Analysis & Recommendations** | Store workflow analysis and recommendations |
| PR 8 | **KB Sync Dry Run** | Generate KB sync payload and preview changes |
| PR 9 | **KB Approved Sync Apply** | Sync approved config to KB |
| PR 10 | **GHL Validation/Dry Run** | Validate GHL setup and generate sync plan |
| PR 11 | **Wyn Notification** | Notify Wyn when ready for review |
| PR 12 | **Controlled Pilot End-to-End** | Run one full controlled client onboarding |

## Project Location

AISBP-Onboard lives at `apps/onboard/` inside the existing KB monorepo (`~/Projects/KB/kb-explore/`). It is an isolated Next.js app that calls the KB backend's Onboard module via HTTP API. It shares the same Supabase project for auth.

| Connection | Details |
|------------|---------|
| KB Backend | `apps/backend/src/modules/onboard/` (new NestJS module) |
| KB Frontend | `apps/frontend/` (existing, do not modify) |
| Supabase | Same project as KB (new `onboard_*` tables) |
| Database | Same Postgres — frontend never writes to DB directly |

## Current KB Production Baseline

| Item | Value |
|------|-------|
| Production label | KB Production v1.1 |
| App URL | `https://kb.aisalesbot.pro` |
| Ops dashboard | `https://kb.aisalesbot.pro/app/agency/ops` |
| `AISBP_OUTBOUND_THROUGH_KB_ENABLED` | `false` |
| Controlled pilot | Active, 1-2 tenants only |
| Production safety | All runtime guards active (idempotency, stale, ordering, caps) |

## Core Safety Rule

> **AI agents draft, Wyn approves, Onboard syncs. No direct AI-agent writes to KB or GHL.**

## Next Recommended PR After Docs

Create the Onboard App Foundation scaffold inside the existing monorepo at `apps/onboard/` — an isolated Next.js app with auth guard, layout shell, and dashboard shell. No DB, no migrations, no API yet.
