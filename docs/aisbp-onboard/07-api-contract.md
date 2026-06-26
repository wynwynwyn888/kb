# AISBP-Onboard — API Contract

## General Rules

- **Base URL**: `https://kb.aisalesbot.pro/api/v1` (same as existing KB backend)
- **Content-Type**: `application/json`
- **Auth**: Bearer JWT (Supabase) or Agent API token header
- **Idempotency**: Required on all sync/apply endpoints
- **Audit**: All write endpoints create `audit_events`
- **Rate Limiting**: Applied per actor type (agent more restricted than operator)
- **Errors**: Standard `{ "error": string, "details": [...] }` format

## Endpoint Template

Every endpoint in this contract includes:

| Field | Description |
|-------|-------------|
| **Method** | HTTP method |
| **Actor** | Who calls this endpoint (`agent`, `operator`, `service`) |
| **Auth** | Required / Optional |
| **Idempotency** | Required / Recommended / No |
| **MVP** | Yes / Future (with target PR) |
| **Request** | Example request body |
| **Response** | Example success response |
| **Errors** | Common error codes and conditions |
| **Safety** | Applicable safety notes |

**Important**: All sync/apply endpoints are **proposed target contracts** for future PRs. Actual KB/GHL sync implementation is deferred to PR 8-10 and must be validated during implementation. Endpoints marked "Future" are placeholders — do not implement until the referenced PR.

---

## Agent API

> **Actor**: AI Agent (WhatsApp onboarding agent)
> **Auth**: `Authorization: Bearer <AGENT_API_TOKEN>`
> **Permission**: `agent` scope only — cannot approve, cannot sync

---

### `POST /api/v1/onboard/agent/sessions`

Create or resume an interview session.

| Field | Value |
|-------|-------|
| **Method** | `POST` |
| **Actor** | Agent |
| **Auth** | Required (agent token) |
| **Idempotency** | No |
| **MVP** | Yes |

**Request**:
```json
{
  "projectId": "f8d4c2a0-5e3b-4f2c-9d6e-0a4c3b2f5e8d",
  "agentType": "whatsapp_ai"
}
```

**Response `201`**:
```json
{
  "sessionId": "b8c9d0e1-2f3a-4b5c-6d7e-8f9a0b1c2d3e",
  "projectId": "f8d4c2a0-5e3b-4f2c-9d6e-0a4c3b2f5e8d",
  "status": "active",
  "currentStep": "business_name",
  "totalSteps": 12
}
```

**Errors**: `400` invalid projectId, `404` project not found, `409` active session exists

---

### `GET /api/v1/onboard/agent/sessions/:sessionId`

Get session status and progress.

| Field | Value |
|-------|-------|
| **Method** | `GET` |
| **Actor** | Agent |
| **Auth** | Required |
| **MVP** | Yes |

**Response `200`**:
```json
{
  "sessionId": "b8c9d0e1-2f3a-4b5c-6d7e-8f9a0b1c2d3e",
  "projectId": "f8d4c2a0-5e3b-4f2c-9d6e-0a4c3b2f5e8d",
  "status": "active",
  "currentStep": "faq_pricing",
  "totalSteps": 12,
  "completedSteps": 7,
  "expiresAt": "2026-06-27T10:30:00Z"
}
```

---

### `POST /api/v1/onboard/agent/sessions/:sessionId/answers`

Submit one or more answers.

| Field | Value |
|-------|-------|
| **Method** | `POST` |
| **Actor** | Agent |
| **Auth** | Required |
| **Idempotency** | Recommended (`X-Idempotency-Key` header) |
| **MVP** | Yes |

**Request**:
```json
{
  "answers": [
    {
      "section": "business_profile",
      "questionKey": "business_name",
      "questionLabel": "What is your business name?",
      "answerValue": "Dapper Dogs",
      "confidence": 0.98,
      "source": "client_direct"
    },
    {
      "section": "business_profile",
      "questionKey": "description",
      "questionLabel": "Describe your business",
      "answerValue": "Premium dog grooming salon in Tiong Bahru, Singapore.",
      "confidence": 0.95,
      "source": "client_direct"
    }
  ]
}
```

**Response `201`**:
```json
{
  "accepted": 2,
  "rejected": 0,
  "answers": [
    {
      "id": "c9d0e1f2-3a4b-5c6d-7e8f-9a0b1c2d3e4f",
      "section": "business_profile",
      "questionKey": "business_name",
      "status": "stored"
    }
  ]
}
```

**Errors**: `400` validation errors per answer, `404` session not found

**Safety**: Agent cannot submit answers to an approved section.

---

### `POST /api/v1/onboard/agent/projects/:projectId/analysis`

Submit AI workflow analysis and recommendations.

| Field | Value |
|-------|-------|
| **Method** | `POST` |
| **Actor** | Agent |
| **Auth** | Required |
| **Idempotency** | Yes (`X-Idempotency-Key` header) |
| **MVP** | Yes |

**Request**:
```json
{
  "salesProcessAnalysis": {
    "leadSources": ["instagram", "google", "referrals"],
    "conversationGoal": "book_appointment",
    "primaryCta": "Book a grooming appointment",
    "bookingLink": "https://dapperdogs.sg/book",
    "channelPreference": "whatsapp"
  },
  "recommendations": [
    {
      "type": "booking",
      "title": "Enable automated appointment booking",
      "description": "Clear services with durations. High booking intent.",
      "rationale": "Service-based business with defined time slots",
      "riskLevel": "low",
      "suggestedConfig": {
        "calendarProvider": "ghl",
        "requiredFields": ["name", "phone", "breed", "service"]
      }
    }
  ]
}
```

**Response `201`**:
```json
{
  "analysisStored": true,
  "recommendationsStored": 1,
  "recommendationIds": ["a7b8c9d0-1e2f-3a4b-5c6d-7e8f9a0b1c2d"]
}
```

---

### `GET /api/v1/onboard/agent/projects/:projectId/missing-fields`

Get list of required fields not yet filled.

| Field | Value |
|-------|-------|
| **Method** | `GET` |
| **Actor** | Agent |
| **Auth** | Required |
| **MVP** | Yes |

**Response `200`**:
```json
{
  "projectId": "f8d4c2a0-5e3b-4f2c-9d6e-0a4c3b2f5e8d",
  "completeness": 0.72,
  "missingFields": [
    {"section": "faq", "questionKey": "faq_booking_1", "questionLabel": "How do I book an appointment?"},
    {"section": "handover", "questionKey": "emergency_contact", "questionLabel": "Emergency escalation contact"}
  ]
}
```

---

### `POST /api/v1/onboard/agent/projects/:projectId/request-review`

Request Wyn to review the project.

| Field | Value |
|-------|-------|
| **Method** | `POST` |
| **Actor** | Agent |
| **Auth** | Required |
| **Idempotency** | Yes |
| **MVP** | Yes |

**Response `200`**:
```json
{
  "projectId": "f8d4c2a0-5e3b-4f2c-9d6e-0a4c3b2f5e8d",
  "status": "submitted",
  "submittedAt": "2026-06-26T10:30:00Z"
}
```

**Errors**: `400` incomplete sections, `409` already submitted

---

### `GET /api/v1/onboard/agent/projects/:projectId/status`

Get project status for agent.

| Field | Value |
|-------|-------|
| **Method** | `GET` |
| **Actor** | Agent |
| **Auth** | Required |
| **MVP** | Yes |

**Response `200`**:
```json
{
  "projectId": "f8d4c2a0-5e3b-4f2c-9d6e-0a4c3b2f5e8d",
  "status": "changes_requested",
  "reviewComment": "Please clarify pricing for large breeds.",
  "sectionsStatus": {
    "business_profile": "approved",
    "faq": "rejected",
    "prompt": "approved"
  }
}
```

---

## Operator API

> **Actor**: Wyn (operator/admin)
> **Auth**: `Authorization: Bearer <SUPABASE_JWT>`
> **Permission**: `operator` or `admin` scope

---

### `GET /api/v1/onboard/projects`

List all projects.

| Field | Value |
|-------|-------|
| **Method** | `GET` |
| **Actor** | Operator |
| **Auth** | Required |
| **Idempotency** | No |
| **MVP** | Yes |

**Query params**: `?status=in_review&page=1&limit=20`

**Response `200`**:
```json
{
  "projects": [
    {
      "projectId": "f8d4c2a0-5e3b-4f2c-9d6e-0a4c3b2f5e8d",
      "clientKey": "dapperdogs",
      "displayName": "Dapper Dogs",
      "displayLabel": "Dapper Dogs · dapperdogs",
      "status": "in_review",
      "submittedAt": "2026-06-26T10:30:00Z",
      "completeness": 0.72
    }
  ],
  "total": 1,
  "page": 1,
  "limit": 20
}
```

---

### `POST /api/v1/onboard/projects`

Create a new project manually (Wyn bypasses agent intake).

| Field | Value |
|-------|-------|
| **Method** | `POST` |
| **Actor** | Operator |
| **Auth** | Required |
| **Idempotency** | No |
| **MVP** | Yes |

**Request**:
```json
{
  "clientKey": "dapperdogs",
  "displayName": "Dapper Dogs",
  "contactName": "James Tan",
  "contactPhone": "+6587651234",
  "contactEmail": "james@dapperdogs.sg"
}
```

**Response `201`**:
```json
{
  "projectId": "f8d4c2a0-5e3b-4f2c-9d6e-0a4c3b2f5e8d",
  "clientKey": "dapperdogs",
  "displayName": "Dapper Dogs",
  "status": "draft"
}
```

---

### `GET /api/v1/onboard/projects/:projectId`

Get full project details.

| Field | Value |
|-------|-------|
| **Method** | `GET` |
| **Actor** | Operator |
| **Auth** | Required |
| **MVP** | Yes |

**Response `200`**:
```json
{
  "projectId": "f8d4c2a0-5e3b-4f2c-9d6e-0a4c3b2f5e8d",
  "clientKey": "dapperdogs",
  "displayName": "Dapper Dogs",
  "displayLabel": "Dapper Dogs · dapperdogs",
  "status": "in_review",
  "currentPhase": "review",
  "sections": {
    "business_profile": {"status": "complete", "data": {...}},
    "sales_process": {"status": "partial", "data": {...}},
    "faq": {"status": "complete", "items": 15},
    "prompt": {"status": "approved", "data": {...}},
    "handover": {"status": "empty", "data": null},
    "follow_up": {"status": "empty", "data": null}
  },
  "recommendations": [...],
  "syncRuns": [...]
}
```

---

### `PATCH /api/v1/onboard/projects/:projectId`

Update project metadata (not sections).

| Field | Value |
|-------|-------|
| **Method** | `PATCH` |
| **Actor** | Operator |
| **Auth** | Required |
| **MVP** | Yes |

**Request**:
```json
{
  "displayName": "Dapper Dogs Pte Ltd",
  "status": "paused"
}
```

---

### `PATCH /api/v1/onboard/projects/:projectId/sections/:sectionName`

Edit a section's data directly.

| Field | Value |
|-------|-------|
| **Method** | `PATCH` |
| **Actor** | Operator |
| **Auth** | Required |
| **MVP** | Yes |

**Request**:
```json
{
  "business_name": "Dapper Dogs",
  "description": "Updated description...",
  "services": [...]
}
```

**Validation**: Section data validated against schema for that section.

---

### `POST /api/v1/onboard/projects/:projectId/sections/:sectionName/approve`

Approve an individual section.

| Field | Value |
|-------|-------|
| **Method** | `POST` |
| **Actor** | Operator |
| **Auth** | Required |
| **Audit** | Yes (approval_event) |
| **MVP** | Yes |

**Request**:
```json
{
  "comment": "Looks good. Pricing is accurate."
}
```

**Response `200`**:
```json
{
  "section": "business_profile",
  "status": "approved",
  "approvedBy": "wyn-operator",
  "approvedAt": "2026-06-26T11:00:00Z"
}
```

---

### `POST /api/v1/onboard/projects/:projectId/request-changes`

Request changes on the entire project.

| Field | Value |
|-------|-------|
| **Method** | `POST` |
| **Actor** | Operator |
| **Auth** | Required |
| **Audit** | Yes (approval_event) |
| **MVP** | Yes |

**Request**:
```json
{
  "comment": "Please clarify pricing for large breeds and add more FAQ items.",
  "rejectedSections": ["faq", "business_profile"]
}
```

---

### `POST /api/v1/onboard/projects/:projectId/reject`

Reject the entire project.

| Field | Value |
|-------|-------|
| **Method** | `POST` |
| **Actor** | Operator |
| **Auth** | Required |
| **Audit** | Yes |
| **MVP** | Yes |

---

### `POST /api/v1/onboard/projects/:projectId/approve`

Final project approval. Required before any sync.

| Field | Value |
|-------|-------|
| **Method** | `POST` |
| **Actor** | Operator |
| **Auth** | Required |
| **Audit** | Yes |
| **MVP** | Yes |

**Preconditions**: All sections must be approved.

**Response `200`**:
```json
{
  "projectId": "f8d4c2a0-5e3b-4f2c-9d6e-0a4c3b2f5e8d",
  "status": "approved",
  "approvedBy": "wyn-operator",
  "approvedAt": "2026-06-26T11:30:00Z"
}
```

**Errors**: `409` not all sections approved

---

### `GET /api/v1/onboard/projects/:projectId/audit`

Get audit trail for a project.

| Field | Value |
|-------|-------|
| **Method** | `GET` |
| **Actor** | Operator |
| **Auth** | Required |
| **MVP** | Yes |

**Response `200`**:
```json
{
  "projectId": "f8d4c2a0-5e3b-4f2c-9d6e-0a4c3b2f5e8d",
  "events": [
    {
      "id": "e1f2a3b4-...",
      "actorType": "agent",
      "action": "answer.submit",
      "resourceType": "answer",
      "createdAt": "2026-06-26T10:00:00Z"
    }
  ]
}
```

---

### `GET /api/v1/onboard/projects/:projectId/sync-runs`

Get sync run history for a project.

| Field | Value |
|-------|-------|
| **Method** | `GET` |
| **Actor** | Operator |
| **Auth** | Required |
| **MVP** | Yes |

**Response `200`**:
```json
{
  "projectId": "f8d4c2a0-5e3b-4f2c-9d6e-0a4c3b2f5e8d",
  "syncRuns": [
    {
      "syncRunId": "f2a3b4c5-...",
      "targetSystem": "kb",
      "mode": "dry_run",
      "status": "dry_run_passed",
      "triggeredBy": "wyn-operator",
      "createdAt": "2026-06-26T12:00:00Z"
    }
  ]
}
```

---

## KB Integration API

> **Actor**: Service (triggered by Operator API)
> **Auth**: Service token or operator JWT
> **Idempotency**: Required on all sync endpoints

---

### `POST /api/v1/integrations/onboard/tenants/dry-run`

Preview what would be created in KB.

| Field | Value |
|-------|-------|
| **Method** | `POST` |
| **Actor** | Service |
| **Auth** | Required (service token) |
| **Idempotency** | No (read-only) |
| **MVP** | Yes |

**Request**:
```json
{
  "projectId": "f8d4c2a0-5e3b-4f2c-9d6e-0a4c3b2f5e8d",
  "tenantName": "Dapper Dogs",
  "ghlLocationId": "kfmh8xHdo4KFVLO43BWI"
}
```

**Response `200`**:
```json
{
  "syncRunId": "f2a3b4c5-6d7e-8f9a-0b1c-2d3e4f5a6b7c",
  "changesDetected": true,
  "summary": {
    "newTenant": true,
    "newKnowledgeItems": 15,
    "newPromptConfig": true,
    "newHandoverRules": false,
    "newFollowUpRules": false
  },
  "warnings": []
}
```

**Safety**: Does not create or modify anything in KB.

---

### `POST /api/v1/integrations/onboard/tenants/sync`

Apply approved configuration to KB.

| Field | Value |
|-------|-------|
| **Method** | `POST` |
| **Actor** | Service |
| **Auth** | Required (service token) |
| **Idempotency** | Required (auto-generated) |
| **Audit** | Yes |
| **MVP** | Yes |

**Request**:
```json
{
  "projectId": "f8d4c2a0-5e3b-4f2c-9d6e-0a4c3b2f5e8d"
}
```

**Response `200`**:
```json
{
  "syncRunId": "a3b4c5d6-7e8f-9a0b-1c2d-3e4f5a6b7c8d",
  "status": "applied",
  "kbTenantId": "34c62859-7a1b-4c2d-9e3f-5a6b7c8d9e0f",
  "knowledgeItemsCreated": 15,
  "promptConfigCreated": true
}
```

**Errors**: `409` project not approved, `409` duplicate idempotency key, `502` KB API error

**Safety**: Only operator-triggered. Project must be approved.

---

### `GET /api/v1/integrations/onboard/sync-runs/:syncRunId`

Get sync run details.

| Field | Value |
|-------|-------|
| **Method** | `GET` |
| **Actor** | Operator |
| **Auth** | Required |
| **MVP** | Yes |

---

### `GET /api/v1/integrations/onboard/tenants/by-location/:ghlLocationId`

Look up Onboard client by GHL location ID.

| Field | Value |
|-------|-------|
| **Method** | `GET` |
| **Actor** | Operator |
| **Auth** | Required |
| **MVP** | Yes |

---

## GHL Integration API

> **Actor**: Service (triggered by Operator API)
> **Auth**: Service token
> **Idempotency**: Required on apply endpoints

---

### `POST /api/v1/onboard/projects/:projectId/sync/ghl/validate`

Validate GHL connection for a project.

| Field | Value |
|-------|-------|
| **Method** | `POST` |
| **Actor** | Operator |
| **Auth** | Required |
| **MVP** | Future (Phase 2) |

**Request**:
```json
{
  "ghlLocationId": "kfmh8xHdo4KFVLO43BWI"
}
```

**Response `200`**:
```json
{
  "locationValid": true,
  "connectionStatus": "connected",
  "calendarAccessible": true
}
```

---

### `POST /api/v1/onboard/projects/:projectId/sync/ghl/dry-run`

Preview GHL sync plan.

| Field | Value |
|-------|-------|
| **Method** | `POST` |
| **Actor** | Operator |
| **Auth** | Required |
| **MVP** | Future (Phase 2) |

**Response `200`**:
```json
{
  "syncRunId": "b4c5d6e7-...",
  "status": "dry_run_passed",
  "summary": {
    "locationValid": true,
    "connectionStatus": "connected",
    "warnings": []
  }
}
```

**Safety**: Does not modify GHL.

---

### `POST /api/v1/onboard/projects/:projectId/sync/ghl/apply`

Apply GHL configuration.

| Field | Value |
|-------|-------|
| **Method** | `POST` |
| **Actor** | Operator |
| **Auth** | Required |
| **Idempotency** | Required |
| **Audit** | Yes |
| **MVP** | Future (Phase 3) |

**Safety**: Must not run until explicitly approved. Gated behind `ONBOARD_GHL_SYNC_ENABLED` flag.

---

## Safety Notes Summary

1. **Agent API cannot approve** — No agent endpoint changes `section_status` to `approved`
2. **Agent API cannot sync** — No agent endpoint triggers sync operations
3. **Only operator API can approve and sync** — All approval/sync endpoints require `operator` or `admin` role
4. **All syncs require approved project** — Backend validates project status before any sync
5. **All writes create audit events** — Every mutation records actor, action, resource, changes
6. **Sync endpoints require idempotency** — Duplicate syncs return 409
7. **GHL apply sync default off** — Feature flag gates GHL writes
8. **Phone numbers masked** — All API responses mask phone numbers by default
