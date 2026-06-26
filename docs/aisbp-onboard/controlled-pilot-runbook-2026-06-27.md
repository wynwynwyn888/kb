# AISBP-Onboard Controlled Pilot Runbook — 2026-06-27

> **Status**: Documentation only. No changes to production behavior.
> **Purpose**: Controlled pilot/test checklist for AISBP-Onboard.
> **Warning**: This runbook does NOT authorize live GHL writes, outbound messaging, bot activation, or production go-live.

---

## 1. Purpose

This runbook guides a controlled internal pilot of AISBP-Onboard with one test project. The goal is to verify every step of the Onboard flow safely — from agent intake through KB sync — without enabling GHL integration, outbound messaging, bot activation, or production client go-live.

Every step in this checklist is safe: no GHL writes, no messages, no bot activation.

The runbook follows the core architecture:

```
AI Agent → AISBP-Onboard Draft → Wyn Review → Approved Sync → KB/GHL
```

---

## 2. Pilot Scope

### Allowed

| Action | Notes |
|--------|-------|
| Create one test pilot client/project | Use clearly labeled test/pilot data |
| Submit draft answers via Agent API | Use mock or local test data |
| Review and approve sections as Wyn/operator | All approval actions are audited |
| Run KB dry-run | No-write preview |
| Run KB apply scopes | Only if `ONBOARD_KB_SYNC_ENABLED` is explicitly enabled in safe environment |
| Run GHL validation/dry-run | Local checks only, no GHL API calls |
| Review sync_runs/audit_events | Read-only |
| Confirm UI wording and safety banners | All pages |

### Not Allowed Under Any Circumstance

| Action | Why |
|--------|-----|
| GHL apply sync | Not implemented |
| GHL contact/opportunity/workflow/calendar mutation | Not implemented, not safe |
| WhatsApp/SMS/email sending | Outbound disabled, flag off |
| Outbound queue jobs | Not implemented in Onboard |
| Bot activation | `setActive: false`, intentionally deferred |
| Booking/handover/follow-up execution | All stored disabled |
| Changing `AISBP_OUTBOUND_THROUGH_KB_ENABLED` | Must remain `false` |
| Production migration | Unless separately approved |
| Live WhatsApp/GHL tests | Not through this system |
| Real client go-live | Not yet |

---

## 3. Preflight Checklist

Before beginning the pilot, verify:

### Environment

- [ ] Correct environment selected (staging or safe isolated environment)
- [ ] `ONBOARD_KB_SYNC_ENABLED` state known (default: `false`)
- [ ] `AISBP_OUTBOUND_THROUGH_KB_ENABLED = false` (confirmed)
- [ ] No real secrets exposed in test environment
- [ ] Test data clearly labeled as pilot/test (not real client data)

### Safety Boundaries

- [ ] Bot activation remains off (`setActive: false` in all bot profile applies)
- [ ] GHL apply is not implemented (confirmed)
- [ ] Agent token is separate from operator JWT
- [ ] Operator role confirmed (OWNER/ADMIN/OPERATOR)
- [ ] Rollback/pause plan understood (see Section 7)

### System Health

- [ ] Backend is running and typecheck passes
- [ ] Frontend builds without errors
- [ ] All 147 test suites pass (1134 tests)
- [ ] No uncommitted changes that affect behavior
- [ ] Commit hash recorded: `________________`

### Operator Identity

- Operator email: `________________`
- Operator agency: `________________`
- Operator role: `________________`

---

## 4. Manual Test Workflow

### Phase A: Create Pilot Client/Project

| Step | Action | Expected Result | Pass/Fail |
|------|--------|-----------------|-----------|
| A.1 | Open Onboard dashboard | Dashboard loads, shows 0 projects | |
| A.2 | Create test client (e.g. "Pilot Test · pilot-test") | Client created, status = DRAFT | |
| A.3 | Verify phone shows masked only | `+65****1234` format | |
| A.4 | Create project for test client | Project created, status = DRAFT | |
| A.5 | Verify client appears in client list | Name, key, masked phone visible | |
| A.6 | Verify dashboard shows 1 client, 1 project | Counts updated | |

### Phase B: Agent Intake (Simulated)

| Step | Action | Expected Result | Pass/Fail |
|------|--------|-----------------|-----------|
| B.1 | Create agent session via API | Session created, status = ACTIVE | |
| B.2 | Submit answers via API | Answers stored, audit recorded | |
| B.3 | Submit same answer again | Updated, not duplicated | |
| B.4 | Submit analysis/recommendations | Stored, status = SUGGESTED | |
| B.5 | Request Wyn review | Project status = SUBMITTED | |
| B.6 | Verify agent cannot approve section (call approval endpoint with agent token → 401/403) | Blocked | |
| B.7 | Verify agent cannot run KB dry-run (call dry-run endpoint with agent token → 401/403) | Blocked | |
| B.8 | Verify agent cannot run KB apply (call apply endpoint with agent token → 401/403) | Blocked | |
| B.9 | Confirm review queue shows 1 pending | Dashboard badge + review queue | |

### Phase C: Wyn/Operator Review

| Step | Action | Expected Result | Pass/Fail |
|------|--------|-----------------|-----------|
| C.1 | View project detail | Sections with status displayed | |
| C.2 | Review missing fields display | Incomplete sections highlighted | |
| C.3 | Approve business_profile section | Status = APPROVED, audit recorded | |
| C.4 | Approve prompt section | Status = APPROVED | |
| C.5 | Request changes on a section | Comment required; status = REJECTED | |
| C.6 | Re-submit section after changes | Status = COMPLETE → Approve again | |
| C.7 | Final approve project | Status = APPROVED, approvedBy recorded | |
| C.8 | Verify approval timeline shows events | All approve/reject/request events visible | |
| C.9 | Verify non-operator cannot approve (if testable) | 401/403 | |

### Phase D: KB Dry-Run

| Step | Action | Expected Result | Pass/Fail |
|------|--------|-----------------|-----------|
| D.1 | Run KB dry-run for approved project | DRY_RUN_PASSED status | |
| D.2 | Verify payload preview includes all sections | Tenant, biz profile, FAQ, prompt, handover, follow-up | |
| D.3 | Verify `sourceSnapshotHash` present in response | 8-char hex hash | |
| D.4 | Verify sync_run created with mode=DRY_RUN | `sync_runs` table has new row | |
| D.5 | Verify audit_event created | `audit_events` has `sync.kb.dry_run` action | |
| D.6 | Verify no KB mutation occurred | KB tenant table unchanged | |
| D.7 | Run dry-run again with same data | Idempotent, cached result returned | |
| D.8 | Change FAQ answer, run dry-run again | Fresh dry-run, hash changed | |

### Phase E: KB Apply Scope Checks

**Precondition**: `ONBOARD_KB_SYNC_ENABLED` must be explicitly set to `true` for apply tests.

#### E.1 Tenant Identity Only

| Step | Action | Expected Result | Pass/Fail |
|------|--------|-----------------|-----------|
| E.1.1 | With `ONBOARD_KB_SYNC_ENABLED=false`, attempt apply | Blocked with "not enabled" message | |
| E.1.2 | Enable flag, apply `TENANT_IDENTITY_ONLY` scope | Tenant created in KB, kbTenantId in identity map | |
| E.1.3 | Verify only tenant created (no bot profile, no FAQ) | Other phases skipped | |
| E.1.4 | Verify project status NOT changed to live/syncing | Stays APPROVED | |
| E.1.5 | Apply again with same idempotencyKey | Idempotent, no duplicate tenant | |

#### E.2 Bot Profile + Prompt Config

| Step | Action | Expected Result | Pass/Fail |
|------|--------|-----------------|-----------|
| E.2.1 | Apply `BOT_PROFILE_PROMPT_ONLY` scope | Bot profile created in KB | |
| E.2.2 | Verify `setActive: false` | Bot profile is inactive | |
| E.2.3 | Verify only bot profile created (no FAQ, no settings) | Other phases skipped | |
| E.2.4 | Apply again | Reuses existing "Onboard Config" profile | |

#### E.3 FAQ / Knowledge

| Step | Action | Expected Result | Pass/Fail |
|------|--------|-----------------|-----------|
| E.3.1 | Apply `FAQ_KNOWLEDGE_ONLY` scope | FAQ docs created in KB | |
| E.3.2 | Verify knowledge_chunks created | Chunk content matches Onboard answer | |
| E.3.3 | Verify bot profile still inactive | No activation occurred | |
| E.3.4 | Apply again with same FAQ | Reuses/updates, no duplicates | |

#### E.4 Booking + Handover

| Step | Action | Expected Result | Pass/Fail |
|------|--------|-----------------|-----------|
| E.4.1 | Apply `BOOKING_HANDOVER_ONLY` scope | Settings upserted in KB | |
| E.4.2 | Verify `bookingSettingsSynced: true` but `bookingEnabled: false` | Disabled stored config | |
| E.4.3 | Verify `handoverSettingsSynced: true` but `handoverEnabled: false` | Disabled stored config | |

#### E.5 Follow-Up

| Step | Action | Expected Result | Pass/Fail |
|------|--------|-----------------|-----------|
| E.5.1 | Apply `FOLLOW_UP_SETTINGS_ONLY` scope | Settings upserted in KB | |
| E.5.2 | Verify `followUpEnabled: false` | Disabled | |
| E.5.3 | Verify `followUpExecutionEnabled: false` | No execution | |
| E.5.4 | Verify `noQueueJobsCreated: true` | No jobs | |
| E.5.5 | Verify follow-up plan preserved (if Onboard data exists) | `followUpPlanStored: true/false` | |

### Phase F: GHL Validation / Dry-Run

| Step | Action | Expected Result | Pass/Fail |
|------|--------|-----------------|-----------|
| F.1 | Run GHL validate | Valid/failed response with checks | |
| F.2 | Verify `noGhlApiCalls: true` | No GHL APIs called | |
| F.3 | Verify `noGhlMutation: true` | Confirmed in response | |
| F.4 | Run GHL dry-run | Operations proposed, all `disabledForNow: true` | |
| F.5 | Verify sync_run created for GHL validate | `sync_runs` has targetSystem=GHL | |
| F.6 | Verify sync_run created for GHL dry-run | `sync_runs` has targetSystem=GHL | |
| F.7 | Verify audit_events created | `sync.ghl.validate` and `sync.ghl.dry_run` actions | |
| F.8 | Verify GHL history appears in sync page UI | Grouped under "GHL Validation / Dry Run" | |
| F.9 | Verify no GHL mutation APIs called | No workflows, no appointments, no contacts | |

### Phase G: UI Review

| Step | Page | Check | Pass/Fail |
|------|------|-------|-----------|
| G.1 | Dashboard | In-app alert badge, no external notification wording | |
| G.2 | Review Queue | "In-app alert only" banner, pending counts | |
| G.3 | Client Detail | Masked phone, approval buttons, section status | |
| G.4 | Sync Page | Scope-specific banners, disabled labels, KB/GHL history groups | |
| G.5 | Sync Page | No "Apply GHL Sync" active button | |
| G.6 | Settings | Feature flags all false, integration pending | |
| G.7 | All pages | No "bot live" wording anywhere | |
| G.8 | All pages | No "GHL synced" wording anywhere | |
| G.9 | All pages | No "messages will send" wording anywhere | |

### Phase H: Audit Review

| Step | Action | Check | Pass/Fail |
|------|--------|-------|-----------|
| H.1 | Query `approval_events` | All approve/reject/request actions recorded with actorId | |
| H.2 | Query `audit_events` | All writes have actorType, actorId, action, resource | |
| H.3 | Query `sync_runs` | All dry-runs/applys have status, scope, hash | |
| H.4 | Verify idempotencyKey uniqueness | No duplicate sync_runs for same key | |
| H.5 | Verify no full phone numbers in any table | Search for unmasked phone digits | |
| H.6 | Verify no secrets in response_payload JSON | No API keys, tokens, passwords | |

---

## 5. Pass/Fail Criteria

### Must Pass (Block Go-Live If Any Fail)

| Check | Expected |
|-------|----------|
| Agent can submit drafts | Pass |
| Agent cannot approve | Pass |
| Agent cannot sync | Pass |
| Wyn can approve sections | Pass |
| Wyn can approve project | Pass |
| KB dry-run works | Pass |
| Stale dry-run blocks apply | Pass |
| Bot profile remains inactive after apply | Pass |
| Follow-up remains disabled after apply | Pass |
| No GHL mutations | Pass |
| No messages sent | Pass |
| No outbound flag changed | Pass |
| No full phone shown/written | Pass |
| Feature flag blocks apply when off | Pass |

### Should Pass (Report If Fail)

| Check | Expected |
|-------|----------|
| Idempotency prevents duplicates | Pass |
| Snapshot hash changes when data changes | Pass |
| GHL validation returns blockers for missing data | Pass |
| Dashboard alert badge updates | Pass |
| All sync_runs have audit_events | Pass |

### Immediate Stop Conditions

- [ ] Any GHL mutation detected
- [ ] Any message sent
- [ ] Bot activated
- [ ] Outbound flag changed
- [ ] Full phone displayed or written to KB
- [ ] Agent can approve or sync
- [ ] Apply works without fresh dry-run
- [ ] UI implies bot is live

---

## 6. Rollback / Pause Checklist

If something goes wrong:

- [ ] Stop the pilot immediately
- [ ] Disable `ONBOARD_KB_SYNC_ENABLED` if enabled
- [ ] Verify `AISBP_OUTBOUND_THROUGH_KB_ENABLED = false`
- [ ] Do NOT activate bot profile (it's already inactive)
- [ ] Do NOT continue to any GHL apply attempt (not implemented)
- [ ] Review `sync_runs` and `audit_events` for the affected project
- [ ] Manually inspect created KB tenant/config
- [ ] Document the issue with commit hash, timestamps, error messages
- [ ] Return project to `DRAFT` or `CHANGES_REQUESTED` if needed
- [ ] Fix underlying issue before retry

---

## 7. Evidence to Capture

| Item | Value |
|------|-------|
| Current commit hash | `________________` |
| Environment | `________________` |
| Operator account email | `________________` |
| Test clientKey | `________________` |
| Test onboardingProjectId | `________________` |
| Test syncRunId (dry-run) | `________________` |
| Test syncRunId (apply) | `________________` |
| KB tenant ID (after apply) | `________________` |
| Screenshot: Dashboard | `________________` |
| Screenshot: Review Queue | `________________` |
| Screenshot: Sync Page | `________________` |
| Screenshot: GHL History | `________________` |
| Issues found | `________________` |
| Test result: PASS / FAIL | `________________` |

---

## 8. Go / No-Go Decision

| Field | Value |
|-------|-------|
| All must-pass checks passed? | [ ] Yes / [ ] No |
| Any immediate stop conditions triggered? | [ ] Yes / [ ] No |
| Decision | [ ] Go — ready for next controlled test |
| | [ ] Pause — fixes needed before continuing |
| | [ ] No — not ready for any live usage |
| Notes | `________________` |
| Approved by (Wyn) | `________________` |
| Date | `________________` |

---

## 9. Remaining Disabled Features

These features are intentionally NOT part of this pilot:

- GHL apply sync (not implemented)
- External Wyn notification via WhatsApp/email (not implemented)
- Bot activation/go-live (deferred to future PR)
- Live WhatsApp tests through Onboard (not run)
- Live GHL tests through Onboard (not run)
- Outbound follow-up execution (stored disabled)
- Production client rollout (not yet)

---

## 10. Recommended Next PR

**PR 15 — Controlled Pilot Dry Run Execution Report**

Execute this runbook in a safe environment and document the actual results. Capture:
- All test results with pass/fail
- Screenshots
- Issues found
- Go/no-go decision

Or, if issues are found during pilot execution:
**PR 15 — Controlled Pilot Fixes**
