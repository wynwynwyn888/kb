# Backend - NestJS API and Workers

## Architecture

### Modules

The backend is organized into feature modules under `src/modules/`:

- **auth** - JWT authentication, Supabase Auth integration
- **agencies** - Agency entity management
- **agency-users** - Agency user membership and roles
- **tenants** - Tenant entity management (maps to GHL location)
- **tenant-users** - Tenant user membership and roles
- **ghl** - GoHighLevel OAuth and API integration
- **webhooks** - Inbound GHL webhook handling
- **conversations** - Conversation state and messages (owns memory)
- **prompts** - System prompt and prompt config management
- **kb** - Knowledge base documents and embeddings
- **ai-router** - AI model routing decisions
- **formatter** - Message formatting and bubble splitting
- **handover** - Human agent handoff management
- **quotas** - Quota wallet and ledger (counts on outbound only)
- **calendars** - Calendar event operations via GHL
- **contacts** - Contact operations via GHL
- **audit** - Audit logging
- **notifications** - User notifications

### Queue Workers

BullMQ workers under `src/queues/processors/`:

- **inbound-message-processor** - Processes incoming GHL messages
- **send-bubble** - Sends formatted messages back to GHL
- **kb-ingest** - Ingests documents with embeddings
- **handover-notify** - Notifies agents of handover requests
- **quota-threshold-alert** - Alerts when quota threshold reached

## Key Patterns

### Tenant Isolation
Every service that accesses tenant data must:
1. Extract tenant ID from JWT or request context
2. Always filter queries by tenantId
3. Never expose tenant A's data to tenant B

### Conversation Memory
- Last 10 turns stored in messages table
- 24-hour session reset (no activity = reset)
- Memory is owned by our platform, not GHL

### Quota Counting
- Counted on successful outbound send only
- Debit ledger entry created
- Alert triggered at threshold percentage

## Database

Uses Prisma with PostgreSQL. Schema is in `prisma/schema.prisma`.

Run migrations:
```bash
pnpm db:migrate
```

## Environment Variables

See `.env.example` for all required variables.

## TODO

- Implement Supabase Auth integration
- Implement GHL OAuth flow
- Implement webhook signature verification
- Complete all service methods marked as "Not implemented"
- Add proper tenant-scoped query filters
- Implement Row Level Security in Postgres