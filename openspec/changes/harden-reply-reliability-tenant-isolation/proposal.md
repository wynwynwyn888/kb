# Proposal: Harden Reply Reliability, Tenant Isolation, and Prompt Governance

## Why

The inbound-to-outbound pipeline has failure paths that look successful to BullMQ even though no customer reply was sent. At the same time, most backend database access uses Supabase `service_role`, so row-level security is bypassed and tenant isolation depends on every individual query and controller authorization check being correct. The authenticated ops surface currently permits broadly scoped reads and a conversation mutation after checking only that the caller has some agency role.

Prompt behavior is also distributed across agency policy, tenant profiles, hardcoded runtime system messages, conversation policy, KB evidence, deterministic flows, and outbound post-processing. Operators cannot currently inspect the effective hierarchy for a particular reply, which makes “the bot ignored my prompt” difficult to diagnose.

Finally, region- and vertical-specific behavior (Singapore timezone/languages, salon and sales behavior) and registered stub controllers remain in the production code path.

## Goals

- Guarantee that every accepted inbound message reaches exactly one observable terminal decision.
- Never complete a send job successfully when delivery was only deferred by lock or capacity contention.
- Retry transient orchestration and send failures without creating duplicate outbound messages.
- Prevent an agency or tenant user from reading or mutating another agency's data.
- Make tenant scope mandatory at repository/query boundaries used with `service_role`.
- Make the effective prompt hierarchy inspectable without exposing secrets or raw private data.
- Move region/vertical behavior out of global runtime instructions and into tenant configuration.
- Remove or unregister stale API stubs and converge on one prompt source of truth.

## Non-Goals

- Replacing Supabase, NestJS, BullMQ, GHL, or the configured LLM providers.
- A single big-bang rewrite of all data access.
- Changing bot copy or booking behavior unless required to remove global hardcoding.
- Enabling production migrations or rollout flags without staging validation and explicit approval.

## Workstreams

1. Reply lifecycle and retry correctness.
2. Ops authorization containment.
3. Tenant-scoped data architecture and schema reinforcement.
4. Prompt manifest, hierarchy, and reply traceability.
5. Locale/vertical configuration and stale-code cleanup.

## Success Criteria

- No inbound message remains `PENDING` beyond the configured SLA without an alert and recovery action.
- Lock/cap contention results in delayed/retried jobs, never a completed zero-send job.
- Transient orchestration failures exercise BullMQ retries; permanent failures are terminally recorded.
- Cross-tenant integration tests cover reads and mutations using two tenants with deliberately similar identifiers.
- All ops endpoints enforce platform-admin scope or caller-derived agency/tenant scope.
- Effective prompt traces identify every instruction layer, truncation, deterministic bypass, provider/model, and post-generation transformation.
- Global Singapore/salon/sales rules are removed or gated by tenant configuration.
- Deprecated stub routes are absent from the production module graph or return typed `501` responses behind an explicit development-only flag.

## Delivery Rule

Implement and review each workstream independently. Reliability and ops authorization are P0 and must land before broader refactors. Database changes are additive first; destructive cleanup occurs only after compatibility verification.
