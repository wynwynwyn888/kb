# AISBP-Onboard — Definition of Done

## MVP Definition of Done

AISBP-Onboard MVP is **done** when all of the following are true:

### Core Functionality
- [ ] Client/project can be created (manual by Wyn)
- [ ] Setup template fields can be filled (all 6 sections)
- [ ] AI agent can submit interview answers via API
- [ ] AI agent can submit workflow analysis via API
- [ ] AI agent can submit automation recommendations via API

### Review Workflow
- [ ] Wyn can review all sections
- [ ] Wyn can approve individual sections
- [ ] Wyn can reject sections with comments
- [ ] Wyn can request changes on project
- [ ] Wyn can approve entire project (all sections approved)
- [ ] Missing fields are visible per section
- [ ] Approval gates work (cannot approve project without all sections)
- [ ] Project status transitions are enforced

### KB Sync
- [ ] KB dry-run works (previews changes, does not mutate)
- [ ] KB approved sync works (creates/updates KB tenant and config)
- [ ] Sync requires approved project (enforced)
- [ ] All syncs are audited
- [ ] Identity map updated after sync

### Safety & Compliance
- [ ] No agent can approve (code-level enforcement)
- [ ] No agent can sync (code-level enforcement)
- [ ] Identifiers match KB/GHL/Ops standard
- [ ] Phone numbers masked by default in all views
- [ ] No secrets exposed in API responses
- [ ] All write operations produce audit events
- [ ] Idempotency prevents duplicate syncs

### Quality
- [ ] Unit tests pass (>90% coverage on business logic)
- [ ] API tests pass (all endpoints)
- [ ] UI smoke tests pass (core flows)
- [ ] TypeScript compiles without errors
- [ ] Linter passes

### Deployment
- [ ] Deployment documented
- [ ] Rollback/pause documented
- [ ] Dev environment runs end-to-end
- [ ] Staging environment verified

---

## Phase 1 DoD (App Foundation + DB + Manual Setup)

- [ ] App scaffolded at `apps/onboard/`
- [ ] Auth guard works (redirects unauthenticated)
- [ ] Layout renders with navigation
- [ ] Dashboard page renders
- [ ] Database schema created (all 15 tables)
- [ ] Migrations run successfully
- [ ] Client creation form works
- [ ] Project creation form works
- [ ] All 6 section forms work (create + edit)
- [ ] Data persists across page reloads
- [ ] `pnpm build` succeeds
- [ ] `pnpm typecheck` succeeds

---

## Phase 2 DoD (Agent Intake + Review Workflow)

- [ ] Agent API: create session, submit answers, submit analysis
- [ ] Agent API: missing fields endpoint
- [ ] Agent API: request review endpoint
- [ ] Agent API: status endpoint
- [ ] Agent cannot approve (verified by test)
- [ ] Agent cannot sync (verified by test)
- [ ] Operator: review queue page
- [ ] Operator: section approval
- [ ] Operator: request changes
- [ ] Operator: final project approval
- [ ] AI recommendations visible in UI
- [ ] Agent session detail page

---

## Phase 3 DoD (KB Sync + GHL Validation)

- [ ] KB dry-run from approved project
- [ ] KB dry-run preview displays results
- [ ] KB sync apply from approved project
- [ ] KB sync creates/updates tenant in KB
- [ ] Identity map updated after KB sync
- [ ] Sync run records created for each operation
- [ ] GHL validation from project
- [ ] GHL dry-run from project
- [ ] Audit log shows all sync events
- [ ] Sync preview page in UI

---

## Non-MVP DoD (Future Phases)

- [ ] GHL apply sync (gated behind feature flag)
- [ ] Wyn notification (WhatsApp/in-app) when review ready
- [ ] Client self-service portal
- [ ] Multi-operator approval workflow
- [ ] External notification pipeline
- [ ] Full analytics dashboard
- [ ] Automated E2E CI tests
- [ ] Bulk onboarding support
- [ ] Two-way KB sync

---

## Verification Checklist (Before Marking Any Phase Done)

### Code Quality
- [ ] All TypeScript compiles without errors (`pnpm typecheck`)
- [ ] All linter rules pass (`pnpm lint`)
- [ ] No `any` types except where justified
- [ ] No unused imports or variables
- [ ] No commented-out code
- [ ] No console.log (use logger instead)
- [ ] No hardcoded secrets or URLs
- [ ] `.env.example` updated with all required vars

### Testing
- [ ] Unit tests pass (`pnpm test`)
- [ ] New code has tests (target >80% coverage)
- [ ] Critical paths have integration tests
- [ ] API contract tests cover all endpoints
- [ ] Auth tests cover all roles/scenarios
- [ ] Security tests cover all threats

### Safety
- [ ] Agent cannot approve (tested)
- [ ] Agent cannot sync (tested)
- [ ] Sync requires approved project (tested)
- [ ] Idempotency works (tested)
- [ ] Phone masking works (tested)
- [ ] Audit events created for all writes (verified)
- [ ] No secrets in API responses (verified)
- [ ] Feature flags control sync behavior (tested)

### Documentation
- [ ] API docs updated (Swagger)
- [ ] README updated
- [ ] `.env.example` updated
- [ ] Migration notes if breaking schema changes
- [ ] Deployment guide updated

### Production Readiness
- [ ] Staging environment verified
- [ ] No runtime flag changes needed
- [ ] `AISBP_OUTBOUND_THROUGH_KB_ENABLED` remains `false`
- [ ] Rollback plan documented
- [ ] Smoke test procedure documented
