# AISBP-Onboard — Database Schema & Mock JSON

## Design Notes

- All tables live in the existing Supabase Postgres database (same as KB)
- Table names use `onboard_` prefix where needed to avoid collision
- All tables have `created_at`, `updated_at` timestamps
- `id` uses UUID primary keys
- All write operations produce `audit_events`
- Phone fields are stored encrypted or masked in API responses
- No raw API keys, tokens, or secrets stored in plaintext

---

## Table 1: `onboard_clients`

**Purpose**: Stores client identity and contact info. Each client maps to one business.

| Column | Type | Required | Notes |
|--------|------|----------|-------|
| `id` | UUID | Yes | PK, `onboardClientId` |
| `client_key` | VARCHAR(64) | Yes | URL-safe slug, unique (e.g. `dapperdogs`) |
| `display_name` | VARCHAR(255) | Yes | Business name |
| `contact_name` | VARCHAR(255) | No | Primary contact person |
| `contact_phone` | VARCHAR(32) | No | Masked in API, encrypted at rest |
| `contact_email` | VARCHAR(255) | No | |
| `whatsapp_phone` | VARCHAR(32) | No | WhatsApp-capable number, masked |
| `industry` | VARCHAR(128) | No | |
| `website_url` | VARCHAR(512) | No | |
| `timezone` | VARCHAR(64) | No | IANA timezone (e.g. `Asia/Singapore`) |
| `status` | ENUM | Yes | `draft`, `active`, `paused`, `archived` |
| `created_at` | TIMESTAMP | Yes | |
| `updated_at` | TIMESTAMP | Yes | |

**Indexes**: `client_key` (unique), `status`

---

## Table 2: `onboarding_projects`

**Purpose**: Tracks the onboarding workflow for a client.

| Column | Type | Required | Notes |
|--------|------|----------|-------|
| `id` | UUID | Yes | PK, `onboardingProjectId` |
| `client_id` | UUID | Yes | FK → `onboard_clients.id` |
| `status` | ENUM | Yes | `draft`, `submitted`, `in_review`, `changes_requested`, `approved`, `syncing`, `live`, `paused`, `archived` |
| `current_phase` | ENUM | Yes | `intake`, `analysis`, `review`, `sync`, `live` |
| `submitted_at` | TIMESTAMP | No | When agent submitted for review |
| `approved_at` | TIMESTAMP | No | When Wyn gave final approval |
| `approved_by` | VARCHAR(128) | No | `actorId` of approver |
| `sync_started_at` | TIMESTAMP | No | |
| `sync_completed_at` | TIMESTAMP | No | |
| `version` | INT | Yes | Incremented on each re-submission |
| `metadata` | JSONB | No | Extensible metadata |
| `created_at` | TIMESTAMP | Yes | |
| `updated_at` | TIMESTAMP | Yes | |

**Indexes**: `client_id`, `status`, `(client_id, status)`

---

## Table 3: `onboarding_identity_map`

**Purpose**: Maps Onboard identifiers to KB and GHL identifiers after sync.

| Column | Type | Required | Notes |
|--------|------|----------|-------|
| `id` | UUID | Yes | PK |
| `project_id` | UUID | Yes | FK → `onboarding_projects.id` |
| `onboard_client_id` | UUID | Yes | FK → `onboard_clients.id` |
| `kb_tenant_id` | UUID | No | KB tenant ID after sync |
| `ghl_location_id` | VARCHAR(128) | No | GHL location ID |
| `ghl_contact_id` | VARCHAR(128) | No | GHL test contact ID |
| `ghl_conversation_id` | VARCHAR(128) | No | GHL test conversation ID |
| `created_at` | TIMESTAMP | Yes | |
| `updated_at` | TIMESTAMP | Yes | |

**Indexes**: `project_id` (unique), `kb_tenant_id`

---

## Table 4: `business_profiles`

**Purpose**: Business identity, offerings, pricing, hours.

| Column | Type | Required | Notes |
|--------|------|----------|-------|
| `id` | UUID | Yes | PK |
| `project_id` | UUID | Yes | FK → `onboarding_projects.id` |
| `section_status` | ENUM | Yes | `empty`, `partial`, `complete`, `approved`, `rejected` |
| `business_name` | VARCHAR(255) | Yes | |
| `description` | TEXT | No | 1-2 sentence description |
| `services` | JSONB | No | Array of service objects |
| `products` | JSONB | No | Array of product objects |
| `pricing_policy` | TEXT | No | |
| `deposit_policy` | TEXT | No | |
| `opening_hours` | JSONB | No | Structured hours |
| `target_customer` | TEXT | No | |
| `service_area` | TEXT | No | |
| `forbidden_topics` | JSONB | No | Topics bot must never answer |
| `forbidden_claims` | JSONB | No | Claims bot must never make |
| `created_at` | TIMESTAMP | Yes | |
| `updated_at` | TIMESTAMP | Yes | |

**Indexes**: `project_id` (unique)

---

## Table 5: `sales_process_maps`

**Purpose**: Client's sales workflow analysis.

| Column | Type | Required | Notes |
|--------|------|----------|-------|
| `id` | UUID | Yes | PK |
| `project_id` | UUID | Yes | FK → `onboarding_projects.id` |
| `section_status` | ENUM | Yes | `empty`, `partial`, `complete`, `approved`, `rejected` |
| `lead_sources` | JSONB | No | Where leads come from |
| `conversation_goal` | ENUM | No | `book_appointment`, `collect_lead`, `answer_faqs`, `qualify_lead`, `route_to_human`, `send_booking_link`, `other` |
| `primary_cta` | TEXT | No | Primary call to action |
| `booking_link` | VARCHAR(512) | No | |
| `lead_fields_to_collect` | JSONB | No | Name, phone, email, etc. |
| `max_questions_before_booking` | INT | No | |
| `channel_preference` | ENUM | No | `whatsapp`, `sms`, `both` |
| `pipeline_name` | VARCHAR(255) | No | GHL pipeline |
| `pipeline_stages` | JSONB | No | Relevant stages |
| `conflicting_workflows` | JSONB | No | GHL workflows to note |
| `created_at` | TIMESTAMP | Yes | |
| `updated_at` | TIMESTAMP | Yes | |

**Indexes**: `project_id` (unique)

---

## Table 6: `faq_items`

**Purpose**: FAQ question/answer pairs.

| Column | Type | Required | Notes |
|--------|------|----------|-------|
| `id` | UUID | Yes | PK |
| `project_id` | UUID | Yes | FK → `onboarding_projects.id` |
| `category` | VARCHAR(64) | Yes | `pricing`, `services`, `booking`, `objection`, `location_hours`, `payment`, `competitor`, `other` |
| `question` | TEXT | Yes | |
| `answer` | TEXT | Yes | |
| `sort_order` | INT | No | |
| `source` | ENUM | Yes | `agent`, `operator`, `client` |
| `status` | ENUM | Yes | `draft`, `approved`, `rejected` |
| `approved_by` | VARCHAR(128) | No | `actorId` |
| `created_at` | TIMESTAMP | Yes | |
| `updated_at` | TIMESTAMP | Yes | |

**Indexes**: `(project_id, category)`, `status`

---

## Table 7: `prompt_configs`

**Purpose**: Bot personality, tone, goals, reply settings.

| Column | Type | Required | Notes |
|--------|------|----------|-------|
| `id` | UUID | Yes | PK |
| `project_id` | UUID | Yes | FK → `onboarding_projects.id` |
| `section_status` | ENUM | Yes | `empty`, `partial`, `complete`, `approved`, `rejected` |
| `persona` | TEXT | No | Bot personality description |
| `tone_of_voice` | VARCHAR(64) | No | `friendly`, `professional`, `casual`, `formal` |
| `conversation_goals` | JSONB | No | Array of goal strings |
| `business_notes` | TEXT | No | Business context for bot |
| `language` | VARCHAR(32) | No | `english`, `chinese`, `malay`, etc. |
| `use_singlish` | BOOLEAN | No | |
| `max_reply_length` | INT | No | |
| `example_good_reply` | TEXT | No | |
| `example_bad_reply` | TEXT | No | |
| `greetings` | JSONB | No | Common greetings |
| `sign_offs` | JSONB | No | Common sign-offs |
| `created_at` | TIMESTAMP | Yes | |
| `updated_at` | TIMESTAMP | Yes | |

**Indexes**: `project_id` (unique)

---

## Table 8: `handover_rules`

**Purpose**: Human escalation / handover rules.

| Column | Type | Required | Notes |
|--------|------|----------|-------|
| `id` | UUID | Yes | PK |
| `project_id` | UUID | Yes | FK → `onboarding_projects.id` |
| `section_status` | ENUM | Yes | `empty`, `partial`, `complete`, `approved`, `rejected` |
| `handover_contact_name` | VARCHAR(255) | No | |
| `handover_contact_phone` | VARCHAR(32) | No | Masked |
| `handover_method` | ENUM | No | `sms`, `whatsapp`, `call` |
| `handover_availability` | TEXT | No | |
| `emergency_contact` | VARCHAR(255) | No | |
| `triggers` | JSONB | No | Array of trigger conditions |
| `created_at` | TIMESTAMP | Yes | |
| `updated_at` | TIMESTAMP | Yes | |

**Indexes**: `project_id` (unique)

---

## Table 9: `follow_up_rules`

**Purpose**: Follow-up automation rules.

| Column | Type | Required | Notes |
|--------|------|----------|-------|
| `id` | UUID | Yes | PK |
| `project_id` | UUID | Yes | FK → `onboarding_projects.id` |
| `section_status` | ENUM | Yes | `empty`, `partial`, `complete`, `approved`, `rejected` |
| `enabled` | BOOLEAN | Yes | Default false |
| `goal` | TEXT | No | |
| `tone` | VARCHAR(64) | No | |
| `cadence_hours` | INT | No | Hours between follow-ups |
| `stop_conditions` | JSONB | No | When to stop following up |
| `do_not_message_rules` | JSONB | No | |
| `dormant_reactivation` | BOOLEAN | No | |
| `created_at` | TIMESTAMP | Yes | |
| `updated_at` | TIMESTAMP | Yes | |

**Indexes**: `project_id` (unique)

---

## Table 10: `automation_recommendations`

**Purpose**: AI-suggested automations for Wyn to review.

| Column | Type | Required | Notes |
|--------|------|----------|-------|
| `id` | UUID | Yes | PK |
| `project_id` | UUID | Yes | FK → `onboarding_projects.id` |
| `recommendation_type` | ENUM | Yes | `booking`, `handover`, `follow_up`, `tagging`, `prompt`, `knowledge`, `other` |
| `title` | VARCHAR(255) | Yes | |
| `description` | TEXT | Yes | |
| `rationale` | TEXT | No | Why AI suggests this |
| `risk_level` | ENUM | Yes | `low`, `medium`, `high` |
| `suggested_config` | JSONB | No | Proposed configuration |
| `status` | ENUM | Yes | `suggested`, `accepted`, `rejected`, `modified` |
| `reviewed_by` | VARCHAR(128) | No | `actorId` |
| `reviewed_at` | TIMESTAMP | No | |
| `source` | ENUM | Yes | `ai_analysis`, `operator_manual` |
| `created_at` | TIMESTAMP | Yes | |
| `updated_at` | TIMESTAMP | Yes | |

**Indexes**: `(project_id, recommendation_type)`, `status`

---

## Table 11: `agent_interview_sessions`

**Purpose**: Tracks AI agent interview sessions.

| Column | Type | Required | Notes |
|--------|------|----------|-------|
| `id` | UUID | Yes | PK, `agentSessionId` |
| `project_id` | UUID | Yes | FK → `onboarding_projects.id` |
| `agent_type` | VARCHAR(64) | Yes | `whatsapp_ai`, `web_chat`, etc. |
| `status` | ENUM | Yes | `active`, `paused`, `completed`, `expired` |
| `current_step` | VARCHAR(64) | No | Current interview step |
| `total_steps` | INT | No | Total steps in interview |
| `expires_at` | TIMESTAMP | No | Session timeout |
| `metadata` | JSONB | No | |
| `created_at` | TIMESTAMP | Yes | |
| `updated_at` | TIMESTAMP | Yes | |

**Indexes**: `(project_id, status)`

---

## Table 12: `agent_interview_answers`

**Purpose**: Individual answers submitted by the AI agent.

| Column | Type | Required | Notes |
|--------|------|----------|-------|
| `id` | UUID | Yes | PK |
| `session_id` | UUID | Yes | FK → `agent_interview_sessions.id` |
| `project_id` | UUID | Yes | FK → `onboarding_projects.id` |
| `section` | VARCHAR(64) | Yes | `business_profile`, `sales_process`, `faq`, `prompt`, `handover`, `follow_up` |
| `question_key` | VARCHAR(128) | Yes | Machine-readable key (e.g. `business_name`) |
| `question_label` | VARCHAR(255) | No | Human-readable label |
| `answer_value` | JSONB | Yes | The answer (string, number, array, object) |
| `confidence` | DECIMAL(3,2) | No | AI confidence 0.00-1.00 |
| `source` | ENUM | Yes | `agent`, `client_direct`, `operator_manual` |
| `idempotency_key` | VARCHAR(128) | No | Deduplication key |
| `created_at` | TIMESTAMP | Yes | |
| `updated_at` | TIMESTAMP | Yes | |

**Indexes**: `(session_id, section)`, `(project_id, section, question_key)` unique

---

## Table 13: `approval_events`

**Purpose**: Record of every approval/rejection/change-request action.

| Column | Type | Required | Notes |
|--------|------|----------|-------|
| `id` | UUID | Yes | PK |
| `project_id` | UUID | Yes | FK → `onboarding_projects.id` |
| `actor_id` | VARCHAR(128) | Yes | Who performed the action |
| `actor_type` | ENUM | Yes | `operator`, `agent`, `admin`, `service` |
| `action` | ENUM | Yes | `approve_section`, `reject_section`, `request_changes`, `approve_project`, `reject_project`, `trigger_sync` |
| `target_type` | VARCHAR(64) | Yes | `section`, `project` |
| `target_id` | VARCHAR(128) | Yes | Section name or project ID |
| `comment` | TEXT | No | Reason or feedback |
| `previous_status` | VARCHAR(64) | No | |
| `new_status` | VARCHAR(64) | No | |
| `created_at` | TIMESTAMP | Yes | |

**Indexes**: `(project_id, created_at)`, `actor_id`

---

## Table 14: `sync_runs`

**Purpose**: Records of every sync operation to KB or GHL.

| Column | Type | Required | Notes |
|--------|------|----------|-------|
| `id` | UUID | Yes | PK, `syncRunId` |
| `project_id` | UUID | Yes | FK → `onboarding_projects.id` |
| `target_system` | ENUM | Yes | `kb`, `ghl` |
| `mode` | ENUM | Yes | `dry_run`, `apply`, `rollback` |
| `status` | ENUM | Yes | `pending`, `dry_run_passed`, `dry_run_failed`, `applied`, `apply_failed`, `rolled_back` |
| `idempotency_key` | VARCHAR(128) | Yes | Unique per (project, target, mode, version) |
| `request_payload` | JSONB | No | What was sent |
| `response_payload` | JSONB | No | What was received |
| `error_message` | TEXT | No | |
| `triggered_by` | VARCHAR(128) | Yes | `actorId` |
| `version` | INT | Yes | Incremented on retries |
| `duration_ms` | INT | No | Sync execution time |
| `created_at` | TIMESTAMP | Yes | |
| `completed_at` | TIMESTAMP | No | |

**Indexes**: `project_id`, `idempotency_key` (unique), `(target_system, status)`

---

## Table 15: `audit_events`

**Purpose**: Write audit trail for all mutations.

| Column | Type | Required | Notes |
|--------|------|----------|-------|
| `id` | UUID | Yes | PK |
| `project_id` | UUID | No | Nullable — some events are system-wide |
| `actor_id` | VARCHAR(128) | Yes | Who performed the action |
| `actor_type` | ENUM | Yes | `operator`, `agent`, `admin`, `service` |
| `action` | VARCHAR(128) | Yes | e.g. `project.create`, `answer.submit`, `section.approve` |
| `resource_type` | VARCHAR(64) | Yes | e.g. `project`, `answer`, `sync_run` |
| `resource_id` | VARCHAR(128) | Yes | |
| `changes` | JSONB | No | Before/after diff |
| `ip_address` | VARCHAR(45) | No | |
| `user_agent` | TEXT | No | |
| `correlation_id` | VARCHAR(128) | No | For tracing across services |
| `created_at` | TIMESTAMP | Yes | |

**Indexes**: `(project_id, created_at)`, `actor_id`, `action`

---

## Enums

### `onboarding_project_status`

```
draft → submitted → in_review → changes_requested → approved → syncing → live
Any state → paused
Any state → archived
```

### `section_status`

```
empty → partial → complete → approved
                    ↓
               rejected → partial
```

### `sync_target_system`

```
kb
ghl
```

### `sync_mode`

```
dry_run
apply
rollback
```

### `sync_status`

```
pending
dry_run_passed
dry_run_failed
applied
apply_failed
rolled_back
```

### `actor_type`

```
operator
agent
admin
service
viewer
```

### `recommendation_risk_level`

```
low
medium
high
```

---

## Mock JSON Examples

### Client Profile

```json
{
  "id": "e7c3a1b9-4f2d-4a1e-8c5d-9f3b2a1e4d7c",
  "client_key": "dapperdogs",
  "display_name": "Dapper Dogs",
  "contact_name": "James Tan",
  "contact_phone": "+65****1234",
  "contact_email": "james@dapperdogs.sg",
  "whatsapp_phone": "+65****1234",
  "industry": "Pet Grooming",
  "website_url": "https://dapperdogs.sg",
  "timezone": "Asia/Singapore",
  "status": "active"
}
```

### Onboarding Project

```json
{
  "id": "f8d4c2a0-5e3b-4f2c-9d6e-0a4c3b2f5e8d",
  "client_id": "e7c3a1b9-4f2d-4a1e-8c5d-9f3b2a1e4d7c",
  "status": "in_review",
  "current_phase": "review",
  "version": 1,
  "submitted_at": "2026-06-26T10:30:00Z",
  "display_label": "Dapper Dogs · dapperdogs"
}
```

### Identity Map

```json
{
  "id": "a1b2c3d4-5e6f-7a8b-9c0d-1e2f3a4b5c6d",
  "project_id": "f8d4c2a0-5e3b-4f2c-9d6e-0a4c3b2f5e8d",
  "onboard_client_id": "e7c3a1b9-4f2d-4a1e-8c5d-9f3b2a1e4d7c",
  "kb_tenant_id": "34c62859-7a1b-4c2d-9e3f-5a6b7c8d9e0f",
  "ghl_location_id": "kfmh8xHdo4KFVLO43BWI",
  "ghl_contact_id": "kfmh8xHdo4KFVLO43BWI",
  "ghl_conversation_id": "b6bac998"
}
```

### Business Profile

```json
{
  "id": "b2c3d4e5-6f7a-8b9c-0d1e-2f3a4b5c6d7e",
  "project_id": "f8d4c2a0-5e3b-4f2c-9d6e-0a4c3b2f5e8d",
  "section_status": "complete",
  "business_name": "Dapper Dogs",
  "description": "Premium dog grooming salon in Tiong Bahru, Singapore. Full-service grooming, spa treatments, and retail.",
  "services": [
    {"name": "Basic Groom", "price": "S$45-65", "duration": "60 min"},
    {"name": "Full Groom", "price": "S$80-120", "duration": "90-120 min"},
    {"name": "Spa Package", "price": "S$150", "duration": "120 min"}
  ],
  "pricing_policy": "Prices vary by breed and size. Quotes given before service.",
  "opening_hours": {
    "mon": "10:00-19:00",
    "tue": "10:00-19:00",
    "wed": "closed",
    "thu": "10:00-19:00",
    "fri": "10:00-19:00",
    "sat": "09:00-18:00",
    "sun": "09:00-17:00"
  },
  "forbidden_topics": ["medical advice", "veterinary diagnosis"],
  "forbidden_claims": ["guaranteed results", "same-day availability without booking"]
}
```

### FAQ Item

```json
{
  "id": "c3d4e5f6-7a8b-9c0d-1e2f-3a4b5c6d7e8f",
  "project_id": "f8d4c2a0-5e3b-4f2c-9d6e-0a4c3b2f5e8d",
  "category": "pricing",
  "question": "How much does a full groom cost?",
  "answer": "Full grooming ranges from S$80 to S$120 depending on your dog's breed and size. We'll give you an exact quote before starting.",
  "source": "agent",
  "status": "draft"
}
```

### Prompt Config

```json
{
  "id": "d4e5f6a7-8b9c-0d1e-2f3a-4b5c6d7e8f9a",
  "project_id": "f8d4c2a0-5e3b-4f2c-9d6e-0a4c3b2f5e8d",
  "section_status": "complete",
  "persona": "You are a friendly and knowledgeable dog grooming consultant for Dapper Dogs.",
  "tone_of_voice": "friendly",
  "conversation_goals": ["book_appointment", "answer_faqs"],
  "language": "english",
  "use_singlish": true,
  "max_reply_length": 300
}
```

### Handover Rule

```json
{
  "id": "e5f6a7b8-9c0d-1e2f-3a4b-5c6d7e8f9a0b",
  "project_id": "f8d4c2a0-5e3b-4f2c-9d6e-0a4c3b2f5e8d",
  "section_status": "partial",
  "handover_contact_name": "James Tan",
  "handover_contact_phone": "+65****1234",
  "handover_method": "whatsapp",
  "triggers": ["customer_angry", "refund_request", "customer_asks_for_human"]
}
```

### Follow-up Rule

```json
{
  "id": "f6a7b8c9-0d1e-2f3a-4b5c-6d7e8f9a0b1c",
  "project_id": "f8d4c2a0-5e3b-4f2c-9d6e-0a4c3b2f5e8d",
  "section_status": "empty",
  "enabled": false
}
```

### Automation Recommendation

```json
{
  "id": "a7b8c9d0-1e2f-3a4b-5c6d-7e8f9a0b1c2d",
  "project_id": "f8d4c2a0-5e3b-4f2c-9d6e-0a4c3b2f5e8d",
  "recommendation_type": "booking",
  "title": "Enable automated appointment booking",
  "description": "Dapper Dogs has clear services with durations. Customers frequently ask about availability and pricing. Automated booking would reduce back-and-forth.",
  "rationale": "Service-based business with defined time slots, clear pricing, and high booking intent in conversations.",
  "risk_level": "low",
  "suggested_config": {
    "calendar_provider": "ghl",
    "required_fields": ["name", "phone", "breed", "service"],
    "buffer_minutes": 15
  },
  "status": "suggested",
  "source": "ai_analysis"
}
```

### Agent Interview Session

```json
{
  "id": "b8c9d0e1-2f3a-4b5c-6d7e-8f9a0b1c2d3e",
  "project_id": "f8d4c2a0-5e3b-4f2c-9d6e-0a4c3b2f5e8d",
  "agent_type": "whatsapp_ai",
  "status": "active",
  "current_step": "faq_pricing",
  "total_steps": 12,
  "expires_at": "2026-06-27T10:30:00Z"
}
```

### Agent Interview Answer

```json
{
  "id": "c9d0e1f2-3a4b-5c6d-7e8f-9a0b1c2d3e4f",
  "session_id": "b8c9d0e1-2f3a-4b5c-6d7e-8f9a0b1c2d3e",
  "project_id": "f8d4c2a0-5e3b-4f2c-9d6e-0a4c3b2f5e8d",
  "section": "business_profile",
  "question_key": "business_name",
  "question_label": "What is your business name?",
  "answer_value": "Dapper Dogs",
  "confidence": 0.98,
  "source": "client_direct"
}
```

### Approval Event

```json
{
  "id": "d0e1f2a3-4b5c-6d7e-8f9a-0b1c2d3e4f5a",
  "project_id": "f8d4c2a0-5e3b-4f2c-9d6e-0a4c3b2f5e8d",
  "actor_id": "wyn-operator",
  "actor_type": "operator",
  "action": "approve_section",
  "target_type": "section",
  "target_id": "business_profile",
  "comment": "Looks good. Pricing is accurate.",
  "previous_status": "complete",
  "new_status": "approved"
}
```

### Audit Event

```json
{
  "id": "e1f2a3b4-5c6d-7e8f-9a0b-1c2d3e4f5a6b",
  "project_id": "f8d4c2a0-5e3b-4f2c-9d6e-0a4c3b2f5e8d",
  "actor_id": "whatsapp-agent-01",
  "actor_type": "agent",
  "action": "answer.submit",
  "resource_type": "answer",
  "resource_id": "c9d0e1f2-3a4b-5c6d-7e8f-9a0b1c2d3e4f",
  "changes": {
    "section": "business_profile",
    "question_key": "business_name",
    "previous_value": null,
    "new_value": "Dapper Dogs"
  },
  "correlation_id": "req-abc123"
}
```

### KB Sync Dry-Run

```json
{
  "id": "f2a3b4c5-6d7e-8f9a-0b1c-2d3e4f5a6b7c",
  "project_id": "f8d4c2a0-5e3b-4f2c-9d6e-0a4c3b2f5e8d",
  "target_system": "kb",
  "mode": "dry_run",
  "status": "dry_run_passed",
  "idempotency_key": "sha256:f8d4c2a0-kb-dry_run-v1",
  "request_payload": {
    "tenant_name": "Dapper Dogs",
    "ghl_location_id": "kfmh8xHdo4KFVLO43BWI",
    "bot_profile": {},
    "knowledge_vault": {}
  },
  "response_payload": {
    "changes_detected": true,
    "new_tenant": true,
    "new_knowledge_items": 15,
    "new_prompt_config": true
  },
  "triggered_by": "wyn-operator",
  "version": 1,
  "duration_ms": 450
}
```

### KB Sync Apply

```json
{
  "id": "a3b4c5d6-7e8f-9a0b-1c2d-3e4f5a6b7c8d",
  "project_id": "f8d4c2a0-5e3b-4f2c-9d6e-0a4c3b2f5e8d",
  "target_system": "kb",
  "mode": "apply",
  "status": "applied",
  "idempotency_key": "sha256:f8d4c2a0-kb-apply-v1",
  "request_payload": {
    "tenant_name": "Dapper Dogs",
    "kb_tenant_id": "34c62859-7a1b-4c2d-9e3f-5a6b7c8d9e0f"
  },
  "response_payload": {
    "success": true,
    "kb_tenant_id": "34c62859-7a1b-4c2d-9e3f-5a6b7c8d9e0f",
    "knowledge_items_created": 15,
    "prompt_config_created": true
  },
  "triggered_by": "wyn-operator",
  "version": 1,
  "duration_ms": 1200
}
```

### GHL Sync Plan

```json
{
  "id": "b4c5d6e7-8f9a-0b1c-2d3e-4f5a6b7c8d9e",
  "project_id": "f8d4c2a0-5e3b-4f2c-9d6e-0a4c3b2f5e8d",
  "target_system": "ghl",
  "mode": "dry_run",
  "status": "dry_run_passed",
  "idempotency_key": "sha256:f8d4c2a0-ghl-dry_run-v1",
  "request_payload": {
    "ghl_location_id": "kfmh8xHdo4KFVLO43BWI",
    "validate_only": true
  },
  "response_payload": {
    "location_valid": true,
    "connection_status": "connected",
    "calendar_accessible": true,
    "contact_exists": true,
    "warnings": ["no_workflows_detected"]
  }
}
```

### Sync Result

```json
{
  "id": "c5d6e7f8-9a0b-1c2d-3e4f-5a6b7c8d9e0f",
  "project_id": "f8d4c2a0-5e3b-4f2c-9d6e-0a4c3b2f5e8d",
  "target_system": "kb",
  "mode": "apply",
  "status": "applied",
  "triggered_by": "wyn-operator",
  "duration_ms": 1200
}
```
