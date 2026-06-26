# AISBP-Onboard No-Env API Request Cookbook — 2026-06-27

> **All placesholders. No real tokens. No real URLs. No secrets.**
> **Do not run against production.**

## Placeholders

| Placeholder | Description |
|-------------|-------------|
| `<ONBOARD_API_BASE_URL>` | e.g. `http://localhost:3001/api/v1` after backend is started |
| `<OPERATOR_JWT>` | Supabase JWT from logging in as operator |
| `<ONBOARD_AGENT_API_TOKEN>` | Token set in `ONBOARD_AGENT_API_TOKEN` env var |
| `<PROJECT_ID>` | UUID of the created onboarding project |
| `<CLIENT_ID>` | UUID of the created onboard client |
| `<SESSION_ID>` | UUID from agent session creation |
| `<SYNC_RUN_ID>` | UUID from KB dry-run response |

---

## Agent API Requests

### Create Agent Session
```bash
curl -X POST <ONBOARD_API_BASE_URL>/onboard/agent/sessions \
  -H "Authorization: Bearer <ONBOARD_AGENT_API_TOKEN>" \
  -H "Content-Type: application/json" \
  -d '{
    "projectId": "<PROJECT_ID>",
    "agentType": "whatsapp_ai"
  }'
```

### Get Session
```bash
curl <ONBOARD_API_BASE_URL>/onboard/agent/sessions/<SESSION_ID> \
  -H "Authorization: Bearer <ONBOARD_AGENT_API_TOKEN>"
```

### Submit Answers
```bash
curl -X POST <ONBOARD_API_BASE_URL>/onboard/agent/sessions/<SESSION_ID>/answers \
  -H "Authorization: Bearer <ONBOARD_AGENT_API_TOKEN>" \
  -H "Content-Type: application/json" \
  -d '{
    "answers": [
      {
        "section": "business_profile",
        "questionKey": "business_name",
        "questionLabel": "What is your business name?",
        "answerValue": "Pilot Test Business",
        "confidence": 0.98,
        "source": "client_direct"
      },
      {
        "section": "prompt",
        "questionKey": "persona",
        "questionLabel": "How should the bot sound?",
        "answerValue": "Friendly and professional.",
        "confidence": 0.92,
        "source": "client_direct"
      },
      {
        "section": "faq",
        "questionKey": "faq_pricing",
        "questionLabel": "What are your prices?",
        "answerValue": "Our services range from $10 to $50.",
        "confidence": 0.90,
        "source": "client_direct"
      }
    ]
  }'
```

### Submit Analysis
```bash
curl -X POST <ONBOARD_API_BASE_URL>/onboard/agent/projects/<PROJECT_ID>/analysis \
  -H "Authorization: Bearer <ONBOARD_AGENT_API_TOKEN>" \
  -H "Content-Type: application/json" \
  -d '{
    "summary": "Test business with simple lead flow.",
    "leadSources": ["website", "whatsapp"],
    "confidence": 0.85,
    "recommendations": [
      {
        "title": "Auto-reply to new WhatsApp leads",
        "description": "Instantly respond with qualifying questions.",
        "type": "FOLLOW_UP",
        "riskLevel": "LOW",
        "businessValue": "Reduce response time."
      }
    ]
  }'
```

### Get Missing Fields
```bash
curl <ONBOARD_API_BASE_URL>/onboard/agent/projects/<PROJECT_ID>/missing-fields \
  -H "Authorization: Bearer <ONBOARD_AGENT_API_TOKEN>"
```

### Request Review
```bash
curl -X POST <ONBOARD_API_BASE_URL>/onboard/agent/projects/<PROJECT_ID>/request-review \
  -H "Authorization: Bearer <ONBOARD_AGENT_API_TOKEN>" \
  -H "Content-Type: application/json" \
  -d '{}'
```

### Get Project Status
```bash
curl <ONBOARD_API_BASE_URL>/onboard/agent/projects/<PROJECT_ID>/status \
  -H "Authorization: Bearer <ONBOARD_AGENT_API_TOKEN>"
```

---

## Operator API Requests

### Create Client
```bash
curl -X POST <ONBOARD_API_BASE_URL>/onboard/clients \
  -H "Authorization: Bearer <OPERATOR_JWT>" \
  -H "Content-Type: application/json" \
  -d '{
    "clientKey": "pilot-test",
    "displayName": "Pilot Test Business",
    "contactName": "Test Owner",
    "contactPhone": "+6500001111",
    "contactEmail": "test@example.com",
    "industry": "Testing",
    "timezone": "Asia/Singapore"
  }'
```

### List Clients
```bash
curl <ONBOARD_API_BASE_URL>/onboard/clients \
  -H "Authorization: Bearer <OPERATOR_JWT>"
```

### Get Client
```bash
curl <ONBOARD_API_BASE_URL>/onboard/clients/<CLIENT_ID> \
  -H "Authorization: Bearer <OPERATOR_JWT>"
```

### Update Client
```bash
curl -X PATCH <ONBOARD_API_BASE_URL>/onboard/clients/<CLIENT_ID> \
  -H "Authorization: Bearer <OPERATOR_JWT>" \
  -H "Content-Type: application/json" \
  -d '{
    "displayName": "Updated Test Business"
  }'
```

### Create Project
```bash
curl -X POST <ONBOARD_API_BASE_URL>/onboard/projects \
  -H "Authorization: Bearer <OPERATOR_JWT>" \
  -H "Content-Type: application/json" \
  -d '{
    "onboardClientId": "<CLIENT_ID>"
  }'
```

### List Projects
```bash
curl <ONBOARD_API_BASE_URL>/onboard/projects \
  -H "Authorization: Bearer <OPERATOR_JWT>"
```

### Get Project
```bash
curl <ONBOARD_API_BASE_URL>/onboard/projects/<PROJECT_ID> \
  -H "Authorization: Bearer <OPERATOR_JWT>"
```

---

## Approval API Requests

### Approve Section
```bash
curl -X POST <ONBOARD_API_BASE_URL>/onboard/projects/<PROJECT_ID>/sections/business_profile/approve \
  -H "Authorization: Bearer <OPERATOR_JWT>" \
  -H "Content-Type: application/json" \
  -d '{"comment": "Looks good."}'
```

### Request Changes
```bash
curl -X POST <ONBOARD_API_BASE_URL>/onboard/projects/<PROJECT_ID>/request-changes \
  -H "Authorization: Bearer <OPERATOR_JWT>" \
  -H "Content-Type: application/json" \
  -d '{
    "comment": "Please update pricing information.",
    "rejectedSections": ["faq"]
  }'
```

### Reject Project
```bash
curl -X POST <ONBOARD_API_BASE_URL>/onboard/projects/<PROJECT_ID>/reject \
  -H "Authorization: Bearer <OPERATOR_JWT>" \
  -H "Content-Type: application/json" \
  -d '{"comment": "Needs major revisions."}'
```

### Final Approve Project
```bash
curl -X POST <ONBOARD_API_BASE_URL>/onboard/projects/<PROJECT_ID>/approve \
  -H "Authorization: Bearer <OPERATOR_JWT>" \
  -H "Content-Type: application/json" \
  -d '{"comment": "All sections approved. Ready for sync."}'
```

---

## KB Sync API Requests

### KB Dry-Run
```bash
curl -X POST <ONBOARD_API_BASE_URL>/onboard/projects/<PROJECT_ID>/sync/kb/dry-run \
  -H "Authorization: Bearer <OPERATOR_JWT>" \
  -H "Content-Type: application/json" \
  -d '{}'
```

### KB Apply — Tenant Identity
```bash
# Requires ONBOARD_KB_SYNC_ENABLED=true in backend .env
curl -X POST <ONBOARD_API_BASE_URL>/onboard/projects/<PROJECT_ID>/sync/kb/apply \
  -H "Authorization: Bearer <OPERATOR_JWT>" \
  -H "Content-Type: application/json" \
  -d '{
    "syncRunId": "<SYNC_RUN_ID>",
    "confirmApply": true,
    "idempotencyKey": "pilot-apply-001",
    "applyScope": "TENANT_IDENTITY_ONLY",
    "operatorNote": "Test tenant apply."
  }'
```

### KB Apply — Bot Profile
```bash
curl -X POST <ONBOARD_API_BASE_URL>/onboard/projects/<PROJECT_ID>/sync/kb/apply \
  -H "Authorization: Bearer <OPERATOR_JWT>" \
  -H "Content-Type: application/json" \
  -d '{
    "syncRunId": "<SYNC_RUN_ID>",
    "confirmApply": true,
    "idempotencyKey": "pilot-apply-002",
    "applyScope": "BOT_PROFILE_PROMPT_ONLY"
  }'
```

### KB Apply — FAQ
```bash
curl -X POST <ONBOARD_API_BASE_URL>/onboard/projects/<PROJECT_ID>/sync/kb/apply \
  -H "Authorization: Bearer <OPERATOR_JWT>" \
  -H "Content-Type: application/json" \
  -d '{
    "syncRunId": "<SYNC_RUN_ID>",
    "confirmApply": true,
    "idempotencyKey": "pilot-apply-003",
    "applyScope": "FAQ_KNOWLEDGE_ONLY"
  }'
```

### KB Apply — Booking/Handover
```bash
curl -X POST <ONBOARD_API_BASE_URL>/onboard/projects/<PROJECT_ID>/sync/kb/apply \
  -H "Authorization: Bearer <OPERATOR_JWT>" \
  -H "Content-Type: application/json" \
  -d '{
    "syncRunId": "<SYNC_RUN_ID>",
    "confirmApply": true,
    "idempotencyKey": "pilot-apply-004",
    "applyScope": "BOOKING_HANDOVER_ONLY"
  }'
```

### KB Apply — Follow-Up
```bash
curl -X POST <ONBOARD_API_BASE_URL>/onboard/projects/<PROJECT_ID>/sync/kb/apply \
  -H "Authorization: Bearer <OPERATOR_JWT>" \
  -H "Content-Type: application/json" \
  -d '{
    "syncRunId": "<SYNC_RUN_ID>",
    "confirmApply": true,
    "idempotencyKey": "pilot-apply-005",
    "applyScope": "FOLLOW_UP_SETTINGS_ONLY"
  }'
```

### Get Sync Runs
```bash
curl <ONBOARD_API_BASE_URL>/onboard/projects/<PROJECT_ID>/sync-runs \
  -H "Authorization: Bearer <OPERATOR_JWT>"
```

### Get KB Plan Preview
```bash
curl <ONBOARD_API_BASE_URL>/onboard/projects/<PROJECT_ID>/sync/kb/plan-preview \
  -H "Authorization: Bearer <OPERATOR_JWT>"
```

---

## GHL API Requests

### GHL Validate
```bash
curl -X POST <ONBOARD_API_BASE_URL>/onboard/projects/<PROJECT_ID>/sync/ghl/validate \
  -H "Authorization: Bearer <OPERATOR_JWT>" \
  -H "Content-Type: application/json" \
  -d '{}'
```

### GHL Dry-Run
```bash
curl -X POST <ONBOARD_API_BASE_URL>/onboard/projects/<PROJECT_ID>/sync/ghl/dry-run \
  -H "Authorization: Bearer <OPERATOR_JWT>" \
  -H "Content-Type: application/json" \
  -d '{}'
```

---

## Notification API

### Get Review Alerts
```bash
curl <ONBOARD_API_BASE_URL>/onboard/notifications/review-alerts \
  -H "Authorization: Bearer <OPERATOR_JWT>"
```

---

## Agent CANNOT Do These (Should Return 401/403)

```bash
# Agent tries to approve → BLOCKED
curl -X POST <ONBOARD_API_BASE_URL>/onboard/projects/<PROJECT_ID>/sections/business_profile/approve \
  -H "Authorization: Bearer <ONBOARD_AGENT_API_TOKEN>" \
  -H "Content-Type: application/json" \
  -d '{"comment": "Should fail."}'

# Agent tries KB dry-run → BLOCKED
curl -X POST <ONBOARD_API_BASE_URL>/onboard/projects/<PROJECT_ID>/sync/kb/dry-run \
  -H "Authorization: Bearer <ONBOARD_AGENT_API_TOKEN>" \
  -H "Content-Type: application/json" \
  -d '{}'

# Agent tries KB apply → BLOCKED
curl -X POST <ONBOARD_API_BASE_URL>/onboard/projects/<PROJECT_ID>/sync/kb/apply \
  -H "Authorization: Bearer <ONBOARD_AGENT_API_TOKEN>" \
  -H "Content-Type: application/json" \
  -d '{"syncRunId": "<SYNC_RUN_ID>", "confirmApply": true, "idempotencyKey": "x"}'
```

---

**Do not run against production. No live WhatsApp/GHL tests. No messages should be sent.**
