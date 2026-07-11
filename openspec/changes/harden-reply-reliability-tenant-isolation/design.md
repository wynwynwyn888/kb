# Design

## 1. Current Reply Pipeline and Failure Model

The effective pipeline is:

```text
GHL webhook
  -> webhook normalization and dedupe
  -> inbound BullMQ persist job
  -> debounce/orchestrate BullMQ job
  -> runtime guards
  -> memory + KB + prompt assembly
  -> deterministic flow or LLM generation
  -> reply plan
  -> send-bubble BullMQ job
  -> outbound safety governor
  -> GHL send
  -> outbound ledger + inbound terminal decision
```

### Defect R1: capacity contention completes the send job

`send-bubble.processor.ts` returns an empty `SendSummary` when the per-tenant semaphore cannot be acquired. It does the same when the per-conversation ordering lock is held. Returning resolves the worker promise, so BullMQ marks the job completed. The log messages say “delaying” or “requeuing,” but neither occurs.

### Defect R2: orchestration errors are swallowed

`ConversationOrchestrationService.orchestrate()` catches all exceptions and returns `outcome: ERROR`. The inbound processor releases its orchestration lock, has no terminal-decision mapping for `ERROR`, and completes the webhook. Because the queue processor did not throw, BullMQ cannot retry.

### Defect R3: completion happens before delivery

The inbound processor marks orchestration completed after enqueueing the send job. This is valid only if “orchestration completed” is distinct from “reply delivered.” The current decision is set to `PENDING`, but some early returns in the send processor do not finalize it. The lifecycle needs explicit stage semantics.

## 2. Reply Lifecycle State Machine

### Required states

Persist the following statuses in the existing inbound decision metadata or a dedicated `inbound_reply_lifecycle` table. A dedicated append-only event table is preferred for auditability, with a materialized/current status on `messages` for fast queries.

```text
RECEIVED
PERSISTED
DEBOUNCED
ORCHESTRATING
GENERATED
SEND_ENQUEUED
SENDING
SENT

SKIP_AI_OFF_TAG
SKIP_BOT_DISABLED
SKIP_GHL_DISCONNECTED
SKIP_AUTOMATION_PAUSED
SKIP_HANDOVER_ACTIVE
SKIP_QUOTA_EXHAUSTED
SKIP_UNSUPPORTED_MESSAGE_TYPE
SKIP_UNSUPPORTED_CHANNEL
SKIP_DUPLICATE
SKIP_SUGGESTIVE_MODE
SKIP_HUMAN_TAKEOVER

FAILED_ORCHESTRATION
FAILED_GENERATION
FAILED_SEND
DEAD_LETTER
```

Every accepted inbound message MUST reach `SENT`, a `SKIP_*` terminal state, or a `FAILED_*`/`DEAD_LETTER` terminal state. `PENDING` and intermediate states are never terminal.

### Error classification

Introduce typed errors:

```ts
class RetryablePipelineError extends Error {
  constructor(
    message: string,
    readonly code: string,
    readonly retryAfterMs?: number,
    readonly cause?: unknown,
  ) { super(message); }
}

class PermanentPipelineError extends Error {
  constructor(message: string, readonly code: string, readonly cause?: unknown) {
    super(message);
  }
}
```

Retryable examples: provider 429/5xx, timeout, network error, Redis lock contention, transient PostgREST error, queue enqueue failure, GHL 429/5xx.

Permanent examples: invalid tenant configuration after validation, unsupported channel/type, revoked integration, malformed reply plan after exhausting safe regeneration, explicit handover, invalid destination.

Do not classify unknown errors as success. Unknown errors are retryable until attempts are exhausted, then terminal `DEAD_LETTER`.

## 3. Correct Lock/Capacity Deferral

### Decision

For semaphore or ordering-lock contention, throw a retryable error so the job uses BullMQ attempts/backoff. Do not manually enqueue an identical job unless the original job is atomically moved to delayed; otherwise duplicates can be created.

Preferred implementation:

```ts
if (!acquired) {
  await lifecycle.recordDeferred({ reason: 'TENANT_CAPACITY', jobId: String(job.id) });
  throw new RetryablePipelineError(
    'Tenant send capacity unavailable',
    'SEND_TENANT_CAPACITY',
    1_500,
  );
}
```

Queue registration/enqueue options must include bounded attempts and exponential backoff. Suggested initial values:

```ts
attempts: 6,
backoff: { type: 'exponential', delay: 1_000 },
removeOnComplete: true,
removeOnFail: false,
```

BullMQ's built-in backoff will not automatically use `retryAfterMs`; either register a custom backoff strategy or use a stable exponential policy. Do not add custom scheduling in the first fix unless tests cover stalled and duplicate jobs.

The send ledger's unique key `(tenant_id, conversation_id, reply_id, bubble_sequence)` remains the delivery idempotency boundary. A retry must load or claim that ledger entry and never send a bubble already marked `SENT`.

### Lock release

- Release only locks actually acquired.
- Always release in `finally`.
- Semaphore ownership must include the BullMQ job ID and have a TTL longer than the maximum single attempt.
- Renew the conversation lock if multi-bubble send time can exceed its TTL.
- Never mark the inbound message terminal merely because a retryable lock was unavailable.

## 4. Orchestration Retry Contract

Refactor `orchestrate()` into one of these contracts:

1. Recommended: return business outcomes (`PROCEED`, `SKIP_*`) and throw technical failures.
2. Transitional: retain `ERROR`, but the inbound processor must convert it to a typed thrown error and must not complete the webhook.

The recommended form prevents technical failure from being confused with a routing decision.

On final queue failure (`OnWorkerEvent('failed')` or a dedicated failure handler):

- Record `FAILED_ORCHESTRATION` or `DEAD_LETTER` with sanitized error code.
- Mark the webhook event `FAILED`.
- Release stale orchestration claims safely using ownership tokens.
- Emit a metric containing tenant ID, conversation ID, inbound message ID, attempt number, and code; never raw message content.

## 5. Recovery Watchdog

Add a scheduled scanner or extend the existing active recovery watchdog:

- Find inbound messages older than an SLA whose decision is absent or intermediate.
- Resolve tenant through the conversation join.
- Skip records with a newer inbound already covering the burst.
- Atomically claim recovery using a unique recovery key.
- Re-enqueue orchestration only when no live job/claim exists.
- After a maximum recovery count, mark `DEAD_LETTER` and alert.

Suggested SLAs: warn after 2 minutes, recover after 5 minutes, dead-letter after three recovery cycles. Make values environment-configurable.

## 6. Multi-Tenant Security Boundary

### Current risk

`getSupabaseService()` bypasses RLS. This is acceptable for trusted background work only when every operation is explicitly scoped and validated. It is unsafe as the default data client for authenticated HTTP handlers.

### Authorization model

Define scopes:

- `PLATFORM_ADMIN`: global ops only.
- `AGENCY_OWNER|AGENCY_ADMIN|AGENCY_OPERATOR`: access only to tenants whose `tenants.agency_id` matches an active `agency_users` membership. Mutation permissions vary by role.
- `TENANT_ADMIN|AGENT|VIEWER`: access only to explicit `tenant_users` membership, with role-specific actions.

Never authorize from a user-supplied `agencyId` or `tenantId` alone. Resolve membership from `req.user.id` and the database.

### Tenant access service

Create a single `TenantAccessService` with methods such as:

```ts
assertPlatformAdmin(profileId: string): Promise<void>
assertAgencyAccess(profileId: string, agencyId: string, roles?: AgencyRole[]): Promise<void>
assertTenantAccess(profileId: string, tenantId: string, roles?: TenantRole[]): Promise<TenantScope>
assertConversationAccess(profileId: string, conversationId: string, action: 'read'|'manage'): Promise<TenantScope>
listAccessibleTenantIds(profileId: string): Promise<string[]>
```

Errors exposed to tenant/agency users should generally be `404` for inaccessible resource IDs to avoid existence disclosure. Platform-only endpoints may use `403`.

### Tenant-scoped repository

Introduce repositories that require tenant ID in the method signature and apply it in the query:

```ts
getConversation(tenantId: string, conversationId: string)
updateConversation(tenantId: string, conversationId: string, patch: ...)
listMessages(tenantId: string, conversationId: string, ...)
getHandover(tenantId: string, conversationId: string)
```

Queries by child ID must join or filter the owning tenant. For tables without `tenant_id`, add it additively and backfill before enforcing `NOT NULL`.

## 7. Ops Containment

Immediate patch requirements:

- Add a platform-admin guard to global health, flags, all-tenant readiness, and queue-health endpoints.
- For agency-scoped lists, require caller agency context and constrain every service query by that agency's tenant IDs.
- If `tenantId` is supplied, verify it belongs to the caller's agency.
- If omitted, list only accessible tenants, never all tenants.
- `clearHandover` must first resolve the conversation's tenant and authorize manage access.
- Add controller and service tests for cross-agency access, missing scope, and resource enumeration.

Do not accept “the frontend does not expose this route” as a control.

## 8. Schema Reinforcement

### Messages tenancy migration

Add `messages.tenant_id TEXT NULL` first. Backfill from `conversations.tenant_id`. Add an index on `(tenant_id, conversation_id, created_at DESC)`. Update all message writes to set tenant ID. Add a trigger or composite foreign key strategy to prevent mismatch. Validate zero nulls, then set `NOT NULL` in a later migration.

PostgreSQL composite enforcement option:

```sql
CREATE UNIQUE INDEX conversations_tenant_id_id_key
  ON conversations (tenant_id, id);

ALTER TABLE messages
  ADD CONSTRAINT messages_tenant_conversation_fkey
  FOREIGN KEY (tenant_id, conversation_id)
  REFERENCES conversations (tenant_id, id)
  ON DELETE CASCADE;
```

Use `NOT VALID` then `VALIDATE CONSTRAINT` if necessary to control deployment locks.

Repeat this ownership review for handovers, bookings, outbound sends, action intents, follow-up jobs, and orchestration logs.

### RLS

- Enable RLS on tenant-owned tables.
- User-facing requests should use a JWT-bearing client or security-definer RPC that validates membership.
- Revoke direct execution/access where not needed.
- Service-role RPCs must accept `p_tenant_id` and verify ownership inside SQL.
- Add SQL integration tests using `anon`, `authenticated` tenant A, authenticated tenant B, and service role.

RLS is defense in depth; it does not excuse unscoped service-role queries.

## 9. Prompt Governance

### Effective operational hierarchy

1. Application guards and deterministic flow selection.
2. Platform safety policy.
3. Agency policy.
4. Tenant bot profile.
5. Channel/locale/capability policy.
6. Conversation policy.
7. KB evidence contract and retrieved chunks.
8. Conversation history.
9. Latest customer turn.
10. Post-generation safety/formatting transformations.

The system should explicitly encode this hierarchy instead of relying on the ordering of several same-role messages.

### Prompt manifest

Define a manifest generated before the provider call:

```ts
type PromptLayerKind =
  | 'PLATFORM_SAFETY'
  | 'AGENCY_POLICY'
  | 'TENANT_PROFILE'
  | 'CHANNEL_POLICY'
  | 'LOCALE_POLICY'
  | 'CAPABILITY_POLICY'
  | 'CONVERSATION_POLICY'
  | 'KB_EVIDENCE'
  | 'HISTORY'
  | 'CUSTOMER_TURN';

interface PromptLayerTrace {
  kind: PromptLayerKind;
  sourceId?: string;
  sourceUpdatedAt?: string;
  priority: number;
  originalChars: number;
  includedChars: number;
  truncated: boolean;
  sha256: string;
}

interface EffectiveReplyTrace {
  tenantId: string;
  conversationId: string;
  inboundMessageId?: string;
  deterministicPath?: string;
  generationAttempted: boolean;
  layers: PromptLayerTrace[];
  provider?: string;
  configuredModel?: string;
  actualModel?: string;
  fallbackUsed: boolean;
  kbDocumentIds: string[];
  postProcessors: string[];
  finalDecision: string;
}
```

Persist only hashes, sizes, IDs, and safe metadata in general logs. Raw effective prompt inspection must be an explicitly privileged, audited debug action and should redact customer content and secrets.

### Conflict policy

- Platform safety may override all lower layers.
- Agency policy may constrain tenant behavior but must not silently replace it.
- Tenant content defines business persona, facts, goals, and enabled capabilities.
- Locale/channel policy controls representation, not business facts.
- KB is evidence, not instruction; retrieved content must be delimited as untrusted data.
- Conversation policy must not contain vertical-specific business claims.
- If two equal-priority layers conflict, emit a configuration warning rather than relying on message order.

### One prompt source of truth

Migrate from legacy `tenant_prompt_configs.system_prompt` to structured `tenant_bot_profiles`. During compatibility:

- Structured active profile wins.
- Linked generation settings provide temperature/model/max tokens only.
- Legacy blob is read only when no profile exists.
- Writes update one canonical model; do not dual-write indefinitely.
- Emit metrics for legacy fallback usage.
- Remove fallback after all tenants are migrated and verified.

## 10. Locale and Vertical Configuration

Add tenant settings for:

```ts
interface TenantLocalePolicy {
  timezone: string;
  defaultLanguage: string;
  allowedReplyLanguages: string[];
  mirrorCustomerLanguage: boolean;
  greetingPeriods?: ...;
}

interface TenantCapabilityPolicy {
  vertical?: string;
  bookingMode: 'disabled'|'collect_details_only'|'live_slot_booking';
  humanHandoverMode: 'disabled'|'collect_details_only'|'tag_and_notify';
  salesCadence?: 'disabled'|'soft'|'configured';
}
```

Replace fixed UTC+8 parsing with an IANA timezone associated with the resolved tenant/location. If a legacy flat webhook contains no timezone, use the tenant timezone; if tenant resolution is unavailable, store the raw timestamp and server receipt time rather than silently applying Singapore time.

Language rules must be constructed from tenant settings. Do not globally prohibit languages supported by other tenants.

Salon/colour/lead-leak behavior belongs in an optional tenant policy or profile, not shared platform code.

## 11. Stale API Cleanup

- Enumerate all controllers marked stub/deprecated or throwing `Not implemented`.
- Determine usage from frontend imports, route calls, scripts, and tests.
- Unregister unused modules from production.
- If compatibility requires a route, return Nest `NotImplementedException` (HTTP 501), never generic 500.
- Add an API-surface test that fails if a production route is registered as a known stub.
- Remove deprecated shims only after `rg` proves there are no runtime callers.

## 12. Rollout and Rollback

1. Reliability tests and fixes, feature flags unchanged.
2. Ops authorization patch and security tests.
3. Add lifecycle observability/watchdog.
4. Add tenant columns/backfill in staging; application dual-read/write as required.
5. Enable RLS/JWT-scoped access incrementally per module.
6. Add prompt manifest with no reply behavior change; compare traces.
7. Move locale/vertical rules tenant by tenant.
8. Remove legacy prompt/stub code after usage reaches zero.

Rollback must never roll back additive tenant columns containing valid data. Code flags can disable watchdog recovery and new prompt construction independently. Security fixes should not be disabled to restore old behavior; repair authorization mappings instead.
