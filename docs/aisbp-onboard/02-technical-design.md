# AISBP-Onboard — Technical Design Document

## 1. Recommended Architecture

### Decision: New `apps/onboard/` inside the existing KB monorepo

AISBP-Onboard is created as an **isolated Next.js app** at `apps/onboard/` within the existing `aisbp` monorepo. It does not import KB packages directly. It calls the KB backend module `apps/backend/src/modules/onboard/` via HTTP API.

```
aisbp/                          # KB monorepo (pnpm workspace + turbo)
├── apps/
│   ├── backend/                # KB NestJS API
│   │   └── src/
│   │       └── modules/
│   │           └── onboard/    # NEW: Onboard API module
│   ├── frontend/               # KB Next.js dashboard (DO NOT MODIFY)
│   └── onboard/                # NEW: AISBP-Onboard Next.js app
│       ├── src/
│       │   ├── app/           # Next.js App Router pages
│       │   ├── components/    # Onboard-specific components
│       │   └── lib/           # API client (calls backend via HTTP)
│       ├── package.json
│       ├── .env.example
│       └── tsconfig.json
├── packages/                   # Shared packages (types, db, etc.)
├── docs/
│   └── aisbp-onboard/         # This documentation pack
└── pnpm-workspace.yaml
```

### Data flow

```
┌──────────────────────────────────────────────────────────────────┐
│                                                                  │
│  apps/onboard/ (Next.js frontend)                                │
│       │                                                          │
│       │ HTTP calls (same-origin /api/v1/onboard/*)               │
│       ▼                                                          │
│  apps/backend/src/modules/onboard/ (NestJS API module)           │
│       │                                                          │
│       │ Prisma via @aisbp/db (workspace import)                  │
│       ▼                                                          │
│  Supabase Postgres (same DB, new onboard_* tables only)          │
│                                                                  │
└──────────────────────────────────────────────────────────────────┘
```

**Key rules**:
- **Frontend never writes to DB directly** — all writes go through backend API
- **Frontend never imports `@aisbp/db`** — only the backend module uses Prisma
- **Backend Onboard module only writes to `onboard_*` tables** — never touches KB tables
- **KB/GHL sync only through approved sync endpoints** gated by feature flags

### Rejected alternative: Standalone repo at `~/Projects/onboard/`

Considered and rejected because:
- Cannot workspace-import shared packages (`@aisbp/db`, `@aisbp/types`)
- Would need separate DB connection management
- Harder to share auth (same Supabase project, different app origin)
- Extra deployment complexity (separate repo, separate CI)
- No benefit over `apps/onboard/` which already provides clean isolation

---

## 2. Frontend Architecture

### Stack

| Layer | Choice | Why |
|-------|--------|-----|
| Framework | Next.js 14+ App Router | Same as existing KB frontend |
| Language | TypeScript | Type safety |
| Styling | Tailwind CSS | Match existing AISBP dark SaaS style |
| State | React Context + SWR or React Query | Simple, proven |
| Auth | Supabase Auth (same project as KB) | Reuse existing auth, same JWT |
| Forms | React Hook Form + Zod | Validation at form and API level |
| Components | Custom, match existing AISBP patterns | Visual consistency with KB |
| API calls | HTTP to backend `/api/v1/onboard/*` | All DB access through backend only |

### Page Structure

```
/app (onboard)
├── layout.tsx              # Auth gate + app chrome
├── page.tsx                # Dashboard
├── clients/
│   ├── page.tsx            # Client list
│   └── [clientId]/
│       ├── page.tsx        # Client detail / project overview
│       └── settings/
│           └── page.tsx    # Client settings
├── projects/
│   ├── page.tsx            # Project list (all projects)
│   └── [projectId]/
│       ├── page.tsx        # Project detail (tabs)
│       ├── review/
│       │   └── page.tsx    # Review workflow
│       └── sync/
│           └── page.tsx    # Sync preview & control
├── review-queue/
│   └── page.tsx            # Projects awaiting review
├── sessions/
│   └── [sessionId]/
│       └── page.tsx        # Agent session detail
├── audit/
│   └── page.tsx            # Audit log
└── settings/
    └── page.tsx            # Integration settings
```

---

## 3. Backend Architecture

### Decision: Extend existing KB NestJS backend with new `onboard` module

AISBP-Onboard's API lives as a new module in the **existing KB NestJS backend** at `apps/backend/src/modules/onboard/`. This keeps all API auth, audit, and DB access centralized.

```
kb-explore/apps/backend/src/modules/onboard/
├── onboard.module.ts
├── onboard.controller.ts      # Operator API endpoints
├── onboard.service.ts
├── agent/
│   ├── agent.module.ts
│   ├── agent.controller.ts    # Agent API endpoints
│   └── agent.service.ts
├── sync/
│   ├── sync.module.ts
│   ├── sync.controller.ts     # Sync API endpoints
│   └── sync.service.ts
├── dto/                       # Request/response DTOs
├── guards/                    # Role/permission guards
└── specs/                     # Test specs
```

**The Onboard frontend at `apps/onboard/` calls these API endpoints via HTTP — same as any API client.**

**Rationale for API-in-KB-backend**:
- Reuses existing auth guards (JWT from Supabase)
- Reuses existing Supabase client and Prisma
- Reuses existing audit and metrics infrastructure
- Reuses existing Swagger documentation
- Single DB connection pool for Onboard tables
- No new backend server to deploy or maintain

---

## 4. Database Architecture

### Approach: New tables in the same Supabase Postgres as KB

All Onboard tables live in the same Supabase Postgres database that KB uses (same connection string, same project). They use a distinct prefix (`onboard_`) to avoid collision with KB tables. Onboard has its own Prisma schema and migrations.

```
Supabase Postgres
├── KB tables (tenants, conversations, outbound_sends, ...)
├── onboard_clients
├── onboarding_projects
├── onboarding_identity_map
├── business_profiles
├── sales_process_maps
├── faq_items
├── prompt_configs
├── handover_rules
├── follow_up_rules
├── automation_recommendations
├── agent_interview_sessions
├── agent_interview_answers
├── approval_events
├── sync_runs
└── audit_events
```

Full schema in [05-database-schema-and-mock-json.md](./05-database-schema-and-mock-json.md).

---

## 5. API Architecture

### Agent API (for WhatsApp AI agent)

```
POST   /api/v1/onboard/agent/sessions
GET    /api/v1/onboard/agent/sessions/:sessionId
POST   /api/v1/onboard/agent/sessions/:sessionId/answers
POST   /api/v1/onboard/agent/projects/:projectId/analysis
GET    /api/v1/onboard/agent/projects/:projectId/missing-fields
POST   /api/v1/onboard/agent/projects/:projectId/request-review
GET    /api/v1/onboard/agent/projects/:projectId/status
```

### Operator API (for Wyn)

```
GET    /api/v1/onboard/projects
POST   /api/v1/onboard/projects
GET    /api/v1/onboard/projects/:projectId
PATCH  /api/v1/onboard/projects/:projectId
PATCH  /api/v1/onboard/projects/:projectId/sections/:sectionName
POST   /api/v1/onboard/projects/:projectId/sections/:sectionName/approve
POST   /api/v1/onboard/projects/:projectId/request-changes
POST   /api/v1/onboard/projects/:projectId/reject
POST   /api/v1/onboard/projects/:projectId/approve
GET    /api/v1/onboard/projects/:projectId/audit
GET    /api/v1/onboard/projects/:projectId/sync-runs
```

### Integration API (KB sync)

```
POST   /api/v1/integrations/onboard/tenants/dry-run
POST   /api/v1/integrations/onboard/tenants/sync
GET    /api/v1/integrations/onboard/sync-runs/:syncRunId
GET    /api/v1/integrations/onboard/tenants/by-location/:ghlLocationId
```

### GHL Integration API

```
POST   /api/v1/onboard/projects/:projectId/sync/ghl/validate
POST   /api/v1/onboard/projects/:projectId/sync/ghl/dry-run
POST   /api/v1/onboard/projects/:projectId/sync/ghl/apply
```

Full contract in [07-api-contract.md](./07-api-contract.md).

---

## 6. Sync Worker Architecture

```
┌─────────────────────────────────────────────────────────────┐
│                     SYNC WORKER FLOW                        │
│                                                             │
│  1. Wyn triggers sync (via Operator API)                    │
│          ↓                                                  │
│  2. Onboard validates project status = approved             │
│          ↓                                                  │
│  3. Onboard generates sync payload from approved config     │
│          ↓                                                  │
│  4. Dry-run: POST to KB/GHL with previewOnly flag           │
│          ↓                                                  │
│  5. Response stored as sync_run with mode=dry_run           │
│          ↓                                                  │
│  6. Wyn reviews dry-run results                             │
│          ↓                                                  │
│  7. Wyn confirms apply (via Operator API)                   │
│          ↓                                                  │
│  8. Onboard generates idempotency key                       │
│          ↓                                                  │
│  9. Apply: POST to KB/GHL with idempotency key              │
│          ↓                                                  │
│ 10. Response stored as sync_run with mode=apply             │
│          ↓                                                  │
│ 11. Audit event written                                     │
│          ↓                                                  │
│ 12. Identity map updated (onboardClientId → kbTenantId)     │
└─────────────────────────────────────────────────────────────┘
```

**Key design decisions**:

- **Sync is synchronous** (not queued) for MVP — Wyn waits for result
- **Idempotency keys** prevent duplicate syncs (same project + same mode = same key)
- **Dry-run first, apply second** — never apply without preview
- **All syncs are audited** with full payload storage
- **Sync worker is the `service` actor** — not the AI agent, not Wyn

---

## 7. Idempotency Architecture

```
syncRunId = SHA256(projectId + targetSystem + mode + version)

If syncRunId already exists with status=completed:
    Return 409 Conflict with existing syncRunId

If syncRunId already exists with status=failed:
    Allow retry (create new syncRun with incremented version)
```

**Idempotency keys are generated server-side**, not provided by the caller. This prevents:
- Accidental duplicate syncs
- Replay attacks
- Race conditions from parallel sync triggers

---

## 8. Status Lifecycle

### Project Status

```
DRAFT → SUBMITTED → IN_REVIEW → CHANGES_REQUESTED → APPROVED → SYNCING → LIVE
  ↑                       ↑              │                             │
  └───────────────────────┴──────────────┘                             │
                (Wyn requests changes, agent resubmits)                │
                                                                       │
  Any state → PAUSED (Wyn pauses)                                      │
  Any state → ARCHIVED (Wyn archives old project)                      │
```

### Section Status

```
EMPTY → PARTIAL → COMPLETE → APPROVED
                 ↓
            REJECTED → PARTIAL (after changes)
```

### Sync Run Status

```
PENDING → DRY_RUN_PASSED → APPLIED → COMPLETED
       → DRY_RUN_FAILED
       → APPLY_FAILED
       → ROLLED_BACK
```

---

## 9. Approval Lifecycle

```
1. Section submitted by agent → status = COMPLETE
2. Wyn reviews section → approve or request changes
3. If changes requested → section status = PARTIAL → agent resubmits
4. When ALL sections approved → project can be approved
5. Wyn approves project → project status = APPROVED
6. Only APPROVED projects can trigger sync
```

**Approval is gated at two levels**:
- **Section level**: Each section (business profile, FAQ, prompts, etc.) must be approved
- **Project level**: All sections must be approved before sync

---

## 10. Error Handling

| Scenario | Handling |
|----------|----------|
| Agent submits invalid payload | 400 with validation errors |
| Agent tries to approve/sync | 403 forbidden |
| Duplicate idempotency key | 409 with existing syncRunId |
| KB API unreachable | 502 with retry-after, sync_run status = failed |
| GHL API unreachable | 502 with retry-after, sync_run status = failed |
| Sync payload validation fails | 400 with specific field errors |
| Project not in approved state | 409 with current status |
| Auth token missing/invalid | 401 |
| Rate limit exceeded | 429 with retry-after |

---

## 11. Rollback / Pause Strategy

### Pause a project
- Wyn sets project status to `PAUSED`
- All sync operations rejected for paused projects
- Agent can still submit answers (drafts)

### Rollback a sync (MVP: manual only)
- Wyn reviews sync run audit log to identify what was applied
- Wyn manually reverts KB/GHL changes using captured sync snapshots and audit data
- Sync run record captures rollback event
- **Automated reverse sync is future/non-MVP** — requires sync snapshot storage and verified reversal logic (deferred)

### Emergency stop
- Feature flag `ONBOARD_KB_SYNC_ENABLED=false` stops all KB syncs
- Feature flag `ONBOARD_GHL_SYNC_ENABLED=false` stops all GHL syncs
- Existing projects not affected, only sync operations blocked

---

## 12. Observability

| Layer | Approach |
|-------|----------|
| Logging | Structured JSON logs, same pattern as existing NestJS backend |
| Audit | Every write operation creates an audit_event row |
| Metrics | Reuse existing `MetricsService` for fire-and-forget events |
| Health | Basic health endpoint returning DB and queue status |
| Errors | All errors logged with projectId, actorId, correlationId |

---

## 13. Privacy Model

| Rule | Implementation |
|------|---------------|
| Phone numbers masked by default | `phoneMask()` utility — show `+65****8634` |
| No full phone display | Unless user explicitly clicks "show" |
| No secrets in responses | API responses never include API keys, tokens |
| PII in audit | Audit events may reference IDs but never full PII |
| No secrets in logs | Log sanitization before write |
| DB encryption | GHL tokens encrypted at rest (reuse existing encryption) |

---

## 14. Failure Scenarios

| Scenario | Impact | Mitigation |
|----------|--------|------------|
| AI agent submits wrong pricing | Wrong pricing in KB | Caught during Wyn review |
| KB sync creates duplicate tenant | Two tenants for same client | Idempotency key prevents |
| GHL sync overwrites manual config | Lost manual changes | Dry-run previews changes first |
| Network failure mid-sync | Partial configuration | Transaction rollback + retry |
| Wyn accidentally approves bad config | Wrong config in production | Rollback via sync_run reversal |

---

## 15. Recommended Build Path

### Phase 1: Foundation (PR 2-4)
1. App scaffold + auth guard + layout
2. Database schema + migrations
3. Manual client setup UI (forms)

### Phase 2: Agent Intake (PR 5-6)
4. Agent API (sessions, answers)
5. Review/approval workflow

### Phase 3: AI Analysis (PR 7)
6. Workflow analysis storage
7. Automation recommendations storage

### Phase 4: KB Sync (PR 8-9)
8. KB sync dry-run
9. KB sync apply

### Phase 5: GHL + Notifications (PR 10-11)
10. GHL validation + dry-run
11. Wyn notifications

### Phase 6: Pilot (PR 12)
12. End-to-end controlled pilot
