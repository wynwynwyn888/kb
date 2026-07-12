# Follow-up Context and Send Safety Specification

Status: **STAGING VALIDATED — PR CI REQUIRED BEFORE PRODUCTION**  
Baseline: `93689328a5b520c5e9abd68220c2978264785d76`

## Goal

Make AI follow-ups understand the same recent conversation as normal replies,
honour the configured follow-up limit, apply a reliable default when a step
instruction is blank, and fail closed when KB cannot determine whether the
customer has replied.

This batch does not enable follow-up for any tenant and does not change the
follow-up settings page database-access boundary. That caller/RLS cutover remains
a separate reversible phase.

## Confirmed current behavior and gaps

- Follow-up AI loads 20 database rows and then keeps only 12 non-empty messages.
- The memory query is scoped by `conversation_id` but not `tenant_id`.
- Normal AI memory uses a 30-message window, so normal and follow-up AI can see
  different context.
- `maxFollowUps` is stored but the scheduler queues every enabled step.
- The execution engine has a default AI instruction, but request validation
  rejects an enabled AI step with an empty instruction before the default can be
  applied.
- A database error while checking for a newer customer reply is treated as “no
  reply,” which can allow an unwanted follow-up.
- The production example tenant remains disabled; its three enabled test steps
  are not modified by this code release.

## Required behavior

1. Query follow-up memory by both tenant and conversation.
2. Keep the newest 30 non-empty customer-visible messages verbatim and in
   chronological order.
3. When more messages exist, add a bounded compact context block from earlier
   customer-visible turns. It is labelled as context, not an instruction.
4. Do not make a second AI call merely to summarize; use deterministic bounded
   compaction so cost and availability do not change.
5. Keep the step instruction separate and explicitly labelled. Global and tenant
   rules remain higher authority; conversation/KB facts remain grounding.
6. Accept an empty AI step instruction and persist the documented default:
   “Gentle nudge only. Do not sound salesy. Follow up based on the previous
   conversation context.”
7. Sort enabled steps by step number and schedule at most `maxFollowUps`.
8. If the customer-reply query errors, do not send. Requeue the same persisted
   job for five minutes later under a collision-free BullMQ job ID.
9. Preserve existing cancellation, stale-version, active-hours, opt-out,
   escalation, outbound safety, GHL delivery, idempotency, and audit behavior.

## Risks and controls

| Risk | Control |
|---|---|
| More context increases prompt size | 30 direct messages plus a 2,400-character bounded earlier block. |
| Earlier customer text acts like instructions | Mark it context-only and retain global/tenant rules above it. |
| Summary adds model cost/failure | Deterministic compaction; no extra model request. |
| Existing schedules change unexpectedly | Only new schedules apply the cap; persisted job snapshots remain executable. |
| Reply-check outage sends unwanted message | Unknown state is a five-minute deferral, never “no reply.” |
| Deferred job ID collides with currently active job | Add a sanitized timestamp suffix while keeping the persisted row ID in payload. |
| Cross-tenant memory leakage | Require both `tenant_id` and `conversation_id` predicates and test them. |

## Validation gates

- Unit tests for 30-message ordering, earlier compaction, tenant predicate,
  instruction default, cap enforcement, and unknown reply-check deferral.
- Existing scheduling, cleanup, outbound, orchestration, booking and follow-up
  suites.
- Full backend/frontend tests, type checks, and production build.
- Staging dry-run with no GHL send: seed isolated tenant/conversation/messages,
  verify memory/cap/default behavior, and remove every fixture.
- Production deployment only while the example tenant remains disabled.
- Post-deploy read-only verification of commit, service health, disabled setting,
  and zero pending follow-up jobs.

## Rollback

Revert the application commit and redeploy. There is no database migration and
no data transformation in this batch. Existing settings and persisted jobs are
unchanged, so no database rollback is required.

## Staging and regression evidence

The designated staging project passed seven content-free assertions without
constructing a GHL client or attempting a send: newest-30 memory, chronological
ordering, earlier compaction, wrong-tenant denial, empty-instruction defaulting,
`maxFollowUps` enforcement, and complete fixture cleanup. Full local regression
also passed 201 backend suites (1,728 tests), 25 frontend files (91 tests),
backend type-check, and the full production build.
