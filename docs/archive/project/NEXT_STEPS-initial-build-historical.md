# Next Build Steps

> **Status: HISTORICAL — SUPERSEDED.** This was the initial build checklist.
> Most listed systems were subsequently implemented. Do not use it to determine
> current gaps. See the root `NEXT_STEPS.md` for authoritative pointers.

## Phase 1: Core Infrastructure (Recommended Order)

### 1. Supabase Setup
- [ ] Create Supabase project
- [ ] Configure Postgres schema (use schema.prisma as reference)
- [ ] Set up Supabase Auth (email/password + Google OAuth)
- [ ] Configure RLS policies for tenant isolation

### 2. Backend Auth
- [ ] Connect Supabase Auth to NestJS backend
- [ ] Implement JWT generation and validation
- [ ] Add auth guards to all protected routes
- [ ] Implement tenant context extraction from JWT

### 3. GHL OAuth Integration
- [ ] Implement GHL OAuth flow (connect/disconnect)
- [ ] Store encrypted tokens in database
- [ ] Implement token refresh logic
- [ ] Test OAuth callback handling

### 4. Webhook Verification
- [ ] Implement GHL webhook signature verification
- [ ] Handle conversation events
- [ ] Handle inbound message events

### 5. Basic Conversation Flow
- [ ] Implement conversation service (create/get by GHL ID)
- [ ] Implement message storage
- [ ] Implement conversation memory (last 10 turns)
- [ ] Implement 24-hour session reset logic

## Phase 2: AI Integration

### 6. AI Provider Configuration
- [ ] Implement agency model provider storage
- [ ] Create provider adapters (OpenAI, Anthropic, etc.)
- [ ] Implement token counting

### 7. AI Router
- [ ] Implement routing decision logic
- [ ] Implement cost estimation
- [ ] Add fallback handling

### 8. Prompt Management
- [ ] Implement tenant prompt CRUD
- [ ] Implement agency system policy CRUD
- [ ] Implement prompt variable substitution
- [ ] Implement prompt merging (agency policy + tenant config)

### 9. Knowledge Base
- [ ] Implement document upload
- [ ] Implement chunking strategy
- [ ] Implement embedding generation
- [ ] Implement pgvector storage
- [ ] Implement similarity search

### 10. Formatter
- [ ] Implement markdown stripping
- [ ] Implement HTML stripping
- [ ] Implement bubble splitting
- [ ] Implement channel-specific formatting

## Phase 3: Operations

### 11. Handover
- [ ] Implement handover initiation
- [ ] Implement handover resume
- [ ] Implement agent notifications

### 12. Quota
- [ ] Implement quota wallet creation
- [ ] Implement quota deduction on successful send
- [ ] Implement quota threshold alerts
- [ ] Implement period reset

### 13. Actions
- [ ] Implement contact tagging via GHL
- [ ] Implement calendar event creation
- [ ] Implement audit logging

## Phase 4: Frontend

### 14. Auth UI
- [ ] Implement login page
- [ ] Implement registration page
- [ ] Implement auth state management

### 15. Dashboard
- [ ] Implement agency dashboard with tenant overview
- [ ] Implement tenant dashboard with conversation list
- [ ] Implement tenant switcher

### 16. Management UI
- [ ] Implement prompt editor
- [ ] Implement knowledge base UI
- [ ] Implement conversation logs
- [ ] Implement quota page

### 17. Tools
- [ ] Implement bot tester
- [ ] Implement settings page

## Phase 5: Polish

### 18. Testing
- [ ] Add unit tests for services
- [ ] Add integration tests for APIs
- [ ] Add E2E tests for critical flows

### 19. Monitoring
- [ ] Add logging (structured logs)
- [ ] Add error tracking
- [ ] Add metrics

### 20. Deployment
- [ ] Set up CI/CD
- [ ] Configure environment variables
- [ ] Set up monitoring/alerting

## Important Notes

### Tenant Isolation
Every database query MUST filter by tenantId. No exceptions. Implement and test this early.

### Conversation Memory
Our platform owns conversation memory, not GHL. Ensure all message history is stored in our DB.

### Quota Counting
Only count on successful outbound send. Not on receive, not on failure.

### Handover Behavior
When conversation is in handover, skip AI processing. Only resume when agent resumes.

### GHL Webhooks
Webhooks are the trigger, not the source of truth. Our platform owns state.
