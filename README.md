# AI SaaS Business Platform - Monorepo

## Overview

Multi-tenant white-label SaaS platform that sits between GoHighLevel (GHL) and AI models. Acts as an AI conversation middleware for agency use.

**Production Domain**: `https://kb.aisalesbot.pro`

## Tech Stack

- **Frontend**: Next.js 14+ (App Router)
- **Backend**: NestJS
- **Database**: Supabase (Postgres)
- **Auth**: Supabase Auth
- **Queue**: Redis + BullMQ
- **Language**: TypeScript everywhere

## Repository Structure

```
aisbp/
├── apps/
│   ├── backend/     # NestJS API + workers
│   │   ├── prisma/  # Database schema and migrations
│   │   └── src/
│   └── frontend/    # Next.js dashboard
├── packages/
│   └── types/       # Shared TypeScript types
├── package.json
├── pnpm-workspace.yaml
└── turbo.json
```

## Quick Start (localhost)

Use this flow while you iterate locally; VPS or cloud deploy can come later.

### Prerequisites

- Node.js 20+
- pnpm 9 (`corepack enable && corepack prepare pnpm@9.0.0 --activate`)
- Docker (recommended for **Redis**; optional for full local Supabase via the [Supabase CLI](https://supabase.com/docs/guides/cli/getting-started))

### 1. Redis (required for queues)

```bash
docker run -d --name aisbp-redis -p 6379:6379 redis:7-alpine
```

Backend defaults: `REDIS_HOST=localhost`, `REDIS_PORT=6379` (see `apps/backend/.env.example`).

### 2. Supabase (Auth + Postgres)

Pick one:

- **Hosted (simplest):** create a project at [supabase.com](https://supabase.com/dashboard), then copy `SUPABASE_URL`, anon key, service role key, and the **Database** connection string for `DATABASE_URL`.
- **Local stack:** install the Supabase CLI and run `supabase start` in a directory where you keep your local project (or link this repo after `supabase init`). Use the CLI-printed URL and keys in `.env` / `.env.local`. Default API URL is often `http://127.0.0.1:54321`.

### 3. Configure environment

```bash
pnpm install

cp apps/backend/.env.example apps/backend/.env
# Edit apps/backend/.env — DATABASE_URL, SUPABASE_*, JWT_SECRET, ENCRYPTION_KEY, Redis if non-default

cp apps/frontend/.env.example apps/frontend/.env.local
# Edit apps/frontend/.env.local — NEXT_PUBLIC_SUPABASE_* (same project as backend)
```

The browser talks to the Next app on **:3000**; `/api/v1/*` is proxied to Nest on **:3001** (see `apps/frontend/src/lib/server/proxy-to-nest.ts`). You usually do **not** need a separate public API URL in the frontend env.

### 4. Database schema and demo data

```bash
pnpm --filter @aisbp/backend exec prisma generate
pnpm --filter @aisbp/backend exec prisma migrate dev
# or, for a quick throwaway DB without migration history: pnpm --filter @aisbp/backend run db:push

pnpm --filter @aisbp/backend run db:seed
```

The seed creates a demo agency, two tenants, and four users (see **Demo Credentials** below).

### 5. Run dev servers

From the **repository root**:

```bash
pnpm dev
```

- App (Next): [http://localhost:3000](http://localhost:3000)
- Nest (direct): [http://localhost:3001/api/v1](http://localhost:3001/api/v1)
- Swagger: [http://localhost:3001/docs](http://localhost:3001/docs) — also proxied at [http://localhost:3000/docs](http://localhost:3000/docs) when both are running

## Production Deployment

### Domain Configuration

- **App URL**: `https://kb.aisalesbot.pro`
- **Backend API**: `https://kb.aisalesbot.pro/api/v1`
- **Supabase**: Use your Supabase project URL (configured in dashboard)

### Environment Variables for Production

**Backend (.env)**
```
NODE_ENV=production
CORS_ORIGIN=https://kb.aisalesbot.pro
SUPABASE_URL=https://your-project.supabase.co
GHL_REDIRECT_URI=https://kb.aisalesbot.pro/api/v1/ghl/oauth/callback
```

**Frontend (.env.local)**
```
NEXT_PUBLIC_SUPABASE_URL=https://your-project.supabase.co
NEXT_PUBLIC_SUPABASE_ANON_KEY=...
NEXT_PUBLIC_APP_URL=https://kb.aisalesbot.pro
```
API calls from the browser use same-origin `/api/v1` (Next BFF → Nest); set `BACKEND_URL` / `BACKEND_DEV_URL` only when deploying or customizing the server-side proxy.

## Demo Credentials

After running `pnpm db:seed`:

| User | Email | Password | Access Level |
|------|-------|----------|--------------|
| Agency Admin | agency-admin@demo.aisbp.com | Demo123! | Can see all tenants in agency |
| Agency Operator | agency-operator@demo.aisbp.com | Demo123! | Can see all tenants in agency |
| Tenant A Admin | tenant-a-admin@demo.aisbp.com | Demo123! | Can see only Tenant A |
| Tenant B User | tenant-b-user@demo.aisbp.com | Demo123! | Can see only Tenant B |

## Architecture Principles

- **Strict tenant isolation everywhere** - every query filters by tenant
- **Supabase Auth for authentication** - we own authorization/tenancy
- **GHL is channel rail, NOT source of truth** for bot state
- **Our platform owns**: conversation memory, prompt stack, KB retrieval, handover state, quota state, analytics
- **No giant god files** - keep modules small and focused

## Key Files

- `apps/backend/prisma/schema.prisma` - Database schema
- `apps/backend/src/lib/supabase/` - Supabase client configuration
- `apps/backend/src/modules/auth/` - Auth service and guards
- `apps/frontend/src/contexts/AuthContext.tsx` - Frontend auth state
- `apps/backend/prisma/rls/RLS_PLAN.md` - Row Level Security plan

## TODO (Next Steps)

1. GHL OAuth integration and webhook handling
2. AI model provider adapters
3. Knowledge base with embeddings (pgvector)
4. Message formatter and bubble splitting
5. Queue workers for async processing

## GHL Private Integration Setup

### Overview

Each tenant can connect their GHL subaccount using a Private Integration token. This is NOT the Marketplace OAuth flow - it's a direct API token per location.

### Connection Flow

1. User navigates to tenant settings page
2. Enters their GHL Location ID and Private Integration token
3. Backend verifies token against GHL API
4. If valid, token is encrypted and stored
5. Connection status is shown in dashboard

### Getting GHL Private Integration Token

1. Log into GHL as account owner
2. Go to Settings → Integrations → Private Integrations
3. Create a new integration or use existing
4. Copy the access token (keep it secure - it's shown only once)

### API Endpoints

| Method | Endpoint | Description |
|--------|----------|-------------|
| GET | `/tenants/:id/ghl/connection` | Get connection status |
| POST | `/tenants/:id/ghl/connection` | Save/update connection |
| POST | `/tenants/:id/ghl/verify` | Verify existing connection |
| GET | `/tenants/:id/ghl/health` | Health check |
| DELETE | `/tenants/:id/ghl/connection` | Disconnect |
| POST | `/webhooks/ghl` | Receive inbound GHL webhook events |

### Security

- Private Integration tokens are encrypted at rest using AES-256-GCM
- ENCRYPTION_KEY must be exactly 32 UTF-8 characters (fails fast if missing in production)
- Raw tokens are NEVER returned in API responses
- Only masked identifiers are exposed to frontend
- Logs are sanitized to prevent token leakage
- GHL Private Integration tokens are static bearer tokens (no OAuth-style refresh)

### Webhook Setup

**Endpoint**: `POST https://kb.aisalesbot.pro/api/v1/webhooks/ghl`

GHL delivers inbound message events to this endpoint. No authentication is used — identity is established via the `locationId` field in the payload, matched against registered tenant connections.

**Expected Payload Shape**:
```json
{
  "locationId": "abc123",
  "event": "inbound_message",
  "data": {
    "conversationId": "conv-456",
    "contactId": "contact-789",
    "message": "Hello",
    "messageType": "text",
    "id": "msg-001"
  },
  "timestamp": "2026-04-18T10:00:00Z"
}
```

**Dedupe Strategy**:
- Tier 1: Use `data.id` if present (GHL's message ID)
- Tier 2: Derive `GHL|{locationId}|{conversationId}|{event}|{timestamp}`
- Tier 3: SHA-256 hash of sparse payload fields (last resort)

**Channel Handling**: Channel is stored raw from GHL payload if present, otherwise NULL (inference deferred to future layer).

**Testing Locally**:
```bash
# With backend running on localhost:3001
curl -X POST http://localhost:3001/api/v1/webhooks/ghl \
  -H "Content-Type: application/json" \
  -d '{
    "locationId": "test-location-123",
    "event": "inbound_message",
    "data": {
      "conversationId": "conv-001",
      "contactId": "contact-001",
      "message": "Hello world",
      "messageType": "text",
      "id": "test-msg-001"
    },
    "timestamp": "2026-04-18T10:00:00Z"
  }'
```

**What Happens**:
1. Webhook acknowledged (200 OK) immediately
2. Event persisted to `webhook_events` table with status `RECEIVED`
3. Job enqueued to `inbound-message-processor` queue
4. Worker picks up job: finds tenant by `locationId`, upserts conversation, stores message
5. `webhook_events.processing_status` updated to `COMPLETED` or `FAILED`

**Signature Verification**: Currently a placeholder — always returns `valid: true`. The TODO is logged for later implementation when key management is in place.

### TODO (for GHL)

- [ ] Confirm exact GHL API endpoint for location verification
- [ ] Add webhook registration endpoint
- [ ] Implement webhook signature verification

## Troubleshooting

**Auth not working?**
- Verify SUPABASE_URL and keys in .env files
- Check Supabase Auth is enabled in dashboard
- Verify email confirmation is not required (or confirm emails)

**Database connection fails?**
- Check DATABASE_URL format
- Verify Postgres is running and accessible

**Seed fails?**
- Ensure Supabase Auth is accessible
- Check service role key has admin permissions