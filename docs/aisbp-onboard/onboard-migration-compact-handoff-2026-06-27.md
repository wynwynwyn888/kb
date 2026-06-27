# AISBP-Onboard — Migration Compact Handoff — 2026-06-27

> **Extracted from**: `/Users/wyn/Projects/KB/kb-explore/` (KB monorepo)
> **Extracted to**: `/Users/wyn/Projects/onboard/` (mirrored structure)
> **Backend still depends on KB monorepo** for runtime. This is a mirrored copy.

## 1. What AISBP-Onboard Is

AISBP-Onboard is the onboarding control app for AI Sales Bot Pro (KB). It provides:
- Agent intake API (WhatsApp AI agent submits draft client info)
- Operator review/approval workflow
- Scoped KB sync (5 phases: tenant, bot profile, FAQ, booking/handover, follow-up)
- GHL validation/dry-run (no-write)
- In-app Wyn review alerts

## 2. Core Architecture

```
AI Agent → AISBP-Onboard Draft → Wyn Review → Approved Sync → KB/GHL
```

## 3. Current Source Locations (KB Monorepo)

| Component | Path |
|-----------|------|
| Frontend app | `apps/onboard/` |
| Backend module | `apps/backend/src/modules/onboard/` |
| Prisma schema | `apps/backend/prisma/schema.prisma` (Onboard models) |
| Migration | `apps/backend/prisma/migrations/20260626150000_add_onboard_tables/` |
| Docs | `docs/aisbp-onboard/` |
| Fixtures | `apps/backend/src/modules/onboard/__fixtures__/` |
| Env examples | `apps/backend/.env.example`, `apps/onboard/.env.example` |

## 4. Target Folder

`/Users/wyn/Projects/onboard/`

## 5. Completed PR/Build Status

PRs 1–17L complete. All no-env-safe work done.
- 149 test suites, 1173 tests
- 9 frontend routes compiled
- 30 API endpoints
- 31 documentation files
- 15 database tables (migration ready, not applied)

## 6. Safety Boundaries

- Agent drafts only. Cannot approve, sync, or call KB/GHL.
- Operator controls approval and sync. Requires JwtAuthGuard + OnboardOperatorGuard.
- Bot profile inactive. Booking/handover/follow-up disabled.
- No GHL apply. GHL validation is local/no-write.
- No outbound. No messages. AISBP_OUTBOUND_THROUGH_KB_ENABLED remains false.

## 7. Env Status

- `.env.example` files exist with placeholders
- Real `.env` files created but NOT committed (gitignored)
- Wyn must fill Supabase keys + generated secrets before runtime

## 8. What Must NOT Be Moved/Committed

- Real `.env` files (gitignored)
- `node_modules/`, `.next/`, `dist/`, `build/`
- Production credentials, secrets, tokens
- KB runtime data unrelated to Onboard

## 9. What Must Be Verified After Migration

- All source files present in target
- No secrets in committed files
- `.gitignore` covers env files
- Docs are complete

## 10. Next Recommended Step

After migration verification:
- Wyn fills .env values in target
- Redis → migration → backend → frontend startup
- Execute PR 14 Controlled Pilot Runbook
