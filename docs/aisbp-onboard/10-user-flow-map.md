# AISBP-Onboard — User Flow Map

## Flow Overview

```
┌──────────┐    ┌──────────┐    ┌──────────┐    ┌──────────┐    ┌──────────┐
│  INTAKE  │───▶│ ANALYSIS │───▶│  REVIEW  │───▶│   SYNC   │───▶│  LIVE    │
│ (Agent)  │    │ (Agent)  │    │  (Wyn)   │    │ (System) │    │ (Pilot)  │
└──────────┘    └──────────┘    └──────────┘    └──────────┘    └──────────┘
```

---

## Flow 1: Manual Client Setup by Wyn

```
Wyn opens Onboard
      │
      ▼
Dashboard → "New Project" button
      │
      ▼
Fill client form:
  • businessName
  • clientKey (auto-generated or manual)
  • contactName
  • contactPhone
  • contactEmail
  • timezone
      │
      ▼
Submit → Project created (status: draft)
      │
      ▼
Redirect to project detail page
      │
      ▼
Wyn fills each section manually:
  • Business Profile
  • Sales Process
  • FAQ Items
  • Prompt Config
  • Handover Rules
  • Follow-up Rules
      │
      ▼
Status transitions per section:
  empty → partial → complete
```

**Status transitions**:
```
draft → (never auto-submitted when created manually)
Wyn manually sets sections to complete → can approve immediately
```

---

## Flow 2: WhatsApp AI Interview Starts

```
Client messages WhatsApp business number
      │
      ▼
AI Agent: "Hi! I'm here to help set up your AI assistant.
          Let's start with your business name. What is it?"
      │
      ▼
Client responds: "Dapper Dogs"
      │
      ▼
AI Agent calls POST /api/v1/onboard/agent/sessions
  → Creates/resumes session
      │
      ▼
AI Agent calls POST /api/v1/onboard/agent/sessions/:id/answers
  → Submits business_name = "Dapper Dogs"
      │
      ▼
AI Agent continues interview questions
  (one question at a time, step by step)
```

---

## Flow 3: Agent Creates/Resumes Onboarding Session

```
Agent: POST /onboard/agent/sessions
  body: { projectId, agentType: "whatsapp_ai" }
      │
      ├── Session exists (active or paused)
      │     → Return existing session, currentStep
      │
      └── No existing session
            → Create new session
            → currentStep = first incomplete question
            → Return session

Agent: GET /onboard/agent/sessions/:id
  → Check progress, remaining steps
```

**Session states**:
```
active → paused → active  (client pauses, resumes)
active → completed         (all questions answered)
active → expired           (timeout, no activity for 24h)
```

---

## Flow 4: Agent Submits Answers

```
Agent collects client response to a question
      │
      ▼
Agent: POST /onboard/agent/sessions/:id/answers
  body: {
    answers: [{
      section: "business_profile",
      questionKey: "business_name",
      answerValue: "Dapper Dogs",
      confidence: 0.98,
      source: "client_direct"
    }]
  }
      │
      ├── Valid → 201, answer stored, audit event created
      │
      └── Invalid → 400, validation errors
            (e.g. required field empty, wrong type)
      │
      ▼
Section status updated:
  empty → partial (first answer)
  partial → complete (all required answers for section)
```

**Idempotency**: If same `questionKey` for same `sessionId`, update existing answer (not duplicate).

---

## Flow 5: Agent Submits Workflow/Sales Analysis

```
Agent collects enough info to analyze
      │
      ▼
Agent: POST /onboard/agent/projects/:id/analysis
  body: {
    salesProcessAnalysis: { ... },
    recommendations: [ ... ]
  }
      │
      ▼
Sales process stored in sales_process_maps table
      │
      ▼
Recommendations stored in automation_recommendations table
  (status: suggested, source: ai_analysis)
      │
      ▼
Response: { analysisStored: true, recommendationsStored: N }
```

---

## Flow 6: Agent Submits Automation Recommendations

```
Included in Flow 5's analysis endpoint.
Recommendations flow:

  AI generates → stored as "suggested"
      │
      ▼
  Wyn reviews in project detail
      │
      ├── Accept → status = "accepted", config merged into sections
      │
      ├── Reject → status = "rejected", reason recorded
      │
      └── Modify → Wyn edits, status = "modified"
```

**Recommendation risk levels visible in UI**:
- 🟢 Low risk — safe to auto-apply on approval
- 🟡 Medium risk — review recommended
- 🔴 High risk — requires explicit Wyn confirmation

---

## Flow 7: Agent Requests Wyn Review

```
Agent completes all interview steps
      │
      ▼
Agent checks: GET /onboard/agent/projects/:id/missing-fields
      │
      ├── completeness < 1.0 → continue interview
      │
      └── completeness = 1.0 → ready for review
      │
      ▼
Agent: POST /onboard/agent/projects/:id/request-review
      │
      ▼
Project status: draft/submitted → submitted
      │
      ▼
(In future: notification sent to Wyn)
      │
      ▼
Project appears in Wyn's review queue
```

---

## Flow 8: Wyn Checks Review Queue (MVP)

```
(MVP: Wyn checks Onboard dashboard manually — review queue tab shows pending projects)

  Project submitted → appears in review queue on Wyn's dashboard
      │
      ▼
  Dashboard badge: "3 projects need review"
      │
      ▼
  Wyn clicks into project detail to begin review

(Future PR 11: External WhatsApp/email notification when project is ready)
```

---

## Flow 9: Wyn Reviews Missing Fields

```
Wyn opens project detail
      │
      ▼
Dashboard shows per-section status:
  ✅ Business Profile — Complete (12/12 fields)
  ⚠️ Sales Process — Partial (5/8 fields)
  ❌ FAQ — Empty (0/15 items)
  ✅ Prompt Config — Approved
  ⚠️ Handover Rules — Empty
  ⚠️ Follow-Up Rules — Empty
      │
      ▼
Missing fields panel shows:
  "Sales Process: missing booking_link, lead_sources, channel_preference"
  "FAQ: missing 15 items"
  "Handover: missing handover_contact_name, handover_contact_phone, triggers"
      │
      ▼
Wyn can:
  a) Fill missing fields manually
  b) Request changes → agent fills them
```

---

## Flow 10: Wyn Requests Changes

```
Wyn reviews a section, finds issues
      │
      ▼
Wyn: POST /onboard/projects/:id/request-changes
  body: {
    comment: "Please clarify pricing for large breeds.",
    rejectedSections: ["business_profile"]
  }
      │
      ▼
Section status: complete/approved → rejected
Project status: in_review → changes_requested
      │
      ▼
Audit event written: { action: "request_changes", actor: "wyn-operator" }
      │
      ▼
Agent checks: GET /onboard/agent/projects/:id/status
  → sees changes_requested with comment
      │
      ▼
Agent resumes interview, asks client for clarification
      │
      ▼
Agent re-submits updated answers → section status → complete
      │
      ▼
Agent re-requests review → project status → submitted/in_review
```

---

## Flow 11: Client/Agent Provides Corrections

```
(Handled within Flow 10's changes_requested loop)

  changes_requested → agent updates answers → section complete → re-submit → in_review
```

---

## Flow 12: Wyn Approves Individual Sections

```
Wyn opens section in project detail
      │
      ▼
Reviews all fields in the section
      │
      ├── Section looks correct → "Approve Section"
      │     POST /onboard/projects/:id/sections/business_profile/approve
      │     { comment: "Looks good" }
      │     → section status: complete → approved
      │     → audit event written
      │
      └── Section has issues → "Request Changes"
            (see Flow 10)
```

**Section status flow**:
```
empty → partial → complete → approved
                  ↓
              rejected → partial → complete → approved
```

---

## Flow 13: Wyn Approves Whole Project

```
ALL sections are approved
      │
      ▼
"Approve Project" button becomes active
      │
      ▼
Wyn: POST /onboard/projects/:id/approve
      │
      ▼
Validation: all sections.status === "approved"
      │
      ├── Pass → project status: in_review → approved
      │           approvedAt = now
      │           approvedBy = "wyn-operator"
      │           audit event written
      │
      └── Fail → 409: "Not all sections are approved"
                  Lists unapproved sections
```

---

## Flow 14: KB Dry-Run

```
Wyn opens sync tab on approved project
      │
      ▼
"KB Dry-Run" button
      │
      ▼
Wyn triggers: (via operator API)
  → Onboard generates KB sync payload
  → POST /integrations/onboard/tenants/dry-run (internal)
      │
      ▼
KB validates payload, returns preview
  → sync_run created (mode: dry_run, status: dry_run_passed)
      │
      ▼
Wyn sees preview:
  ✅ New tenant: "Dapper Dogs" will be created
  ✅ Knowledge items: 15 FAQ items will be created
  ✅ Prompt config will be created
  ⚠️ No handover rules configured
  ⚠️ No follow-up rules configured
      │
      ├── Happy with preview → proceed to apply (Flow 15)
      └── Issues found → go back, fix sections, re-run dry-run
```

**Safety**: Dry-run does not create or modify anything in KB.

---

## Flow 15: KB Approved Sync Apply

```
Wyn reviews dry-run results
      │
      ▼
"Apply KB Sync" button (only visible when dry-run passed)
      │
      ▼
Wyn triggers:
  → Validation:
    • Project status === "approved" ✅
    • KB sync feature flag === true ✅
    • Dry-run passed ✅
  → Generate idempotency key
  → POST /integrations/onboard/tenants/sync (internal)
      │
      ▼
KB creates/updates:
  • Tenant (if new)
  • Knowledge vault items
  • Prompt config
  • Bot profile
      │
      ▼
Response: { syncRunId, status: "applied", kbTenantId: "34c62859-..." }
      │
      ▼
Identity map updated:
  onboard_client_id → kb_tenant_id
      │
      ▼
Audit event: { action: "sync.kb.apply", actor: "wyn-operator" }
      │
      ▼
Project status: approved → syncing → live
```

**Error handling**:
```
KB API unreachable → sync_run status = apply_failed, retryable
Duplicate idempotency key → 409 Conflict, existing syncRunId returned
KB returns validation error → sync_run status = apply_failed, error stored
```

---

## Flow 16: GHL Validation

```
(Future — Phase 2)

Wyn opens GHL tab on project detail
      │
      ▼
"Validate GHL" button
      │
      ▼
POST /onboard/projects/:id/sync/ghl/validate
  → Checks: location exists, token valid, calendar accessible
      │
      ▼
Result:
  ✅ Location valid
  ✅ Connection active
  ✅ Calendar accessible
  ⚠️ No workflows detected
```

**Safety**: Validation does not modify GHL.

---

## Flow 17: GHL Dry-Run

```
(Future — Phase 2)

Wyn: "GHL Dry-Run" button
      │
      ▼
POST /onboard/projects/:id/sync/ghl/dry-run
  → Sync plan generated
  → sync_run (mode: dry_run)
      │
      ▼
Preview shows what would be created/updated in GHL
```

**Safety**: Dry-run does not modify GHL.

---

## Flow 18: GHL Approved Sync Apply

```
(Future — Phase 3)

Gated behind ONBOARD_GHL_SYNC_ENABLED=true (must be explicitly approved).

Wyn: "Apply GHL Sync" button
      │
      ▼
POST /onboard/projects/:id/sync/ghl/apply
  → Idempotency key generated
  → GHL API called
  → sync_run (mode: apply)
      │
      ▼
GHL configuration applied:
  • Bot connection verified
  • Calendar linked
  • Workflows configured (future)
```

---

## Flow 19: Controlled Test Contact

```
After KB sync:
      │
      ▼
Wyn sends test message from approved test contact
  (follows kb-controlled-pilot-onboarding-checklist)
      │
      ▼
Verify in Ops dashboard:
  • Inbound received
  • AI reply generated
  • Outbound sent
  • No duplicate sends
  • No errors
      │
      ▼
Test passes → ready for go-live
Test fails → investigate, fix, re-test
```

---

## Flow 20: Go-Live Decision

```
All checks pass:
  ✅ KB sync applied successfully
  ✅ GHL validation passed (connection, calendar)
  ✅ Test contact test passed
  ✅ Ops dashboard shows expected data
  ✅ No secrets exposed
  ✅ Rollback path confirmed
      │
      ▼
Wyn marks project as LIVE in Onboard
      │
      ▼
Client informed that bot is live under controlled pilot
  (use client communication template from pilot checklist)
      │
      ▼
24-hour monitoring begins
```

---

## Flow 21: Pause / Rollback

```
Issue detected during pilot:
      │
      ▼
Wyn opens Onboard → project detail → "Pause"
  → Project status → paused
  → All sync operations blocked for paused projects
      │
      ▼
If KB config issue:
  → Wyn triggers "Rollback KB Sync"
  → Onboard reverses KB configuration
  → sync_run (mode: rollback)
      │
      ▼
If GHL config issue:
  → Wyn pauses bot in KB dashboard
  → Fix config in Onboard
  → Re-sync
```

---

## Status Transition Summary

```
PROJECT STATUS:
  draft → submitted → in_review → changes_requested → approved → syncing → live
    ↑                      ↓              │
    └──────────────────────┘              │
          (agent resubmits)               │
                                          │
  Any state → paused (Wyn pauses)         │
  Any state → archived (cleanup)          │

SECTION STATUS:
  empty → partial → complete → approved
                  ↓
              rejected → partial → complete → approved

SYNC RUN STATUS:
  pending → dry_run_passed → applied → completed
         → dry_run_failed
         → apply_failed
         → rolled_back
```
