# Implementation Tasks

## Phase 0: Baseline and safety

- [ ] Capture current `git status`; preserve all unrelated user edits.
- [ ] Run targeted existing tests for inbound, orchestration, send-bubble, outbound ledger, ops, auth, prompts, and Supabase access.
- [ ] Add failing regression tests for semaphore-full and conversation-lock-held branches.
- [ ] Add a failing test showing orchestration `ERROR` does not retry/finalize correctly.
- [ ] Add two-agency/two-tenant fixtures for authorization tests.

## Phase 1 (P0): No-reply reliability

- [ ] Add typed retryable/permanent pipeline errors and stable error codes.
- [ ] Replace capacity/lock early-success returns with retryable failure/delay behavior.
- [ ] Confirm send job enqueue options have bounded attempts/backoff and retained failed jobs.
- [ ] Verify outbound ledger claim/send/finalize is idempotent across retries and worker crashes.
- [ ] Make `orchestrate()` throw technical failures; business skips remain return values.
- [ ] Prevent webhook `COMPLETED` on retryable or terminal technical failure.
- [ ] Add `FAILED_ORCHESTRATION`, `FAILED_GENERATION`, `FAILED_SEND`, and `DEAD_LETTER` decisions.
- [ ] Ensure every early return in send-bubble either records an intentional terminal skip or leaves a retryable intermediate state.
- [ ] Add worker failed-event finalization using attempt count.
- [ ] Add/extend watchdog for stuck inbound decisions with atomic recovery claims.
- [ ] Test contention, transient DB/provider failure, process crash after provider send, duplicate jobs, stale reply cancellation, and attempts exhausted.

## Phase 2 (P0): Ops authorization

- [ ] Implement a platform-admin guard/claim backed by server-side membership, not request input.
- [ ] Implement/reuse centralized tenant and agency authorization assertions.
- [ ] Categorize each ops route as platform-global or agency-scoped.
- [ ] Restrict global health/flags/queues/all-tenant routes to platform admin.
- [ ] Scope list queries to caller-derived accessible tenants.
- [ ] Validate supplied tenant filters against caller scope.
- [ ] Authorize clear-handover by resolving conversation ownership before mutation.
- [ ] Ensure service methods cannot be called unscoped by requiring an explicit scope object.
- [ ] Add cross-agency read and mutation tests for every ops endpoint.
- [ ] Add audit records for privileged ops mutations.

## Phase 3 (P1): Tenant-scoped data boundary

- [ ] Inventory every service-role query on tenant-owned tables and record owner key/predicate.
- [ ] Create tenant-scoped repositories for conversations, messages, handovers, outbound sends, bookings, KB, follow-up jobs, and logs.
- [ ] Change runtime methods to require `tenantId` alongside resource IDs.
- [ ] Add nullable `messages.tenant_id` migration and composite index.
- [ ] Backfill message tenant IDs from conversations idempotently.
- [ ] Update all message writes/imports to store tenant ID.
- [ ] Add/validate composite conversation ownership constraint; later set `tenant_id NOT NULL`.
- [ ] Review other child tables for equivalent ownership constraints.
- [ ] Define RLS policies and grants for tenant-owned tables.
- [ ] Use JWT-scoped client/RPC for authenticated HTTP data access where practical.
- [ ] Restrict service-role RPC execution and verify tenant ownership inside SQL.
- [ ] Add SQL integration tests for anon, tenant A, tenant B, agency staff, and service role.
- [ ] Add a CI/static check or reviewed allowlist for service-role queries without tenant predicates.

## Phase 4 (P1): Prompt governance and explainability

- [ ] Introduce typed prompt layer and effective reply trace structures.
- [ ] Refactor prompt assembly into named layers with explicit priority.
- [ ] Delimit KB chunks as untrusted evidence, not executable instructions.
- [ ] Record source IDs/versions, hashes, lengths, truncation, and bypass path.
- [ ] Record configured vs actual provider/model and fallback.
- [ ] Record safety governor/formatter transformations by name.
- [ ] Persist safe trace metadata in orchestration logs or a dedicated table.
- [ ] Add an authorized tenant-admin “why this reply” endpoint returning safe metadata.
- [ ] Add configuration conflict validation and warnings.
- [ ] Add prompt parity tests between preview/test and live WhatsApp paths.
- [ ] Add tests for truncation, agency-vs-tenant constraints, KB absence, deterministic bypass, and post-processing.

## Phase 5 (P2): Locale, vertical, legacy, and stubs

- [ ] Add tenant locale/timezone/language policy with validation of IANA zones and languages.
- [ ] Replace fixed UTC+8 timestamp conversion with tenant timezone conversion.
- [ ] Build language instruction from tenant policy; remove global Singapore-only restriction.
- [ ] Move salon/colour/sales cadence rules into opt-in tenant capability/profile configuration.
- [ ] Remove fixed lead-leak phrases and global booking nudges from shared conversation policy.
- [ ] Measure tenants using legacy prompt fallback.
- [ ] Migrate legacy prompt rows to structured profiles and stop dual writes.
- [ ] Remove legacy prompt fallback after zero-use verification.
- [ ] Inventory frontend/runtime callers of audit, contacts, calendars, quota, and AI-router stubs.
- [ ] Unregister unused stub controllers from production.
- [ ] Return typed HTTP 501 only where temporary compatibility is required.
- [ ] Remove orphaned services/shims after reference and test verification.

## Validation gates

- [ ] Targeted unit tests pass after each phase.
- [ ] Backend typecheck and lint pass.
- [ ] Full backend suite passes before merge.
- [ ] Two-tenant security suite passes with no cross-scope rows or mutations.
- [ ] Staging fault injection demonstrates retries and exactly-once ledger behavior.
- [ ] Staging watchdog recovers a deliberately stranded inbound message once.
- [ ] Prompt traces contain no provider keys, tokens, raw unrestricted KB text, or raw transcripts.
- [ ] Additive migrations are applied and rerun idempotently in staging.
- [ ] Rollback/kill-switch behavior is documented and exercised before production rollout.
