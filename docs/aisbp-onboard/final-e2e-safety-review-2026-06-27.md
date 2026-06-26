# Final End-to-End Safety Review — AISBP-Onboard

> **Date**: 2026-06-27
> **Status**: Review complete. Controlled pilot planning recommended.
> **PRs reviewed**: 1 through 12B (22 PRs total)

---

## 1. Executive Summary

AISBP-Onboard is ready for controlled pilot planning. All 13 safety boundaries have been verified. The system enforces the core architecture:

```
AI Agent → AISBP-Onboard Draft → Wyn Review → Approved Sync → KB/GHL
```

**What works**: Agent intake, operator review/approval, 5 scoped KB sync phases (tenant, bot profile, FAQ, booking/handover, follow-up), in-app alerts, GHL validation/dry-run.

**What's intentionally disabled**: Bot activation, follow-up execution, GHL apply sync, external notifications, outbound messaging.

**What's deferred**: Controlled pilot runbook, bot activation dry-run, GHL apply sync, external Wyn notification.

---

## 2. Implemented Scope

### Backend (23 endpoints)

| Category | Endpoints | Guard |
|----------|-----------|-------|
| Agent Intake | 7 (sessions, answers, analysis, review, status, missing-fields) | AgentTokenGuard |
| Operator CRUD | 8 (clients CRUD, projects CRUD) | JwtAuthGuard + OnboardOperatorGuard |
| Approval | 6 (section approve, request changes, reject, project approve, approval events, audit) | JwtAuthGuard + OnboardOperatorGuard |
| KB Sync | 6 (dry-run, apply, plan-preview, sync-runs, analysis, recommendations) | JwtAuthGuard + OnboardOperatorGuard |
| In-App Alerts | 1 (review-alerts) | JwtAuthGuard + OnboardOperatorGuard |
| GHL Validation | 2 (validate, dry-run) | JwtAuthGuard + OnboardOperatorGuard |

### Frontend (9 routes)

Dashboard, Clients, Client Detail, Review Queue, Sessions, Sync Preview, Audit, Settings, Login

### Database (15 tables, 24 enums, 1 migration)

All Onboard tables follow `onboard_*` prefix convention. No KB table modifications.

---

## 3. Intentionally Disabled Scope

| Feature | Current State | Reason |
|---------|--------------|--------|
| Bot profile activation | `setActive: false` | Controlled go-live deferred |
| Booking execution | `enabled: false` | No GHL sync, no outbound |
| Handover execution | `enabled: false` | No GHL sync |
| Follow-up execution | `enabled: false`, each step disabled | No queue jobs, no messages |
| GHL apply sync | Not implemented | No GHL API calls |
| External notifications | Not implemented | In-app only |
| WhatsApp/email/SMS | Not called | No messaging modules imported |
| Outbound sending | `AISBP_OUTBOUND_THROUGH_KB_ENABLED = false` | Unchanged |
| Full phone display | Masked by default | Privacy requirement |

---

## 4. Safety Gates

Every KB apply scope requires all 17 gates:

| # | Gate | Verified |
|---|------|----------|
| 1 | JwtAuthGuard + OnboardOperatorGuard | ✓ |
| 2 | Project exists | ✓ |
| 3 | Project status = APPROVED | ✓ |
| 4 | syncRunId exists | ✓ |
| 5 | syncRun belongs to project | ✓ |
| 6 | targetSystem = KB | ✓ |
| 7 | mode = DRY_RUN | ✓ |
| 8 | status = DRY_RUN_PASSED | ✓ |
| 9 | dryRunSchemaVersion = kb-dry-run-v1 | ✓ |
| 10 | sourceSnapshotHash exists | ✓ |
| 11 | Current hash matches dry-run hash | ✓ |
| 12 | confirmApply = true | ✓ |
| 13 | idempotencyKey present | ✓ |
| 14 | ONBOARD_KB_SYNC_ENABLED = true | ✓ |
| 15 | AISBP_OUTBOUND_THROUGH_KB_ENABLED unchanged | ✓ |
| 16 | No dry-run blockers | ✓ |
| 17 | No secrets/full phone in payload | ✓ |

---

## 5. Agent Boundary

| Check | Status |
|-------|--------|
| Agent uses separate `AgentTokenGuard` | ✓ |
| Agent controller has 7 endpoints only | ✓ |
| Agent cannot approve (no approval endpoints) | ✓ |
| Agent cannot dry-run (different guard) | ✓ |
| Agent cannot apply sync (different guard) | ✓ |
| Agent cannot call GHL (no GHL imports in agent) | ✓ |
| Agent cannot send messages (no outbound imports) | ✓ |

## 6. Operator Boundary

| Check | Status |
|-------|--------|
| All operator endpoints use JwtAuthGuard + OnboardOperatorGuard | ✓ |
| OWNER/ADMIN/OPERATOR roles required | ✓ |
| MEMBER blocked (403) | ✓ |
| Public blocked (401) | ✓ |
| Agent token blocked (different auth) | ✓ |

## 7. KB Sync Scope Status

| Scope | Tenant | Bot | FAQ | Booking | Handover | Follow-Up |
|-------|--------|-----|-----|---------|----------|-----------|
| TENANT_IDENTITY_ONLY | ✓ | — | — | — | — | — |
| BOT_PROFILE_PROMPT_ONLY | req | ✓ | — | — | — | — |
| FAQ_KNOWLEDGE_ONLY | req | — | ✓ | — | — | — |
| BOOKING_HANDOVER_ONLY | req | — | — | ✓(dis) | ✓(dis) | — |
| FOLLOW_UP_SETTINGS_ONLY | req | — | — | — | — | ✓(dis) |

req = required (kbTenantId must exist)
dis = disabled by default

## 8. GHL Validation Status

| Check | Status |
|-------|--------|
| Local validation (no GHL API calls) | ✓ |
| No-write dry-run plan preview | ✓ |
| sync_runs recorded | ✓ |
| audit_events recorded | ✓ |
| GHL history UI grouped separately | ✓ |
| No GHL mutation methods called | ✓ |
| No workflows triggered | ✓ |
| No appointments created | ✓ |

## 9. Notification Status

| Check | Status |
|-------|--------|
| In-app review alert endpoint | ✓ |
| Dashboard badge with count | ✓ |
| Nav sidebar dynamic badge | ✓ |
| Alert banner on dashboard | ✓ |
| No WhatsApp/email/SMS | ✓ |
| No external notification path | ✓ |

## 10. PII/Secrets Status

| Check | Status |
|-------|--------|
| Full phone masked by default | ✓ |
| Masked phone display-only | ✓ |
| No full phone in KB writes | ✓ |
| No API keys/tokens in sync_runs | ✓ |
| No webhook secrets committed | ✓ |
| No DB credentials committed | ✓ |
| No real env values in code | ✓ |

## 11. Idempotency

| Operation | Mechanism | Status |
|-----------|-----------|--------|
| Sessions | Existing active session returned | ✓ |
| Answers | project+section+questionKey upsert | ✓ |
| Recommendations | AI_ANALYSIS+SUGGESTED deduped | ✓ |
| KB tenant | identity_map.kbTenantId check | ✓ |
| Bot profile | tenant_bot_profiles name lookup | ✓ |
| FAQ docs | title normalized matching + updateFaq | ✓ |
| Settings | upsert via tenant_id PK | ✓ |
| sync_runs | idempotencyKey uniqueness | ✓ |

## 12. Snapshot/Staleness

| Check | Status |
|-------|--------|
| Full sanitized content in hash | ✓ |
| Stale dry-run blocks apply | ✓ |
| FAQ answer changes affect hash | ✓ |
| Prompt config changes affect hash | ✓ |
| Follow-up changes affect hash | ✓ |
| Volatile fields excluded | ✓ |

## 13. UI Accuracy

| Page | Verbiage | Status |
|------|----------|--------|
| Dashboard | In-app alert only, no external notifications | ✓ |
| Sync | Scope-specific banners, disabled labels | ✓ |
| Review Queue | In-app only, future external notification noted | ✓ |
| GHL | No GHL writes, no workflows, no appointments | ✓ |
| Settings | Feature flags all false, integration pending | ✓ |
| Client Detail | Sections future, approval active | ✓ |

No page claims bot is live, GHL is synced, messages are sent, or outbound is active.

## 14. Known Limitations

1. Bot profile remains inactive until future controlled go-live PR
2. GHL apply sync is not implemented — validation/dry-run only
3. External Wyn notification (WhatsApp/email) is not implemented — in-app only
4. Follow-up is stored disabled only — plan preserved, execution blocked
5. Booking/handover are stored disabled only
6. No live WhatsApp/GHL tests have been run through Onboard
7. Controlled pilot still requires explicit manual checklist
8. Multi-step follow-up rules summarized to single step

## 15. Controlled Pilot Readiness

| Prerequisite | Status |
|-------------|--------|
| Agent can submit drafts | ✓ |
| Operator can review/approve | ✓ |
| KB sync gates verified | ✓ |
| All writes audited | ✓ |
| PII/secrets safe | ✓ |
| No accidental outbound/GHL | ✓ |
| Feature flags default off | ✓ |
| Controlled pilot checklist needed | — (next PR) |

Ready for PR 14 — Controlled Pilot Runbook + Manual Test Checklist.

## 16. Safety Confirmation

- No app code changed in this review
- No DB changed
- No migrations
- No env changed
- No runtime flags changed
- No deployment performed
- No live tests run
- No messages sent
