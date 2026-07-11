# DeepSeek V4 Pro Implementation Prompt

You are implementing a production hardening change in the monorepo at `/Users/wyn/Projects/KB/kb-explore`.

Read these files completely before editing:

1. `openspec/changes/harden-reply-reliability-tenant-isolation/proposal.md`
2. `openspec/changes/harden-reply-reliability-tenant-isolation/design.md`
3. `openspec/changes/harden-reply-reliability-tenant-isolation/specs/reply-and-tenant-hardening/spec.md`
4. `openspec/changes/harden-reply-reliability-tenant-isolation/tasks.md`

Also inspect the current implementation and tests, especially:

- `apps/backend/src/queues/processors/send-bubble.processor.ts`
- `apps/backend/src/queues/processors/inbound-message.processor.ts`
- `apps/backend/src/modules/orchestration/orchestration.service.ts`
- `apps/backend/src/modules/orchestration/orchestration-guards.service.ts`
- `apps/backend/src/lib/inbound-decision.ts`
- `apps/backend/src/modules/outbound/outbound-send.service.ts`
- `apps/backend/src/modules/ops/ops.controller.ts`
- `apps/backend/src/modules/ops/ops.service.ts`
- `apps/backend/src/modules/auth/auth.service.ts`
- `apps/backend/src/lib/supabase/index.ts`
- `apps/backend/src/modules/orchestration/conversation-memory-loader.ts`
- `apps/backend/src/modules/generation/generation.service.ts`
- `apps/backend/src/modules/reply-planning/reply-planner.service.ts`
- `apps/backend/src/modules/prompts/bot-profiles.service.ts`
- `apps/backend/prisma/schema.prisma`
- `apps/backend/prisma/migrations/`

## Mandatory working rules

- The worktree may already be dirty. Preserve unrelated edits and never reset or overwrite them.
- Implement one phase at a time. Start with Phase 1 reliability unless explicitly instructed otherwise.
- Before each phase, add regression tests that fail for the current defect.
- Do not perform a broad rewrite when a bounded fix can satisfy the specification.
- Do not weaken idempotency, outbound safety, handover behavior, or deduplication.
- Do not log raw customer messages, full prompts, KB content, provider keys, access tokens, or decrypted credentials.
- Do not add production migrations that drop/rename columns. Schema work must be additive first.
- Do not apply migrations to production or deploy.
- Do not assume frontend hiding is authorization.
- Do not use service-role RLS bypass as a reason to omit tenant predicates.
- Do not claim “requeue” or “delay” unless the code actually changes BullMQ job state or rejects for configured retry.

## Phase 1 implementation request: reply reliability

Implement the following first:

1. Add typed pipeline errors with stable codes.
2. In `send-bubble.processor.ts`, change tenant-capacity and conversation-lock contention so the job is retried/delayed. It must not return a successful zero-send result.
3. Ensure send jobs have bounded retry/backoff configuration.
4. Verify the outbound send ledger prevents duplicate provider sends across retries. If there is a crash window between provider success and ledger finalization, document it and close it where possible using the provider message ID/idempotency semantics available.
5. Change orchestration technical failures to reject the queue job. Business `SKIP_*` outcomes remain successful terminal decisions.
6. Do not mark webhook events `COMPLETED` on technical failure.
7. Add explicit failed/dead-letter terminal decisions on exhausted attempts.
8. Ensure suggestive mode is recorded as an intentional terminal no-send state rather than indefinite `PENDING`.
9. Add recovery coverage for messages stuck without a terminal decision.

Required tests:

- semaphore unavailable -> processor rejects/retries, not completes;
- conversation lock unavailable -> processor rejects/retries;
- transient orchestration exception -> BullMQ-visible failure;
- permanent guard skip -> terminal `SKIP_*`, no retry;
- attempts exhausted -> failed/dead-letter decision and failed webhook;
- duplicate retry -> one provider send per bubble ledger key;
- suggestive mode -> explicit no-send terminal state;
- stale reply cancellation -> new orchestration is scheduled once;
- all locks/semaphores released correctly on success and failure.

## Phase 2 implementation request: ops authorization

After Phase 1 tests pass:

1. Define platform-global versus agency-scoped ops routes.
2. Require a real platform-admin authorization source for global routes. If the schema has no platform-admin role, fail closed and document the necessary schema/config addition; do not treat any agency role as platform admin.
3. For agency-scoped routes, derive accessible tenant IDs from the authenticated profile's memberships.
4. Require services to receive an authorization scope; do not allow unscoped optional `tenantId` to mean all tenants.
5. Resolve and authorize conversation ownership before `clearHandover`.
6. Return non-enumerating errors for foreign resource IDs.

Add table-driven tests for agency A versus agency B for every ops read and mutation route.

## Phase 3 implementation request: tenant data architecture

Produce an inventory before editing. For every service-role query against a tenant-owned table, list the table, method, owner column, current predicate, and required predicate. Then implement the highest-risk conversation/message/handover paths.

Add `messages.tenant_id` through staged migrations:

1. nullable column and index;
2. idempotent backfill from conversations;
3. application writes populate it;
4. composite ownership constraint, preferably `NOT VALID` then validated;
5. only later, after a zero-null verification, make it non-null.

All runtime loads and mutations should require `(tenantId, resourceId)` or authorize through an ownership join. Add two-tenant integration tests.

## Phase 4 implementation request: prompt governance

Refactor prompt construction into explicit named layers without changing reply behavior initially. Produce a safe manifest containing source IDs, versions, hashes, lengths, truncation, deterministic bypass, actual provider/model, KB document IDs, and post-processors.

Do not store full raw prompts in general logs. Add tests proving trace completeness and absence of secrets/raw transcript content.

Document the operational hierarchy in code comments and API output:

```text
application/deterministic guards
platform safety
agency policy
tenant profile
channel/locale/capability policy
conversation policy
KB evidence
history
customer turn
post-generation transformations
```

## Phase 5 implementation request: cleanup

Move Singapore timezone/language rules and salon/sales behavior into validated tenant settings or opt-in capabilities. Preserve existing behavior only for tenants explicitly migrated to equivalent settings.

Inventory all stub controllers and search for callers. Unregister unused production routes; retained compatibility routes must return HTTP 501 rather than generic 500. Do not delete referenced code until tests and repository search show no runtime callers.

## Required output after each phase

Return:

1. Findings and any specification ambiguity.
2. Files changed and why.
3. Database migration details and rollback implications.
4. Tests added, exact commands run, and results.
5. Remaining risks, especially duplicate-send windows and cross-tenant service-role queries.
6. Updated checkboxes in `tasks.md` only for work actually completed and verified.

Do not mark the overall change complete until every acceptance scenario in the spec is implemented and tested.
