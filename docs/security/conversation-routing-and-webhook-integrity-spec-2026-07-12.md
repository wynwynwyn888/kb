# Conversation Routing and Webhook Integrity Upgrade

Date: 2026-07-12 (Asia/Singapore)

## Goal

Prevent unverified/replayed inbound webhook payloads from causing customer replies, make mandatory tenant sales-routing steps reliable, and ensure AI follow-ups receive the documented 30 recent messages.

This upgrade must remain tenant-configurable and industry-neutral. No AISBP, salon, restaurant, or other industry copy may be introduced into global runtime instructions.

## Confirmed production incident

Conversation `acecd96e-4871-4e4d-8160-eae445ebe6e2` received an `InboundMessage` webhook at 2026-07-12 20:47:40 Singapore time containing `wyn`. The customer did not send that WhatsApp message. The payload had no GHL message ID and no GHL conversation ID; its timestamp was only `20:47`. KB accepted the payload and sent an AI reply.

The tenant's `/new -> hi -> wyn` flow produced the configured routing menu at 20:40 but generic copy at 20:52. Both used the same model and the same combined inbound batch. The Sales Playbook was present, but earlier prompt text allowed stages to be skipped/reordered and generation temperature was 0.7. A mandatory route was therefore being treated as probabilistic prose.

## Scope

### A. Stable provider identity gate

- A primary webhook without a stable GHL message ID must not directly acquire permission to orchestrate.
- Persist the raw webhook event for audit, but do not admit weak plain-text payload content into AI conversation memory; use the existing focused GHL conversation sync to locate and store the provider-owned message.
- Only the recovered GHL message ID may pass the provider idempotency gate.
- If GHL does not confirm the message, do not generate or send a reply.
- Preserve retry/recovery behavior for temporary GHL failures; do not silently convert an unverified payload into an outbound message.

### B. Mandatory configured after-name route

- Derive `awaiting_name` from the reset-scoped visible conversation: the immediately preceding assistant turn asked for the customer's name and the latest inbound is a plausible name-only answer.
- Read the tenant's active Sales Playbook, not a global industry prompt.
- If it contains a configured `After the name:` reply block, render that block deterministically and replace `[Name]` with the safely parsed customer name.
- Skip this deterministic route when the customer also asks a substantive question, requests a human, opts out, or provides unsafe/ambiguous input.
- If no valid configured block exists, retain the existing AI path.
- Mark audit provenance as a deterministic mandatory-playbook reply.

The first implementation uses the existing Sales Playbook field and its explicit `After the name:` block to avoid a production schema/UI migration. A future product iteration may expose mandatory stages as structured UI fields.

### C. Prompt conflict reduction

- Mandatory configured Sales Playbook rules take precedence over flexible journey guidance.
- Flexible guidance may skip already-answered or irrelevant optional discovery stages, but may not override a detected mandatory route.
- Do not lower global creativity for unrelated replies as part of this change.

### D. Follow-up context

- Allow follow-up generation to request 30 recent verbatim messages without changing the shared default used by normal replies.
- Keep compact earlier context bounded.

## Safety and regression risks

1. **Missed reply when GHL API is unavailable.** Fail closed: an unconfirmed message is safer than replying to a ghost event. Existing queue retry/recovery remains available and must be logged.
2. **A real message lacks an ID temporarily.** Focused sync is already used for recovery. Tests must prove a recovered ID schedules exactly one orchestration.
3. **A sentence is mistaken for a name.** Require a short name-only shape and a preceding assistant name request; skip deterministic routing for question/stop/human intent.
4. **Tenant wording is malformed.** Invalid or absent `After the name:` content falls back to normal AI generation; no global copy is substituted.
5. **Duplicate outbound sends.** Provider ID done/lock markers remain the final idempotency authority.
6. **Prompt injection through name.** Render only a tightly validated name token and treat the configured tenant block as trusted configuration.
7. **Token/cost increase.** Only follow-up generation receives 30 recent turns; ordinary generation retains its existing history limit.

## Required tests

- Primary webhook without GHL message ID is denied by the provider gate.
- Missing-ID webhook invokes focused sync and does not directly enqueue orchestration.
- Confirmed sync recovery with a stable message ID enqueues once.
- Unconfirmed/replayed weak webhook causes zero AI generation and zero outbound send.
- `/new -> hi -> name` sends the tenant-configured `After the name:` block exactly.
- The configured name placeholder is safely substituted.
- Name plus a real question bypasses the fixed route and answers the question.
- Stop/human requests bypass the fixed route.
- Missing/malformed playbook block falls back safely.
- Same scenario repeated multiple times produces the same mandatory routing response.
- Follow-up generation passes 30 recent messages; normal generation retains its current default cap.
- Existing option-selection, booking, escalation, reset, webhook, and outbound idempotency tests remain green.

## Rollback

No destructive data migration is planned.

1. Revert the deployment commit.
2. Redeploy the prior known-good main commit `7163c40ec22926e243b5d670e42c232dc528012c`.
3. Confirm frontend/backend containers are healthy and unauthenticated protected endpoints still return 401.
4. Confirm follow-up remains disabled for the production tenant.
5. Inspect pending inbound/orchestration jobs before replaying anything. Do not bulk replay weak-ID webhook events.

Stored webhook audit rows are retained by rollback and require no restoration.

## Deployment gates

- Targeted tests, complete backend tests/typecheck, frontend tests, and monorepo build pass.
- Staging demonstrates one reply for a confirmed provider message and zero replies for an unconfirmed weak payload.
- Diff receives a final security/regression review.
- Production deployment occurs only through reviewed PR/CI.
- Post-deploy verification is read-only; no tenant setting or live message is changed automatically.
