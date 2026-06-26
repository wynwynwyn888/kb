# AISBP-Onboard — Existing Codebase Files & Folder Map

> **Onboard project**: `apps/onboard/` (inside KB monorepo, isolated Next.js app)
> **KB project**: `~/Projects/KB/kb-explore/` (pnpm workspaces, NestJS + Next.js + Supabase + BullMQ)
> **Connection**: Onboard frontend calls KB backend's `modules/onboard/` via HTTP API. Both share the same Supabase project for auth and database.

---

## 1. Root Folder Structure

```
kb-explore/
├── apps/
│   ├── backend/           # NestJS API + workers
│   └── frontend/          # Next.js 14 App Router dashboard
├── packages/
│   ├── ai-provider-openai/# AI provider adapter
│   ├── ai-router/         # ModelRouter, RoutingDecision
│   ├── db/                # PrismaClient singleton
│   ├── formatter/         # Message formatting utilities
│   ├── ghl-client/        # GHL API helpers
│   ├── tsconfig/          # Base tsconfig extended by all workspaces
│   └── types/             # Shared TypeScript types, DTOs, enums
├── docs/
│   ├── AISBP_DESIGN_SYSTEM.md
│   ├── AISBP_PRODUCTION_SMOKE_TEST.md
│   ├── CLIENT_PIPELINE_FOLLOW_UP_PROPOSAL.md
│   ├── VPS_DEPLOY.md
│   ├── reviews/           # 5 review documents
│   ├── runbooks/          # Pilot onboarding checklist
│   └── templates/         # Pilot client setup template
├── infra/
│   └── vps/               # Dockerfiles, compose, deploy scripts
├── scripts/               # redis-docker.mjs
├── openspec/              # OpenSpec changes
├── package.json           # Root monorepo config (pnpm + turbo)
├── pnpm-workspace.yaml    # Workspace config (apps/*, packages/*)
├── pnpm-lock.yaml
├── turbo.json
├── tsconfig.base.json
└── render.yaml            # Render deploy blueprint
```

---

## 2. Apps Directory

### `apps/backend/` — NestJS API

```
apps/backend/
├── .env.example                    # 150 lines of env template
├── jest.config.ts
├── nest-cli.json
├── package.json                    # @aisbp/backend
├── tsconfig.json
├── prisma/
│   ├── schema.prisma               # 1128 lines, 25+ models
│   ├── migrations/                 # 25 migrations
│   ├── rls/                        # RLS_PLAN.md
│   └── seed.ts
├── scripts/                        # 14 smoke/e2e scripts (*.mjs)
├── src/
│   ├── main.ts                     # Bootstrap: helmet, CORS, Swagger
│   ├── app.module.ts               # Root module, all feature modules
│   ├── load-env.ts                 # Custom .env loader
│   ├── lib/                        # 137 business logic files
│   │   ├── metrics.service.ts      # @Global MetricsService
│   │   ├── metrics.module.ts
│   │   ├── app-cache.service.ts
│   │   ├── supabase/               # Supabase client config
│   │   └── ...                     # Encryption, enums, helpers
│   ├── modules/                    # 39 feature modules
│   │   ├── auth/                   # Auth controller, service, guards
│   │   ├── audit/                  # AuditService, AuditLog model
│   │   ├── tenants/                # Tenant CRUD
│   │   ├── kb/                     # Knowledge base module
│   │   ├── ghl/                    # GHL integration
│   │   ├── ops/                    # Ops dashboard read APIs
│   │   ├── ...                     # 33 more modules
│   ├── queues/                     # BullMQ queue config + processors
│   │   ├── queues.module.ts
│   │   ├── queue.constants.ts
│   │   └── processors/             # 10 queue processors
│   ├── integration/                # Integration specs
│   ├── test/                       # Mock helpers
│   └── scripts/                    # E2E verification scripts
└── docs/
    └── live-path-supabase-insert-audit.md
```

### `apps/frontend/` — Next.js Dashboard

```
apps/frontend/
├── .env.example                    # 20 lines
├── .eslintrc.json
├── next.config.js
├── package.json                    # @aisbp/frontend
├── tsconfig.json
├── vitest.config.ts
├── playwright.config.ts
├── e2e/                            # Playwright specs (4 files)
├── public/                         # favicon, logos
├── scripts/                        # next-dev.mjs
└── src/
    ├── app/                        # Next.js App Router pages
    │   ├── layout.tsx              # RootLayout with AuthProvider
    │   ├── page.tsx                # HomePage auth gate
    │   ├── login/page.tsx
    │   ├── app/                    # Main app route (/app/...)
    │   │   ├── layout.tsx          # AppRouteChrome
    │   │   └── agency/ops/page.tsx # Ops dashboard
    │   └── api/v1/                 # BFF proxy to Nest
    ├── components/
    │   ├── NavBar.tsx
    │   ├── app/                    # 25+ components
    │   │   ├── AppRouteChrome.tsx
    │   │   ├── AppShell.tsx
    │   │   ├── AgencyOnlyGate.tsx
    │   │   ├── ConfirmDialog.tsx
    │   │   ├── TenantWorkspaceChrome.tsx
    │   │   ├── AgencyAuditLogTable.tsx
    │   │   └── ...
    │   └── ...
    ├── contexts/
    │   └── AuthContext.tsx          # Supabase auth state (240 lines)
    ├── hooks/
    │   └── use-media-query.ts
    └── lib/
        ├── api.ts                  # API client (2395 lines)
        ├── supabase.ts             # Supabase client init
        ├── server/
        │   └── proxy-to-nest.ts    # BFF proxy to Nest
        └── ...                     # 40+ utility modules
```

---

## 3. Packages Directory

| Package | Path | Purpose |
|---------|------|---------|
| `@aisbp/db` | `packages/db/` | PrismaClient singleton — **REUSE** |
| `@aisbp/types` | `packages/types/` | Shared types, DTOs, enums — **EXTEND** |
| `@aisbp/tsconfig` | `packages/tsconfig/` | Base tsconfig — **REUSE** |
| `@aisbp/formatter` | `packages/formatter/` | Message formatting — not needed for Onboard |
| `@aisbp/ghl-client` | `packages/ghl-client/` | GHL API helpers — **REUSE for GHL sync** |
| `@aisbp/ai-router` | `packages/ai-router/` | AI routing — not needed for Onboard |
| `@aisbp/ai-provider-openai` | `packages/ai-provider-openai/` | AI provider — not needed for Onboard |

---

## 4. Key Patterns to Reuse

### Auth Pattern

- **File**: `apps/backend/src/modules/auth/guards/jwt-auth.guard.ts`
- **Pattern**: Bearer token → Supabase JWT verification → `@CurrentUser()` decorator
- **Reuse for Onboard**: Same JWT guard, add role-based guards for `operator`/`agent`/`admin`

### Audit Pattern

- **File**: `apps/backend/src/modules/audit/audit.service.ts`
- **Pattern**: `AuditService.log()` fire-and-forget → Supabase insert
- **Reuse for Onboard**: Same audit infrastructure, extend for onboard-specific events

### Metrics Pattern

- **File**: `apps/backend/src/lib/metrics.service.ts`
- **Pattern**: `MetricsService.emit()` @Global, non-blocking
- **Reuse for Onboard**: Emit onboard metrics events

### Database Pattern

- **File**: `apps/backend/prisma/schema.prisma`
- **Pattern**: Prisma schema + migrations
- **Reuse for Onboard**: New models in same schema, new migrations

### Queue Pattern

- **File**: `apps/backend/src/queues/queues.module.ts`
- **Pattern**: BullMQ + Redis for async jobs
- **Reuse for Onboard**: Future sync jobs, not needed for MVP (sync is synchronous)

### API Client Pattern (REFERENCE from KB)

- **File**: `apps/frontend/src/lib/api.ts`
- **Pattern**: `apiRequest<T>()` wrapper with Bearer token, timeout, 401 handling
- **Reuse for Onboard**: Create `apps/onboard/src/lib/api.ts` following same pattern

### Env Pattern (REFERENCE from KB)

- **Files**: `apps/backend/.env.example`, `apps/frontend/.env.example`
- **Pattern**: `.env.example` with all vars documented, secrets marked
- **Reuse for Onboard**: Create `apps/onboard/.env.example` with Onboard-specific vars

### Component Patterns

- **Guards**: `AgencyOnlyGate.tsx`, `TenantWorkspaceGate.tsx`
- **Chrome**: `AppRouteChrome.tsx`, `AppShell.tsx`
- **Shell/Content**: `TenantSettingsShell.tsx` + `TenantSettingsGeneralContent.tsx`
- **Confirm**: `ConfirmDialog.tsx`
- **Toast**: `ToastProvider.tsx`

---

## 5. Docs Directory

```
docs/
├── AISBP_DESIGN_SYSTEM.md          # Visual style, components, copy
├── AISBP_PRODUCTION_SMOKE_TEST.md  # Smoke test procedure
├── CLIENT_PIPELINE_FOLLOW_UP_PROPOSAL.md
├── VPS_DEPLOY.md
├── reviews/
│   ├── kb-final-spec-compliance-review-2026-06-26.md
│   ├── kb-final-production-smoke-test-2026-06-26.md
│   ├── kb-spec-compliance-gap-review-2026-06-26.md
│   ├── contact-id-normalization-pr-notes-2026-06-26.md
│   └── follow-up-stale-job-cleanup-pr-notes-2026-06-26.md
├── runbooks/
│   └── kb-controlled-pilot-onboarding-checklist-2026-06-26.md
├── templates/
│   └── kb-pilot-client-setup-template.md
└── aisbp-onboard/                  # <-- THIS DOCUMENTATION PACK
    └── (16 files)
```

---

## 6. Infra / Scripts Directory

```
infra/vps/
├── Dockerfile                       # Backend Docker image
├── Dockerfile.frontend              # Frontend Docker image
├── docker-compose.yml               # Full stack compose
├── docker-compose.api-only.yml
├── docker-entrypoint.sh
├── Caddyfile.example                # Reverse proxy config
├── env.vps.example                  # VPS env template
├── .deploy.local.env.example
├── .github-secrets.local.env.example
├── HOSTINGER.md
├── README.md
└── scripts/
    ├── set-github-secrets.ps1
    ├── set-github-secrets.sh
    ├── smoke-ghl-webhook.ps1        # GHL webhook smoke test (PowerShell)
    └── smoke-ghl-webhook.sh         # GHL webhook smoke test (Bash)
```

---

## 7. Key Files Not to Touch

| File | Reason |
|------|--------|
| `apps/backend/prisma/schema.prisma` | ADD to, don't modify existing models |
| `apps/backend/src/modules/auth/` | Reuse, don't change auth behavior |
| `apps/backend/src/modules/kb/` | KB production module — read-only reference |
| `apps/backend/src/modules/ghl/` | GHL production module — read-only reference |
| `apps/backend/src/modules/audit/` | Reuse, don't break existing audit |
| `apps/backend/.env.example` | Don't modify — Onboard gets its own env |
| `apps/frontend/src/lib/api.ts` | Don't modify — Onboard gets its own api.ts |
| `turbo.json` | Add `onboard` tasks, don't break existing |
| `pnpm-workspace.yaml` | Already covers `apps/*` — no change needed |
| `package.json` (root) | Add onboard scripts if needed, don't break existing |
| Runtime flags (`AISBP_*`, `GHL_*`) | Never change without approval |

---

## 8. Where AISBP-Onboard Files Should Live

### `apps/onboard/` inside the KB monorepo (RECOMMENDED)

```
apps/onboard/
├── package.json
├── .env.example
├── tsconfig.json
├── next.config.js
├── vitest.config.ts
└── src/
    ├── app/                  # Next.js App Router pages
    ├── components/           # Onboard-specific components
    ├── lib/                  # API client (calls backend via HTTP)
    ├── contexts/             # Auth context
    └── hooks/                # Shared hooks
```

**Why monorepo**: Clean isolation within the same build system. No workspace imports from KB packages needed — frontend calls backend via HTTP. Backend module (`apps/backend/src/modules/onboard/`) handles all DB access.

### Rejected: Standalone repo at `~/Projects/onboard/`

Rejected because it cannot import shared packages, adds deployment complexity, and offers no benefit over `apps/onboard/`.

---

## 9. Backend — Where to Add Onboard Module (in KB repo)

```
kb-explore/apps/backend/src/modules/onboard/        # NEW
├── onboard.module.ts
├── onboard.controller.ts
├── onboard.service.ts
├── agent/
│   ├── agent.module.ts
│   ├── agent.controller.ts
│   └── agent.service.ts
├── sync/
│   ├── sync.module.ts
│   ├── sync.controller.ts
│   └── sync.service.ts
├── dto/
│   ├── create-session.dto.ts
│   ├── submit-answer.dto.ts
│   ├── approve-section.dto.ts
│   └── ...
├── guards/
│   ├── agent-token.guard.ts
│   └── operator.guard.ts
└── specs/
    └── ...
```

### Register in `app.module.ts`

```typescript
import { OnboardModule } from './modules/onboard/onboard.module';

@Module({
  imports: [
    // ... existing imports ...
    OnboardModule,
  ],
})
export class AppModule {}
```

---

## 10. Database — Additions to `schema.prisma`

New models to add (detailed in [05-database-schema-and-mock-json.md](./05-database-schema-and-mock-json.md)):

- `OnboardClient`
- `OnboardingProject`
- `OnboardingIdentityMap`
- `BusinessProfile`
- `SalesProcessMap`
- `FaqItem`
- `PromptConfig`
- `HandoverRule`
- `FollowUpRule`
- `AutomationRecommendation`
- `AgentInterviewSession`
- `AgentInterviewAnswer`
- `ApprovalEvent`
- `SyncRun`
- `AuditEvent`

---

## 11. What to Avoid

- **Do not modify** existing KB tables or their relationships
- **Do not add** Onboard logic to existing frontend pages
- **Do not touch** runtime flags
- **Do not change** auth guards (extend, don't modify)
- **Do not reuse** KB-specific components that could couple Onboard to KB behavior
- **Do not import** Onboard code into KB modules or vice versa (clean HTTP API boundary)

---

## 11. What to Avoid

- **Do not modify** existing KB tables or their relationships
- **Do not add** Onboard logic to existing KB frontend pages
- **Do not touch** KB runtime flags
- **Do not change** KB auth guards (extend, don't modify)
