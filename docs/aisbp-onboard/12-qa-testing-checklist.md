# AISBP-Onboard — QA / Testing Checklist

## Unit Tests

### Identifier Formatting
- [ ] `formatDisplayLabel("Dapper Dogs", "dapperdogs")` → `"Dapper Dogs · dapperdogs"`
- [ ] `formatShortId("a1b2c3d4-...")` → `"a1b2c3d4"`
- [ ] `formatGhlLabel("kfmh8xHo", "b6bac998")` → `"GHL kfmh8xHo · b6bac998"`
- [ ] Missing displayName → error or fallback
- [ ] Missing clientKey → error or fallback

### Phone Masking
- [ ] `phoneMask("+6587651234")` → `"+65****1234"`
- [ ] `phoneMask("+6587651234", {reveal: true})` → `"+6587651234"`
- [ ] Short phone number → handled gracefully
- [ ] International format preserved
- [ ] Null/undefined → null or "--"

### Status Transitions
- [ ] `draft → submitted` valid
- [ ] `submitted → in_review` valid
- [ ] `in_review → changes_requested` valid
- [ ] `changes_requested → in_review` valid (on re-submit)
- [ ] `in_review → approved` valid (all sections approved)
- [ ] `in_review → approved` rejected (not all sections approved)
- [ ] `approved → syncing` valid
- [ ] `syncing → live` valid
- [ ] `approved → draft` INVALID (cannot go backward without changes_requested)
- [ ] Any state → paused valid
- [ ] Any state → archived valid

### Required Field Validation
- [ ] business_profile: business_name required
- [ ] faq: question + answer required per item
- [ ] prompt: persona required
- [ ] handover: at least one trigger if enabled
- [ ] follow_up: cadence_hours required if enabled

### Approval Rules
- [ ] Agent cannot approve section
- [ ] Agent cannot approve project
- [ ] Agent cannot trigger sync
- [ ] Operator can approve section
- [ ] Operator can approve project
- [ ] Project approval requires all sections approved
- [ ] Section approval requires section.status === "complete"
- [ ] Approval writes audit event
- [ ] Approval records actorId and timestamp

### Idempotency Keys
- [ ] Same inputs produce same key
- [ ] Different mode produces different key
- [ ] Different version produces different key
- [ ] Different project produces different key
- [ ] Key is deterministic (SHA256 hash)

### Sync Payload Generation
- [ ] KB sync payload includes tenant_name
- [ ] KB sync payload includes knowledge items from approved FAQ
- [ ] KB sync payload includes prompt config
- [ ] KB sync payload excludes rejected sections
- [ ] GHL sync payload includes location_id
- [ ] GHL sync payload respects dry_run flag

---

## API Tests

### Agent API

- [ ] `POST /agent/sessions` creates new session → 201
- [ ] `POST /agent/sessions` returns existing active session → 200
- [ ] `POST /agent/sessions` with invalid projectId → 400
- [ ] `POST /agent/sessions` with missing auth → 401
- [ ] `GET /agent/sessions/:id` returns session details → 200
- [ ] `GET /agent/sessions/:id` with invalid id → 404
- [ ] `POST /agent/sessions/:id/answers` stores answers → 201
- [ ] `POST /agent/sessions/:id/answers` validation errors → 400
- [ ] `POST /agent/sessions/:id/answers` idempotency → 200 (no duplicate)
- [ ] `POST /agent/projects/:id/analysis` stores analysis → 201
- [ ] `GET /agent/projects/:id/missing-fields` returns missing → 200
- [ ] `POST /agent/projects/:id/request-review` transitions to submitted → 200
- [ ] `POST /agent/projects/:id/request-review` incomplete sections → 400
- [ ] `GET /agent/projects/:id/status` returns status → 200

### Agent Cannot Approve or Sync
- [ ] Agent `POST /approve` → 403
- [ ] Agent `POST /integrations/onboard/tenants/sync` → 403
- [ ] Agent `POST /sync/ghl/apply` → 403

### Operator API

- [ ] `GET /projects` lists projects → 200
- [ ] `GET /projects?status=in_review` filters → 200
- [ ] `POST /projects` creates project → 201
- [ ] `GET /projects/:id` returns full project → 200
- [ ] `PATCH /projects/:id` updates metadata → 200
- [ ] `PATCH /projects/:id/sections/:name` updates section → 200
- [ ] `POST /projects/:id/sections/:name/approve` approves → 200
- [ ] `POST /projects/:id/request-changes` rejects sections → 200
- [ ] `POST /projects/:id/reject` rejects project → 200
- [ ] `POST /projects/:id/approve` approves project → 200
- [ ] `POST /projects/:id/approve` not all sections approved → 409
- [ ] `GET /projects/:id/audit` returns events → 200
- [ ] `GET /projects/:id/sync-runs` returns runs → 200

### Sync Endpoints
- [ ] `POST /integrations/onboard/tenants/dry-run` works → 200
- [ ] `POST /integrations/onboard/tenants/dry-run` does not change KB
- [ ] `POST /integrations/onboard/tenants/sync` requires approved project → 409
- [ ] `POST /integrations/onboard/tenants/sync` with approved project → 200 (or 502 if KB down)
- [ ] `POST /integrations/onboard/tenants/sync` duplicate idempotency → 409
- [ ] `GET /integrations/onboard/sync-runs/:id` returns details → 200

### Error Handling
- [ ] Invalid JSON body → 400
- [ ] Missing required field → 400 with field name
- [ ] Wrong field type → 400 with type hint
- [ ] Unauthenticated → 401
- [ ] Wrong role → 403
- [ ] Not found → 404
- [ ] Duplicate idempotency → 409
- [ ] Rate limit exceeded → 429

---

## UI Tests (Playwright or Manual)

### Project Creation
- [ ] "New Project" button on dashboard
- [ ] Form validates required fields
- [ ] Submit creates project, redirects to detail
- [ ] Backend validates and persists

### Section Editing
- [ ] Edit section form loads existing data
- [ ] Save updates section and shows success toast
- [ ] Validation errors shown per field
- [ ] Cancel discards changes

### Section Approval
- [ ] Approve button visible when section complete
- [ ] Approve button disabled when section empty
- [ ] Approve confirms with dialog
- [ ] Status pill updates to "Approved"

### Request Changes
- [ ] Request Changes shows comment form
- [ ] Submit changes section status to rejected
- [ ] Agent can see rejection comment

### Missing Fields Display
- [ ] Dashboard shows completeness %
- [ ] Project detail shows missing fields per section
- [ ] Click missing field navigates to section

### Sync Preview Display
- [ ] Dry-run results shown clearly
- [ ] Changes list with checkmarks/warnings
- [ ] Apply button only visible after dry-run

### Audit Timeline Display
- [ ] Events in chronological order
- [ ] Actor and action clearly displayed
- [ ] Filter by action type

### No Full Phone Display
- [ ] List views show masked phones
- [ ] Detail views show masked phones
- [ ] No phone in audit logs
- [ ] Click-to-reveal shows full (operator only)

---

## Security Tests

### Authentication
- [ ] Unauthenticated requests to protected endpoints → 401
- [ ] Expired token → 401
- [ ] Invalid token → 401
- [ ] Wrong token type → 401

### Authorization
- [ ] Agent role cannot access operator endpoints → 403
- [ ] Agent cannot approve → 403
- [ ] Agent cannot sync → 403
- [ ] Service role cannot approve → 403
- [ ] Viewer role cannot write → 403

### Data Protection
- [ ] API responses do not include secrets
- [ ] Phone numbers masked by default
- [ ] GHL tokens never returned
- [ ] Service tokens never returned

### Rate Limiting
- [ ] Agent rate limit enforced → 429 after threshold
- [ ] Operator rate limit less restrictive
- [ ] Sync endpoints rate limited per project

### Audit
- [ ] Every write creates audit event
- [ ] Audit includes actorId and actorType
- [ ] Audit includes before/after changes
- [ ] Audit does not include PII values

### Idempotency
- [ ] Duplicate sync returns 409
- [ ] Idempotency keys not guessable
- [ ] Different projects can have same target system (different keys)

---

## Integration Tests

### Onboard → KB Dry-Run
- [ ] Dry-run payload generates correctly
- [ ] KB validates payload
- [ ] Changes summary returned
- [ ] No data created in KB

### Onboard → KB Apply
- [ ] Apply requires approved project
- [ ] Apply creates sync_run record
- [ ] Identity map updated after success
- [ ] Audit event written

### Onboard → KB Failure
- [ ] KB API error returns 502
- [ ] sync_run status = apply_failed
- [ ] Error message stored
- [ ] Retry possible (incremented version)

### Duplicate Sync
- [ ] Same project + same mode → 409
- [ ] Existing sync_run returned
- [ ] No duplicate KB entities created

### GHL Dry-Run (Future)
- [ ] Dry-run validates location
- [ ] Does not mutate GHL
- [ ] Warnings for missing config

---

## Manual QA Checklist

### Project Creation
- [ ] Create project with minimum fields → succeeds
- [ ] Create project with all fields → succeeds
- [ ] Duplicate clientKey → error

### Fill Template
- [ ] Fill business profile → save → reload → data persists
- [ ] Add FAQ items → save → reload → items persist
- [ ] Configure prompt → save → reload → config persists

### Submit Agent Answers
- [ ] Agent creates session → session visible in UI
- [ ] Agent submits answers → answers visible in project
- [ ] Agent submits analysis → recommendations visible

### Approve Sections
- [ ] Approve individual section → status updates
- [ ] Approve all sections → "Approve Project" enabled
- [ ] Approve project → status transitions to "approved"

### KB Dry-Run
- [ ] Dry-run creates sync_run with mode=dry_run
- [ ] Preview shows changes
- [ ] Warnings displayed

### KB Sync Apply
- [ ] Apply creates sync_run with mode=apply
- [ ] KB tenant created (or verified)
- [ ] Identity map updated
- [ ] Audit log updated

### Verify Identifiers
- [ ] Display labels use correct format
- [ ] Short IDs truncate to 8 chars
- [ ] Business name always visible

### No Live GHL Mutation
- [ ] GHL dry-run does not create/modify anything
- [ ] GHL apply disabled (feature flag off)
- [ ] No GHL API calls without explicit trigger

### Phone Masking
- [ ] All list views show masked phones
- [ ] Detail views show masked phones
- [ ] Click reveal shows full (operator only)
- [ ] Agent API responses show masked phones
