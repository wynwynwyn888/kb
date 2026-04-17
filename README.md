# AI SaaS Business Platform - Monorepo

## Overview

Multi-tenant white-label SaaS platform that sits between GoHighLevel (GHL) and AI models. Acts as an AI conversation middleware for agency use.

## Tech Stack

- **Frontend**: Next.js 14+ (App Router)
- **Backend**: NestJS
- **Database**: Supabase (Postgres + pgvector)
- **Queue**: Redis + BullMQ
- **Language**: TypeScript everywhere

## Repository Structure

```
aisbp/
├── apps/
│   ├── backend/     # NestJS API + workers
│   └── frontend/    # Next.js dashboard
├── packages/
│   └── shared/      # Shared packages
├── package.json
├── pnpm-workspace.yaml
└── turbo.json
```

## Architecture Principles

- Strict tenant isolation everywhere
- GHL is channel rail, NOT source of truth for bot state
- Our platform owns: conversation memory, prompt stack, KB retrieval, handover state, quota state, analytics
- No giant god files - keep modules small and focused
- Explicit interfaces, boring maintainable code over clever code

## Core Concepts

### Tenancy Model
- Agency owns many Tenants
- Tenant maps 1:1 to GHL subaccount/location
- Agency users access all tenants; Tenant users access only their tenant
- AI provider keys at agency level; Tenant owns business prompt, KB, settings

### Conversation Memory
- Last 10 turns
- 24-hour session reset

### Quota Logic
- Counts on successful outbound send only

### Handover
- Pauses AI replies until resumed

## Getting Started

See individual app README files for setup instructions.