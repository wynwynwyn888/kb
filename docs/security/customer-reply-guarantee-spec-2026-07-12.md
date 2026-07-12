# Customer reply guarantee — implementation and rollback

Date: 2026-07-12

## User outcome

A genuine customer message must not become silent merely because no KB result exists, generation fails, or an outbound safety guard rejects the draft.

## Reply decision hierarchy

1. Ignore non-customer events, duplicate provider deliveries, delivery receipts, and reset commands according to the existing ingestion/idempotency rules.
2. When AI is enabled and the conversation is not under handover, ask the AI to answer using recent conversation context plus the tenant prompt and available KB context.
3. General conversation does not require a KB result. A usable safe AI draft is sent normally.
4. Business-specific facts must be supported by tenant configuration, the Sales Playbook, or retrieved KB context. Existing grounding, unsupported-claim, internal-leak, and policy guards remain authoritative.
5. If no safe satisfactory reply survives those checks, send exactly: `I will check and get back to you as soon as I can`, and create the human escalation.
6. If handover is already active, use the contextual handover holding responder for new substantive customer messages. Its acknowledgement, AI-off, suggestive-mode, technical-input, idempotency, and cooldown protections remain in force.

## Completion invariant

For an eligible autopilot customer turn, orchestration is considered customer-facing only when it produces at least one outbound bubble. Creating a handover alone is not a customer reply. The no-safe-reply branch therefore returns a planned holding bubble in addition to performing the escalation.

## Safety boundary

The holding sentence is the sole new deterministic customer reply. It is used only after AI generation/planning failed to produce a sendable draft. It is not substituted for ordinary general conversation and does not weaken business-fact grounding.

The change does not modify debounce timing, prompt hierarchy, KB retrieval, tenant data, database schema, credentials, AI-off semantics, suggestive mode, or webhook deduplication.

## Regression coverage

- A normal live AI draft with no KB remains `PLANNED` and is sent.
- Unsupported business claims remain blocked by the existing safety governor.
- A blocked/failed draft creates human escalation and returns one holding bubble with the exact approved text.
- An active-handover customer message invokes the contextual holding responder rather than silently terminating.
- Duplicate and direct outbound behavior remain protected by existing queue/idempotency tests.

## Rollback

Revert the deployment commit containing this document and redeploy production commit `4d7330c638ecf5afd3365730ce2fc7a0fda07a36`. No database migration, tenant-setting change, prompt rewrite, data backfill, or secret rollback is required.

