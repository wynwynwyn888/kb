# Corrected Implementation Plan

## Scope and sequencing

This plan supersedes implementation details in `DEEPSEEK_PROPOSED_FIX_SPEC.md` where they conflict with the live code. Delivery is split into independently testable changes:

1. P0-A reply-loss containment.
2. P0-B ops authorization containment.
3. P1 tenant-owned schema/repository hardening.
4. P1 prompt trace and hierarchy cleanup.
5. P2 locale/vertical configuration and stale-code cleanup.

Only phases 1 and 2 are authorized for immediate behavior-changing implementation. Schema, RLS, prompt precedence, and locale migrations require their own staging gates because they affect persisted data or tenant-visible behavior.

## P0-A: Reply-loss containment

### Invariants

- Capacity or lock contention must never complete a send job successfully.
- Intentional cancellation must be terminally observable and must not retry.
- Technical orchestration failures must reach BullMQ and exercise configured retries.
- The orchestration ownership lock must be released before a normal retry; crash recovery still relies on TTL.
- Provider-done markers are written only after delivery or intentional terminal suppression.
- No retry design may claim exactly-once delivery across an external provider boundary unless the provider accepts a stable idempotency key.

### Outbound idempotency model

The ledger claim must exist before the GHL call and be enabled for retry-capable sends. States:

```text
pending -> processing -> sent
                      -> failed_provider_rejected
                      -> failed_before_provider
                      -> provider_outcome_unknown
                      -> cancelled_due_to_predecessor
                      -> dead_lettered
```

`provider_outcome_unknown` is used when the process may have crossed the provider boundary but cannot prove the result. It must not be blindly resent. Recovery must reconcile against a stable provider correlation identifier or GHL conversation history. If reconciliation is unavailable, alert/manual recovery is safer than duplicate customer messages.

The existing `AISBP_OUTBOUND_IDEMPOTENCY_ENABLED` flag must be enabled and validated before retry-on-send-error is expanded. Contention before the provider call is safe to retry without provider reconciliation.

### Worker behavior

- Semaphore unavailable: throw a typed retryable contention error.
- Conversation lock unavailable: throw a typed retryable contention error.
- Prior bubble `wait`: throw a typed retryable ordering error.
- Prior bubble `cancel`: update ledger/reply lifecycle to an intentional cancellation and return a terminal result; do not throw for retry.
- Stale reply: record an explicit superseded state for the reply attempt, enqueue the newer orchestration exactly once, and do not overwrite a terminal decision belonging to a newer inbound.
- AI-off/handover/suggestive paths: record explicit intentional no-send outcomes.

### Orchestration behavior

Business outcomes remain values (`PROCEED`, `SKIP_*`). Technical failures throw. Unknown failures are retryable until exhaustion. Known permanent configuration failures are finalized without ordinary retry.

The inbound processor owns lock cleanup:

```ts
const token = await claim();
try {
  const result = await orchestrate();
  await handleBusinessResult(result);
} catch (error) {
  await recordAttemptFailure(error);
  if (isPermanent(error)) await finalizePermanentFailure(error);
  throw error;
} finally {
  await releaseOwnedLock(token);
}
```

Permanent errors require BullMQ discard/non-retry semantics or a successful terminal return after finalization. Simply throwing a `PermanentPipelineError` is insufficient because BullMQ retries thrown errors by default.

### Status separation

Do not overload one field:

- Webhook processing: `RECEIVED | PROCESSING | COMPLETED | FAILED`.
- Routing decision: `PROCEED | SKIP_* | FAILED_ORCHESTRATION`.
- Delivery lifecycle: `NOT_REQUIRED | SEND_ENQUEUED | SENDING | SEND_ATTEMPT_FAILED | SENT | FAILED_SEND | PROVIDER_OUTCOME_UNKNOWN | CANCELLED`.

Webhook `COMPLETED` means the webhook was durably consumed, not necessarily that GHL delivery succeeded. End-to-end delivery is represented separately.

### Required tests

- Direct processor tests for semaphore/lock/prior-wait behavior.
- Queue integration test proving a thrown contention error retries.
- Lock-release test on orchestration failure.
- Exhaustion test writing a terminal failure exactly once.
- Intentional prior cancellation test with no retry.
- Provider-boundary tests for crash before provider, confirmed rejection, confirmed success, and unknown outcome.
- Suggestive, AI-off, handover, and stale-reply tests.

## P0-B: Ops authorization containment

### Rules

- Global health/flags/queue operations require an explicit platform-admin authority.
- Agency users may only list tenant data derived from their server-side memberships.
- A supplied `tenantId` is a filter, never authority.
- Conversation mutations resolve the conversation's tenant and authorize the actor before mutation.
- Inaccessible IDs return a non-enumerating `404` where appropriate.
- Every privileged mutation records the actor profile ID and tenant ID.

### Role matrix

The implementation must define and test read/manage roles. The `action` argument may not be ignored.

```text
platform admin: global read/manage
agency OWNER/ADMIN: agency tenant read/manage
agency OPERATOR: agency tenant read; limited operational manage if explicitly allowed
agency MEMBER: no ops access by default
tenant ADMIN: own tenant read/manage
tenant AGENT: own tenant read; limited manage if explicitly allowed
tenant VIEWER: own tenant read only
```

No environment email allowlist should become the long-term platform-admin authority. If no platform-admin persistence exists, global routes fail closed until an additive authority is introduced.

## P1: Tenant-owned data hardening

- Inventory every service-role query before migration.
- Add owner columns additively, backfill, dual-write, validate, then enforce non-null/composite ownership.
- `messages`, `handover_events`, and other conversation children should carry `tenant_id` where this materially enforces ownership and improves querying.
- RLS rollout requires actual `USING` and `WITH CHECK` policies, membership indexes, JWT-scoped clients for user requests, and tests for anon/authenticated/service-role actors.
- Security-definer functions must set a safe `search_path`, fully qualify relations, verify `p_tenant_id`, and revoke `PUBLIC`/unneeded role execution.
- Enabling RLS without policies is not a completed security change.

## P1: Prompt governance

Correct model selection documentation: the router recommendation is telemetry only. Selection is tenant override when valid, otherwise the active agency provider configuration/provider fallback.

Agency precedence is a product policy, not an implementation assumption. Model agency configuration as either non-overridable constraints or overridable defaults before changing precedence.

Keep no-KB factual-grounding and non-invention rules as platform safety invariants. Tenant configuration may change wording or escalation, not permit fabricated business facts.

Prompt traces store hashes, sizes, IDs, truncation, selected model/provider, KB identifiers, deterministic path, and post-processors. General traces contain no raw customer, assistant, prompt, or KB previews. Any content-debug facility is separately authorized, audited, and short-lived.

## P2: Locale, vertical, and stale code

- Move timezone/language policy to tenant settings with compatibility defaults.
- Gate salon/sales behavior by explicit capability, preserving existing tenants through migration.
- Delete modules only after static references, dynamic Nest registration, scripts, tests, frontend calls, and deployment-specific graphs are checked.
- Registered compatibility stubs return typed `501` or are unregistered; generic `500 Not implemented` is not acceptable.

## Completion gates

- No unrelated dirty files overwritten.
- Focused tests and backend typecheck pass.
- Queue behavior is tested through BullMQ semantics, not only method rejection.
- Cross-agency read/mutation tests pass.
- No production migration or deployment is performed without explicit approval.
