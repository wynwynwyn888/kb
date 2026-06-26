# AISBP-Onboard

Foundation shell for the AISBP-Onboard onboarding control app.

## Status

**Foundation shell only** — no live KB/GHL sync, no production writes.

- Auth: Placeholder (integration pending)
- Data: Static mock data only
- API: Not connected to backend
- DB: No Prisma, no migrations

## Quick Start

```bash
pnpm install
pnpm dev
```

Opens at `http://localhost:3002` (or configured `PORT`).

## Architecture

```
apps/onboard/ (this app)
    │
    │ HTTP calls (future)
    ▼
apps/backend/src/modules/onboard/ (future PR 3+)
    │
    │ Prisma
    ▼
Supabase Postgres (same project as KB)
```

## Pages

| Route | Page | Status |
|-------|------|--------|
| `/` | Dashboard | Shell with mock data |
| `/clients` | Client list | Shell with mock data |
| `/clients/[clientId]` | Client detail | Shell with mock data |
| `/review-queue` | Review queue | Shell with mock data |
| `/sessions/[sessionId]` | Agent session | Shell with mock data |
| `/sync` | Sync preview | Shell with mock data |
| `/audit` | Audit log | Shell with mock data |
| `/settings` | Settings/integrations | Shell with mock data |

## Safety Rule

AI agents draft. Wyn approves. Onboard syncs. No direct AI-agent writes to KB or GHL.
