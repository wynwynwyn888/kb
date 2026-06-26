# AISBP-Onboard — Known Bugs / Limitations

> **Status**: App is not built yet. This document captures known limitations and deferred decisions.

---

## 1. Current Limitations (Pre-Build)

| Limitation | Impact | Resolution |
|------------|--------|------------|
| App does not exist yet | Cannot onboard any client via Onboard | Build PR 2-4 |
| DB schema not implemented | Cannot store onboarding data | Build PR 3 |
| Agent API not implemented | WhatsApp agent cannot submit data | Build PR 6 |
| Operator UI not implemented | Wyn cannot review/approve in UI | Build PR 4-5 |
| KB sync endpoint not implemented | Cannot sync config to KB | Build PR 8-9 |
| GHL apply sync not implemented | Cannot apply GHL configuration | Build PR 10 (future) |
| WhatsApp notification not implemented | Wyn must manually check for reviews | Build PR 11 (future) |
| No multi-user client portal | Only Wyn and agent can interact | Post-MVP feature |

---

## 2. Design Limitations

| Limitation | Details |
|------------|---------|
| AI agent may provide incomplete answers | Human review gate catches this; agent can be prompted to re-ask |
| Human approval required | All syncs gate on Wyn approval; no auto-sync even for low-risk configs |
| Single approver (Wyn only) | No multi-operator approval workflow in MVP |
| No automated E2E testing | Smoke tests are manual; CI testing deferred |
| No external notification pipeline | Wyn must check Onboard dashboard for pending reviews |
| No client self-service portal | Clients cannot view or edit their onboarding data directly |

---

## 3. KB Integration Limitations

| Limitation | Details |
|------------|---------|
| KB API contract not finalized | Sync endpoint implementation depends on KB's API readiness |
| No two-way sync | Onboard → KB is one-way; KB changes are not reflected back to Onboard |
| Tenant creation only | Updating existing tenant config via Onboard not in MVP |
| Knowledge vault structure | KB's knowledge vault data model determines what Onboard can sync |

---

## 4. GHL Integration Limitations

| Limitation | Details |
|------------|---------|
| GHL apply sync deferred | Only dry-run validation in MVP |
| No workflow creation | GHL workflow automation not in MVP scope |
| No pipeline management | GHL pipeline/stage configuration not in scope |
| GHL token management | Client provides GHL token during manual setup; no OAuth flow |

---

## 5. Notification Limitations

| Limitation | Details |
|------------|---------|
| External notifications audit-only | No email/SMS/WhatsApp notifications in MVP |
| Wyn must manually check | Dashboard review queue is the only notification mechanism |
| No client notifications | Client is not notified of onboarding progress automatically |

---

## 6. Deferred Decisions

| Decision | Status | Impact |
|----------|--------|--------|
| Onboard as separate app vs. module | Decided: `apps/onboard/` inside KB monorepo, with backend module at `apps/backend/src/modules/onboard/` | Low — documented in TDD |
| Auth provider | Decided: Reuse Supabase Auth | Low — same as KB |
| Notification channel | Deferred to PR 11 | Low — in-app review works |
| GHL write scope | Deferred to Phase 3 | Low — dry-run first |
| Exact KB sync API | To confirm during PR 8 | Low — contract exists |
| Deployment target | Deferred: Same VPS as KB initially | Low |
| Separate DB vs. shared DB | Decided: Shared Supabase DB, new tables | Low |

---

## 7. Known Risks (Operational)

| Risk | Likelihood | Severity | Mitigation |
|------|-----------|----------|------------|
| KB API changes during Onboard build | Low | Medium | Onboard sync contract is documented; adapt if needed |
| GHL API rate limits during sync | Low | Low | Dry-run validates, apply is throttled |
| Agent token leak | Low | High | Tokens can be rotated; agent scope is limited |
| Sync partial failure | Low | Medium | Idempotency prevents duplicates; sync runs track state |
| Operator accidentally approves | Low | Medium | Confirmation dialog before approval; audit trail |

---

## 8. Will NOT Be in MVP

- [ ] Multi-operator approval workflow
- [ ] Client self-service portal
- [ ] Automated E2E CI pipeline
- [ ] External notifications (WhatsApp, email, SMS)
- [ ] GHL workflow/pipeline creation
- [ ] Two-way KB sync
- [ ] Full analytics dashboard
- [ ] Bulk onboarding (multiple clients at once)
- [ ] White-label customization per client

---

## 9. Production Safety Constraints (Permanent)

| Constraint | Reason |
|------------|--------|
| `AISBP_OUTBOUND_THROUGH_KB_ENABLED` must stay `false` | GHL does not send OutboundMessage webhooks for manual dashboard sends |
| No AI-agent writes to KB/GHL directly | Violates approval-first operating model |
| No agent approval authority | Code-level enforcement required |
| No sync without approved project | Code-level enforcement required |
| Phone numbers masked by default | Privacy requirement |
| No secrets in docs or logs | Security requirement |
