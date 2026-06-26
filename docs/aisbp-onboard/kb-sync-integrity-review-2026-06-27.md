# KB Sync Integrity Review — 2026-06-27

> **Status**: Review complete. All boundaries verified. No issues found.
> **PRs reviewed**: 10D through 10H-B, plus security PRs 6A, 8A, 9A, 9B, 10A, 10D-A, 10E-A, 10F-A, 10H-A, 10H-B.

---

## 1. Agent Boundary — VERIFIED

| Check | Status |
|-------|--------|
| Agent uses separate `AgentTokenGuard` (not JWT) | PASS |
| Agent controller has no approve/sync/dry-run/apply methods | PASS |
| Agent cannot call operator endpoints (different auth) | PASS |
| Agent can only: create sessions, submit answers, submit analysis, request review, get status/missing-fields | PASS |
| AgentTokenGuard validates against `ONBOARD_AGENT_API_TOKEN` env var with timing-safe comparison | PASS |

## 2. Operator Boundary — VERIFIED

| Check | Status |
|-------|--------|
| All operator endpoints use `JwtAuthGuard + OnboardOperatorGuard` | PASS |
| `OnboardOperatorGuard` enforces `OWNER / ADMIN / OPERATOR` agency roles | PASS |
| `MEMBER` role blocked (403) | PASS |
| Agent token blocked (different auth mechanism) | PASS |
| Unauthenticated blocked (401 via `JwtAuthGuard`) | PASS |

## 3. Apply Gates — VERIFIED

Every `kbApply()` scope checks these 17 gates:

| # | Gate | Status |
|---|------|--------|
| 1 | JwtAuthGuard + OnboardOperatorGuard | PASS |
| 2 | Project exists | PASS |
| 3 | Project status = APPROVED | PASS |
| 4 | syncRunId exists | PASS |
| 5 | syncRun belongs to same project | PASS |
| 6 | syncRun targetSystem = KB | PASS |
| 7 | syncRun mode = DRY_RUN | PASS |
| 8 | syncRun status = DRY_RUN_PASSED | PASS |
| 9 | dryRunSchemaVersion = kb-dry-run-v1 | PASS |
| 10 | syncRun has sourceSnapshotHash | PASS |
| 11 | Current sourceSnapshotHash matches dry-run | PASS |
| 12 | confirmApply = true | PASS |
| 13 | idempotencyKey present | PASS |
| 14 | ONBOARD_KB_SYNC_ENABLED = true | PASS |
| 15 | AISBP_OUTBOUND_THROUGH_KB_ENABLED unchanged | PASS |
| 16 | No dry-run blockers | PASS |
| 17 | No secrets/full phone in payload | PASS |

## 4. Apply Scopes — VERIFIED

| Scope | Implemented | Writes |
|-------|------------|--------|
| TENANT_IDENTITY_ONLY | PR 10D/10D-A | `tenants` via `TenantsService.createTenant` |
| BOT_PROFILE_PROMPT_ONLY | PR 10E/10E-A | `tenant_bot_profiles` + `tenant_prompt_configs` via `BotProfilesService.createBotProfile` |
| FAQ_KNOWLEDGE_ONLY | PR 10F/10F-A | `knowledge_documents` + `knowledge_chunks` via `KbService.createFaq/updateFaq` |
| BOOKING_HANDOVER_ONLY | PR 10G | `tenant_booking_settings` + `tenant_human_escalation_settings` |
| FOLLOW_UP_SETTINGS_ONLY | PR 10H/10H-A/10H-B | `tenant_follow_up_settings` |

Each scope is explicit — no scope accidentally triggers other phases.

## 5. Disabled Safety Defaults — VERIFIED

| Config | Final Value | Status |
|--------|------------|--------|
| Bot profile active | `false` (`setActive: false`) | PASS |
| Booking enabled | `false` | PASS |
| Booking internal alerts | `false` | PASS |
| Handover enabled | `false` | PASS |
| Handover notification number | `null` | PASS |
| Follow-up enabled | `false` | PASS |
| Follow-up execution | `false` | PASS |
| Each follow-up step enabled | `false` | PASS |
| Queue jobs created | `false` (no `@nestjs/bullmq` in Onboard) | PASS |
| Messages sent | `false` | PASS |
| GHL sync | `false` (no GHL API calls in Onboard) | PASS |
| Outbound flag | `false` (unchanged) | PASS |

## 6. PII/Secrets Safety — VERIFIED

| Check | Status |
|-------|--------|
| Full phone numbers written to KB | No — `clientContactPhone: null`; masked phone is display-only |
| Secrets in sync_runs | No — only project IDs, client keys, hashes |
| Raw API keys | None in codebase |
| Webhook secrets | None in Onboard codebase |
| DB credentials | None hardcoded |
| Auth tokens | Only referenced via env vars, never hardcoded |

## 7. Idempotency — VERIFIED

| Operation | Idempotency Mechanism |
|-----------|----------------------|
| Tenant creation | Checks `onboarding_identity_map.kb_tenant_id` first; skips if exists |
| Bot profile creation | Checks `tenant_bot_profiles` by `name='Onboard Config'` per tenant |
| FAQ creation | Checks `knowledge_documents` by title match; updates if answer changed |
| Booking settings | Service uses upsert via `tenant_id` PK |
| Handover settings | Service uses upsert via `tenant_id` PK |
| Follow-up settings | Service uses upsert via `tenant_id` PK |
| sync_runs | `idempotency_key` checked; returns existing `APPLIED` result |

## 8. Snapshot Safety — VERIFIED

| Check | Status |
|-------|--------|
| `sourceSnapshotHash` includes full sanitized content from all sections | PASS |
| Stale dry-run blocks apply | PASS (hash comparison in `kbApply`) |
| Volatile fields excluded (timestamps, actorId, syncRunId) | PASS |
| FAQ answer changes affect hash | PASS (full answer in snapshot) |
| Recommendation content changes affect hash | PASS (desc, config in snapshot) |
| Prompt config changes affect hash | PASS (12 fields) |
| Follow-up content changes affect hash | PASS (goal, cadence in snapshot) |
| Phone numbers masked in snapshot | PASS |

## 9. UI Wording — VERIFIED

| Page | Verbiage Accuracy |
|------|------------------|
| Dashboard | Shows client/project counts only |
| Client detail | "Section editing and approval comes in future PRs" |
| Sync page | Scope-specific banners, "No GHL sync", "No outbound sending" |
| Review queue | "Approval workflow is future (PR 6+)" |
| Settings | "Integration pending", feature flags all `false` |

No page claims GHL sync is active. No page claims bot is live.

## 10. Sync Run / Audit Quality — VERIFIED

Every apply creates:
- `sync_runs` row with `appliedScope`, `kbTenantId`, `sourceSnapshotHash`, `skipped` list
- `audit_events` row with `actorId`, `actorType`, `action`, `resourceId`
- Response includes `noMessagesSent`, `noGhlSync`, `outboundEnabled: false`

## 11. KB Services Safety — VERIFIED

| Service | Method | Side Effects |
|---------|--------|-------------|
| `TenantsService` | `createTenant` | Creates tenant + quota wallet (safe) |
| `BotProfilesService` | `createBotProfile` | Creates profile + prompt config (safe, called with `setActive: false`) |
| `KbService` | `createFaq` / `updateFaq` | Creates/updates documents + chunks (safe, READY status acceptable for inactive tenant) |
| `BookingSettingsService` | `patchBookingSettings` | Upserts settings (safe, `enabled: false`) |
| `HumanEscalationSettingsService` | `patchSettings` | Upserts settings (safe, `enabled: false`) |
| `FollowUpSettingsService` | `patchFollowUpSettings` | Upserts settings (safe, `enabled: false`, steps disabled) |

No outbound/GHL/queue/messaging modules imported in Onboard module.

## 12. Remaining Work

| PR | Scope | Priority |
|----|-------|----------|
| PR 11 | Wyn Notification (in-app review queue badge) | Medium |
| PR 12 | GHL Validation / Dry Run | Medium |
| PR 10J | KB Controlled Go-Live / Bot Activation Dry Run | Low (after all config synced) |
| PR 13 | GHL Controlled Sync Apply | Low (requires GHL integration) |

## 13. Issues Found

None. All 12 integrity checks pass. No code changes needed for this review.

## 14. Safety Confirmation

- No app code changed
- No DB changed
- No migrations
- No env changed
- No runtime flags changed
- No deployment needed
- No live tests run
- No messages sent
