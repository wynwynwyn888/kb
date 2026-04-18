# Backend — AI SaaS Business Platform

## Local Dev Setup

### Prerequisites
- Node.js 20+
- pnpm 9+
- PostgreSQL database (local or Supabase)
- Redis (for BullMQ job queues)

### Environment Variables

Create `.env` at `apps/backend/.env`:

```
DATABASE_URL=postgresql://user:password@localhost:5432/aisbp
SUPABASE_SERVICE_ROLE_KEY=your_service_role_key
JWT_SECRET=your_jwt_secret_min_32_chars
REDIS_HOST=localhost
REDIS_PORT=6379
GHL_API_BASE=https://services.leadconnectorhq.com
OPENAI_API_KEY=sk-...          # Optional — enables live LLM generation
ANTHROPIC_API_KEY=sk-ant-...    # Optional — future provider
```

### Install & Run

```bash
# Install dependencies
npm exec -y pnpm@latest -- install

# Push schema to DB (requires DATABASE_URL)
cd apps/backend && node node_modules/.bin/prisma db push

# Run dev server
cd apps/backend && node node_modules/@nestjs/cli/bin/nest.js start --watch
```

### Seed / Demo Data

```bash
cd apps/backend && node node_modules/.bin/tsx prisma/seed.ts
```

## Scripts

```bash
# Typecheck
cd apps/backend && node node_modules/typescript/bin/tsc --noEmit

# Run tests
cd apps/backend && node node_modules/.bin/jest --no-cache

# Run tests with coverage
cd apps/backend && node node_modules/.bin/jest --coverage

# Build
cd apps/backend && node node_modules/@nestjs/cli/bin/nest.js build

# Frontend typecheck
cd apps/frontend && node node_modules/typescript/bin/tsc --noEmit
```

## Critical Runtime Flow

```
GHL Webhook
    │
    ▼
WebhooksService.handleGhlWebhook()
    │  3-tier dedupe (Tier1: GHL message ID → Tier2: derived → Tier3: SHA-256 hash)
    │  Persists webhook_event
    ▼
InboundMessageProcessor.process()  [BullMQ job]
    │
    ├──→ OrchestrationService.orchestrate()
    │       │
    │       ├──→ OrchestrationGuards.runGuards()  [cascade, short-circuit]
    │       │       bot_enabled → ghl_connected → handover_paused
    │       │       → quota_available → message_type → channel
    │       │
    │       ├──→ ConversationMemoryLoader.loadMemory()
    │       │
    │       ├──→ KbService.retrieve()
    │       │       Stage 1: keyword fallback (active)
    │       │       Stage 2: vector search (TODO — pgvector not active)
    │       │
    │       ├──→ AiRouterService.route()
    │       │       Pure routing — selects model + responseMode
    │       │       (No generation here)
    │       │
    │       └──→ ReplyPlannerService.planReply()
    │               Attempts live generation via GenerationService
    │               Falls back to deterministic placeholder if:
    │                 - No provider configured
    │                 - Generation fails
    │               Fallback chain: KB-first → mode ack → memory ref → generic
    │
    ├──→ [If PROCEED + bubbles] → SendBubbleProcessor.process()  [BullMQ job]
    │       │
    │       ├──→ OutboundSendService.sendReply()
    │       │       Sequential bubble send via GHL API
    │       │       Quota debit: 1 unit per successfully sent bubble
    │       │       No debit on failure
    │       │
    │       ├──→ [If HANDOVER plan] → ConversationsService.pauseForHandover()
    │       │       Creates HandoverEvent (ACTIVE) + sets Conversation.status = HANDOVER
    │       │
    │       └──→ [If suggestedActions] → ActionGatingService.gateActions()
    │               All known action types → DEFERRED (no executor ready)
    │               Unknown types → BLOCKED
    │
    └──→ [If HANDOVER] → HandoverNotifyProcessor.process()  [BullMQ job]
            Sends notification to human agent (future)
```

## What Is Tested

| Flow | Test Coverage |
|------|--------------|
| Webhook dedupe key extraction (3 tiers) | Unit test |
| Orchestration guards (all 6) | Unit test |
| KB keyword scoring + ranking | Unit test |
| Reply planner deterministic fallback | Unit test |
| Bubble formatting + markdown strip | Unit test |
| Quota debit on success (per-bubble) | Unit test |
| No quota debit on failure | Unit test |
| Handover pause / resume / idempotent | Unit test |
| Action gating DEFERRED / BLOCKED mapping | Unit test |
| Action gating idempotency (unique index) | Unit test + schema |
| Conversation upsert race condition | DB constraint |
| Happy-path orchestration pipeline | Integration test |
| JSON parse error logging in send processor | Hardened |

## What Is Still Placeholder / TODO

| Item | Status | Notes |
|------|--------|-------|
| QuotasService deduct/credit/reset | Not implemented | OutboundSendService handles debit directly |
| KB vector search | Not active | Keyword fallback works; vector needs pgvector |
| Live LLM generation | Configured | Requires `OPENAI_API_KEY` + agency provider config |
| Booking slot execution | Not implemented | Action gating DEFERRED; no executor ready |
| Tag contact execution | Not implemented | Same — DEFERRED |
| Notification sending | Not implemented | HandoverNotifyProcessor exists but is stub |
| Cost / count tracking | Not implemented | Future phase |
| Rate limit handling per provider | Not implemented | Basic timeout only |

## Architecture Notes

- **Tenant isolation**: All controller and service methods enforce tenant scoping via `@CurrentTenantId()` decorator
- **BullMQ job queues**: All heavy work (inbound processing, sending) is async via job queues
- **Supabase direct access**: Service-layer uses Supabase service-role client (bypasses RLS) for reliability
- **Encryption**: `safeLog()` helper strips sensitive fields from logs; API keys are encrypted at rest
- **Idempotency**: Webhook dedupe (3-tier), handover event creation (idempotent check), action intent (unique constraint)
