# KB Spec Compliance Gap Review — 2026-06-26

## 1. Executive Summary

KB / AISalesBot Pro is production-ready for its core single-brain messaging loop: inbound webhook → AI orchestration → outbound GHL send, with runtime safety guards (idempotency, stale reply, ordering, tenant caps) and GHL pre-reply context sync all active. The operations dashboard (PR #10C) is live and read-only. The metrics/audit foundation (PR #10A) is emitting events. Backend ops APIs (PR #10B) expose all key data points.

**Gaps**: Webhook signature verification is implemented (corrected from prior assessment). The quota threshold alert and handover notify processors are still stubs. No automated alert pipeline exists for error-rate or failure thresholds. Follow-up engine lacks a periodic stale-job cleanup cron. Contact ID normalization happens only at send-time (fallback), not at conversation creation. RLS policies remain at the plan stage. The outbound webhook tracking endpoint has a dead-code logic bug.

**Overall readiness**: Suitable for production use with the current single-tenant (AISBP Agency) deployment. Multi-tenant expansion and automated ops monitoring are the next natural phases.

---

## 2. Current Stable Baseline

| Area | Status |
|------|--------|
| Supabase Auth + JWT guard | Complete |
| GHL Private Integration (token encrypt/decrypt) | Complete |
| Webhook ingress (POST /webhooks/ghl) | Complete |
| Webhook dedupe (3-tier) | Complete |
| Webhook signature verification | Complete |
| Inbound message processing (BullMQ) | Complete |
| AI orchestration (prompt, KB, routing, generation) | Complete |
| Outbound send via GHL (POST /conversations/messages) | Complete |
| OutboundSend idempotency ledger | Complete |
| Stale reply protection | Complete |
| Conversation ordering lock | Complete |
| Tenant cap semaphore | Complete |
| GHL pre-reply context sync | Complete (tenant-limited) |
| Metrics/audit fire-and-forget events | Complete (PR #10A) |
| Ops read APIs (9 GET endpoints) | Complete (PR #10B) |
| Operations dashboard (10 sections) | Complete (PR #10C) |
| Booking flow | Complete |
| Follow-up engine | Complete |
| Human escalation | Complete |
| Auto-tagging | Complete |
| Knowledge base (vaults, documents, chunks) | Complete |
| Bot profiles + prompt management | Complete |
| Credit/quota system | Complete |
| CI/CD pipeline | Complete |
| Unit + integration tests | 1079 passing |
| Contact ID phone fallback (send-time) | Complete |
| Outbound webhook tracking endpoint | Deployed, disabled (GHL doesn't send OutboundMessage webhooks) |

---

## 3. Spec Coverage Matrix

### Core Messaging Flow

| Area | Spec Expectation | Current Implementation | Status | Evidence | Risk |
|------|-----------------|----------------------|--------|----------|------|
| Webhook ingress | Accept GHL webhooks, dedupe, persist | `WebhooksController` + `WebhookEvent` table | Complete | `webhooks.controller.ts`, `webhooks.service.ts` | Low |
| Webhook signature verification | Verify GHL signatures or static token | Dual-mode: HMAC-SHA256 + static token | Complete | `webhook-verification.service.ts` | Low |
| Tenant resolution | Match locationId to tenant | `resolveInboundGhlWebhookTenant()` | Complete | `ghl-inbound-webhook-tenant-resolution.ts` | Low |
| Conversation create/upsert | Get or create conversation by GHL ID | `getOrCreateConversation()` in processor | Complete | `inbound-message.processor.ts:1697` | Low |
| Message persistence | Store inbound + outbound messages | `messages` table writes | Complete | `inbound-message.processor.ts`, `outbound-send.service.ts` | Low |
| AI orchestration | Generate reply via configured AI model | `ConversationOrchestrationService.orchestrate()` | Complete | `orchestration.service.ts` | Low |
| GHL send | POST /conversations/messages | `OutboundSendService.sendReply()` | Complete | `outbound-send.service.ts` | Low |
| Channel fallback | SMS fallback on channel errors | `ghlOutboundFallbackChannels()` | Complete | `ghl-channel-routing.ts` | Low |
| Coalesce/format | Bubble join + WhatsApp formatting | `maybeCoalesceOutboundBubbles()` | Complete | `outbound-coalesce.ts` | Low |

### Runtime Safety Guards

| Area | Spec Expectation | Current Implementation | Status | Evidence | Risk |
|------|-----------------|----------------------|--------|----------|------|
| Idempotency | Prevent duplicate sends | `claimOutboundSend()` + unique index | Complete | `outbound-send.service.ts:851` | Low |
| Retry reclaim | Reclaim failed sends on retry | `reclaimOutboundSendOnRetry()` | Complete | `outbound-send.service.ts:905` | Low |
| Stale reply | Cancel stale AI replies | `isReplyStale()` check | Complete | `send-bubble.processor.ts:122` | Low |
| Conversation ordering | Sequential bubble sends | `acquireLock()` on conv lock key | Complete | `send-bubble.processor.ts:101` | Low |
| Tenant caps | Limit concurrent sends per tenant | `acquireSemaphore()` ZSET | Complete | `send-bubble.processor.ts:86` | Low |

### GHL Pre-Reply Sync

| Area | Spec Expectation | Current Implementation | Status | Evidence | Risk |
|------|-----------------|----------------------|--------|----------|------|
| Context sync | Fetch GHL messages before AI | `syncGhlConversationContext()` | Complete | `ghl-conversation-sync.ts` | Low |
| Manual message import | Import dashboard-sent messages | `isKbOwnReply()` dedup check | Complete | `ghl-conversation-sync.ts:280` | Low |
| Tenant allowlist | Limit sync to specific tenants | `GHL_PRE_REPLY_CONTEXT_SYNC_TENANTS` | Complete | `ghl-conversation-sync.ts:291` | Low |

### Quota / Credits

| Area | Spec Expectation | Current Implementation | Status | Evidence | Risk |
|------|-----------------|----------------------|--------|----------|------|
| Quota deduction | Debit on successful send only | `debitQuotaForReply()` | Complete | `outbound-send.service.ts:621` | Low |
| Idempotent debit | No double debit on retry | `idempotency_key` on quota_ledgers | Complete | `outbound-send.service.ts:647` | Low |
| Low credit warnings | Warn when credits run low | `CreditWarningsService` | Complete | `credit-warnings.service.ts` | Low |
| Unlimited credits | Agency system workspace bypass | `credits_unlimited` flag | Complete | `outbound-send.service.ts:583` | Low |

### Handover / Escalation

| Area | Spec Expectation | Current Implementation | Status | Evidence | Risk |
|------|-----------------|----------------------|--------|----------|------|
| Handover pause | Skip AI when conversation handed over | `SKIP_HANDOVER_ACTIVE` guard | Complete | `orchestration.service.ts` | Low |
| Resume AI | Resume when agent resumes | `resumeHandover()` | Complete | `handover` module | Low |
| Human escalation alerts | Notify internal team | `HumanEscalationRuntimeService` | Complete | `human-escalation-runtime.service.ts` | Low |
| Holding reply | Reply while waiting for human | `tryEnqueueHoldingReply()` | Complete | `human-escalation-holding-reply.service.ts` | Low |

### Operations / Monitoring

| Area | Spec Expectation | Current Implementation | Status | Evidence | Risk |
|------|-----------------|----------------------|--------|----------|------|
| Metrics events | Fire-and-forget event writes | `MetricsService.emit()` | Complete | `metrics.service.ts` | Low |
| Audit logging | Real audit_logs writes | `AuditService.log()` | Complete | `audit.service.ts` | Low |
| Ops read APIs | GET /ops/* endpoints | 9 endpoints | Complete | `ops.controller.ts` | Low |
| Ops dashboard | Web UI for ops data | 10-tab dashboard | Complete | `/app/agency/ops/page.tsx` | Low |
| Quota threshold alerts | Alert on quota exhaustion | Stub — `TODO: Implement` | **Missing** | `quota-threshold-alert.processor.ts` | Medium |
| Handover notifications | Notify agents | Stub — `TODO: Implement` | **Missing** | `handover-notify.processor.ts` | Medium |
| Cross-cutting alert pipeline | Error/failure rate alerts | Not implemented | **Missing** | — | Medium |
| Error rate monitoring | Track GHL 400/401/429 rates | `metrics_events` table exists, no alerting | Partial | `metrics.service.ts` | Low |

### Webhook / Outbound Tracking

| Area | Spec Expectation | Current Implementation | Status | Evidence | Risk |
|------|-----------------|----------------------|--------|----------|------|
| Webhook auto-registration | Register webhook URL with GHL | Not implemented | **Missing** | — | Low |
| Outbound message webhook | Receive GHL OutboundMessage events | Endpoint exists, flag disabled | **Partial** | `webhooks.controller.ts:140` | Low |
| Outbound tracking bug | `if (!authResult)` dead code | Logic bug at line 156 | **Bug** | `webhooks.controller.ts:156` | Low |

### Data Integrity

| Area | Spec Expectation | Current Implementation | Status | Evidence | Risk |
|------|-----------------|----------------------|--------|----------|------|
| Contact ID normalization | Store GHL internal IDs, not phone numbers | Only at send-time fallback | **Partial** | `resolveContactIdIfPhone()` | Medium |
| Bad contact rows | 2 conversations with phone-format IDs | `c6d0250f` fixed, `07fd8cdd` pending | **Partial** | DB inspection | Medium |
| RLS policies | Row-level security on Supabase | Planned, not applied | **Missing** | `RLS_PLAN.md` | Low |

### Queue / Worker Health

| Area | Spec Expectation | Current Implementation | Status | Evidence | Risk |
|------|-----------------|----------------------|--------|----------|------|
| Retry behavior | Exponential backoff on failures | All queues configured | Complete | `queue.constants.ts` | Low |
| Concurrency | Multiple workers for high-volume | Inbound: 3, Media: 2, others: 1 | Complete | Processor decorators | Low |
| Stale job cleanup | Remove orphaned follow-up jobs | Reactive invalidation only | **Partial** | `follow-up-engine.service.ts` | Medium |
| Dead letter monitoring | Track repeatedly failing jobs | `outbound_sends` status tracks attempts | Partial | `outbound-send.service.ts` | Low |

### Testing

| Area | Spec Expectation | Current Implementation | Status | Evidence | Risk |
|------|-----------------|----------------------|--------|----------|------|
| Unit tests | Services + processors | 1079 tests passing | Complete | `*.spec.ts` files | Low |
| Integration tests | End-to-end flow verification | 3 integration specs | **Partial** | `src/integration/` | Low |
| E2E tests | Live GHL → AISBP → GHL | Not automated | **Missing** | Smoke test scripts only | Medium |
| Stress tests | Tenant cap concurrency | Not tested | **Missing** | — | Low |

---

## 4. Main Gaps Found

### Gap 1: Quota Threshold Alert Processor (Stub)

- **Problem**: The `quota-threshold-alert.processor.ts` is a stub that logs `processor_not_implemented` and returns. No actual alert is sent when credits run low.
- **Why it matters**: The credit warning system depends on `CreditWarningsService` which fires on debit, but the BullMQ processor path (for scheduled/batch checks) is non-functional.
- **Current evidence**: `quota-threshold-alert.processor.ts` — `TODO: Implement full alert logic`.
- **Recommended solution**: Implement the processor to check all tenants' credit levels against thresholds on a schedule and trigger notifications.
- **Risk level**: Medium
- **Suggested PR**: `pr/ops-quota-alert-processor`

### Gap 2: Handover Notify Processor (Stub)

- **Problem**: The `handover-notify.processor.ts` is a stub. No notification is sent to agents when handover is requested via the queue.
- **Why it matters**: While `HumanEscalationRuntimeService` handles direct internal alerts, the queued notification path (for external/3rd-party agent notification) is incomplete.
- **Current evidence**: `handover-notify.processor.ts` — `TODO: Implement full notification logic`.
- **Recommended solution**: Implement email/SMS/push notification for agents when handover is requested.
- **Risk level**: Medium
- **Suggested PR**: `pr/ops-handover-notify-processor`

### Gap 3: Follow-Up Engine Stale Job Cleanup

- **Problem**: The follow-up engine removes pending jobs reactively (when customer replies or state resets) but has no periodic cron to clean up orphaned PENDING rows whose BullMQ jobs were lost (e.g., Redis restart).
- **Why it matters**: Over time, `conversation_follow_up_jobs` table accumulates stale PENDING rows. BullMQ `removeOnFail: false` means failed jobs persist. No pruning mechanism exists.
- **Current evidence**: Grep for `@Cron`, `@Interval`, cleanup patterns in follow-up engine returned zero results.
- **Recommended solution**: Add a periodic cron (`@Cron` or `@Interval`) that marks PENDING jobs older than N hours as `EXPIRED` and removes their BullMQ counterparts.
- **Risk level**: Medium
- **Suggested PR**: `pr/ops-follow-up-stale-job-cleanup`

### Gap 4: Contact ID Normalization at Creation Time

- **Problem**: `getOrCreateConversation()` stores the raw `contactId` from the webhook payload without normalizing phone-format IDs to GHL internal IDs. Different webhook payloads for the same contact can produce separate conversation records.
- **Why it matters**: Two known conversations (`c6d0250f`, `07fd8cdd`) have phone-format `contact_id`. The send-time fallback (`resolveContactIdIfPhone`) works but is a patch, not a fix.
- **Current evidence**: `inbound-message.processor.ts:1697` — `ghlContactId` passed directly to `deriveConversationIdentity()` without normalization.
- **Recommended solution**: In `getOrCreateConversation()`, check if `contactId` looks like a phone number and resolve it to a GHL internal ID via `findContactByPhone()` before creating/deriving the conversation.
- **Risk level**: Medium
- **Suggested PR**: `pr/fix-contact-id-normalization-at-creation`

### Gap 5: Outbound Webhook Tracking Bug

- **Problem**: Line 156 in `webhooks.controller.ts`: `const authResult = this.verifyWebhook(req); if (!authResult) { ... }`. `verifyWebhook()` returns an object with `{ ok: boolean }` (or throws), so `!authResult` is always falsy — the unauthorized handler is dead code. Additionally, the entire endpoint is disabled (`AISBP_OUTBOUND_THROUGH_KB_ENABLED=false`) because GHL does not send `OutboundMessage` webhooks for manual dashboard sends.
- **Why it matters**: If the flag is ever enabled, the endpoint's auth check is broken. The dead-code condition means an unverified request proceeds without throwing — or the verify method already throws, making the check redundant.
- **Current evidence**: `webhooks.controller.ts:156` — `if (!authResult)` dead code.
- **Recommended solution**: Fix the auth check (remove dead code or fix condition) and document that GHL must be configured to send OutboundMessage webhooks for this feature to work.
- **Risk level**: Low (flag is disabled)
- **Suggested PR**: `pr/fix-outbound-webhook-auth-check`

---

## 5. What NOT To Do Yet

1. **Do not enable `AISBP_OUTBOUND_THROUGH_KB_ENABLED`** — GHL doesn't send OutboundMessage webhooks for manual sends; the endpoint has an auth check bug; GHL pre-reply sync already fills the manual message gap.
2. **Do not implement RLS policies yet** — Backend enforces all tenant isolation via application code with `checkTenantAccess()`. RLS is a second layer that would require careful testing and could break existing queries. Defer until multi-tenant expansion.
3. **Do not implement webhook auto-registration** — GHL's API for auto-registration is not documented/confirmed. Manual webhook setup in GHL UI is sufficient for now.
4. **Do not add E2E tests that send real messages** — The smoke test scripts exist for manual verification. Automated E2E tests with live GHL would require test contacts and could trigger real costs.
5. **Do not refactor the orchestration pipeline** — It works stably. Performance optimization can wait.

---

## 6. Recommended Next PR Roadmap

### PR #10D: Fix Contact ID Normalization at Creation
- **Goal**: Normalize phone-format `contactId` to GHL internal ID in `getOrCreateConversation()`, preventing future bad rows.
- **Files**: `inbound-message.processor.ts`, `conversation-identity.ts`, tests
- **Why now**: Prevents data integrity issues; existing 2 bad rows can be backfilled later.
- **Risk level**: Medium
- **Validation**: Unit tests for phone-format detection + GHL resolution; verify no new bad rows appear.
- **Rollback**: Revert commit; existing rows unchanged.

### PR #10E: Follow-Up Stale Job Cleanup Cron
- **Goal**: Add periodic cleanup of stale/orphaned follow-up jobs to prevent DB bloat.
- **Files**: `follow-up-engine.service.ts`, `follow-up-engine.module.ts`, tests
- **Why now**: The engine has been running in production; stale jobs accumulate silently.
- **Risk level**: Medium
- **Validation**: Unit tests for cron logic; manual verification on VPS after deploy.
- **Rollback**: Revert commit; stale jobs persist but no data loss.

### PR #10F: Quota Threshold Alert Processor
- **Goal**: Replace stub with real implementation — periodic check of all tenant credit levels, send alerts via configured channels.
- **Files**: `quota-threshold-alert.processor.ts`, `credit-warnings.service.ts`, tests
- **Why now**: Closes a stub gap; critical for multi-tenant safety.
- **Risk level**: Medium
- **Validation**: Unit tests; manual verification with test tenant.
- **Rollback**: Revert commit; credit warnings from debit path still work.

### PR #10G: Ops Alert Pipeline
- **Goal**: Add automated alerting when error rates (GHL 400/401/429), failed send rates, or queue backlogs exceed thresholds.
- **Files**: New `alert-pipeline.service.ts`, `ops.service.ts` (threshold checks), tests
- **Why now**: Operations dashboard shows data but no automated reaction; critical for production monitoring.
- **Risk level**: Low
- **Validation**: Unit tests with threshold simulation; verify alerts fire on test data.
- **Rollback**: Revert commit; dashboard still works.

### PR #10H: Handover Notify Processor
- **Goal**: Replace stub with real implementation — send email/SMS/push notifications to agents on handover.
- **Files**: `handover-notify.processor.ts`, tests
- **Why now**: Closes a stub gap.
- **Risk level**: Low
- **Validation**: Unit tests; manual verification with test handover.
- **Rollback**: Revert commit; existing escalation alerts still work.

### PR #10I: Fix Outbound Webhook Auth Check + Backfill Bad Contact Rows
- **Goal**: Fix the dead-code auth check in outbound webhook endpoint; backfill the 2 known bad contact_id rows.
- **Files**: `webhooks.controller.ts`, migration for backfill, tests
- **Why now**: Low-risk cleanup; prepares for potential future outbound tracking.
- **Risk level**: Low
- **Validation**: Unit tests; verify backfill doesn't affect production.
- **Rollback**: Revert commit.

---

## 7. Production Safety Notes

- **No code changed** — this report is documentation only.
- **No DB changed** — no migrations, no schema modifications.
- **No env changed** — all environment variables and flags remain at their verified values.
- **No runtime flags changed** — `AISBP_*`, `GHL_*` flags unchanged from production baseline.
- **No WhatsApp/GHL live tests run** — entirely read-only code review.
- **No messages sent** — zero interactions with GHL API or WhatsApp.
- **Report file created**: `docs/reviews/kb-spec-compliance-gap-review-2026-06-26.md`

---

## 8. Documents Reviewed

| Document | Key Insights |
|----------|-------------|
| `README.md` | Architecture principles, tech stack, deployment, GHL integration setup |
| `NEXT_STEPS.md` | Original implementation roadmap (all 5 phases largely complete) |
| `docs/AISBP_PRODUCTION_SMOKE_TEST.md` | Manual smoke test procedure for webhook loop |
| `docs/AISBP_DESIGN_SYSTEM.md` | Frontend design tokens and component library |
| `docs/CLIENT_PIPELINE_FOLLOW_UP_PROPOSAL.md` | Follow-up engine design |
| `docs/VPS_DEPLOY.md` | Deployment guide |
| `openspec/changes/refactor-booking-flow-reliability/proposal.md` | Booking flow improvement proposal (completed) |
| `apps/backend/prisma/rls/RLS_PLAN.md` | RLS policies planned but not applied |
| All backend source files | Code-level compliance verification |
| All frontend source files | Dashboard + design system verification |
