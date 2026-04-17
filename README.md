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

## Quick Start

### Prerequisites

- Node.js 20+
- pnpm 9+
- Docker (for local Supabase)

### 1. Setup Supabase

**Option A: Local Supabase (recommended for development)**

```bash
# Start local Supabase
docker run -d --name supabase-db \
  -e POSTGRES_PASSWORD=postgres \
  -p 54322:5432 \
  postgres:15

# Start Supabase Studio (optional)
docker run -d --name supabase-studio \
  -e SUPABASE_URL=http://localhost:54322 \
  -e SUPABASE_KEY=your-anon-key \
  -p 3001:3000 \
  supabase/studio:latest
```

**Option B: Remote Supabase**
1. Create project at https://supabase.com
2. Get `SUPABASE_URL`, `SUPABASE_ANON_KEY`, `SUPABASE_SERVICE_ROLE_KEY` from dashboard

### 2. Configure Environment

```bash
# Backend
cd apps/backend
cp .env.example .env
# Edit .env with your Supabase values

# Frontend
cd apps/frontend
cp .env.example .env.local
# Edit .env.local with your Supabase values
```

### 3. Generate Prisma Client & Push Schema

```bash
cd apps/backend
pnpm install
pnpm db:generate
pnpm db:push
```

### 4. Seed Demo Data

```bash
cd apps/backend
pnpm db:seed
```

This creates:
- 1 demo agency
- 2 demo tenants
- 4 demo users with login credentials

### 5. Run Development Servers

```bash
# From root directory
pnpm install
pnpm dev
```

- Frontend: http://localhost:3000
- Backend API: http://localhost:3001/api/v1
- Swagger Docs: http://localhost:3001/docs (when backend running)

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
NEXT_PUBLIC_API_URL=https://kb.aisalesbot.pro/api/v1
NEXT_PUBLIC_APP_URL=https://kb.aisalesbot.pro
```

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