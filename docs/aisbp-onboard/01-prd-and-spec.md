# AISBP-Onboard — PRD & Spec Sheet

## 1. Product Identity

| Field | Value |
|-------|-------|
| Product name | AISBP-Onboard (Onboard) |
| Parent system | AI Sales Bot Pro (KB / AISBP) |
| Product type | Onboarding control app (staging + approval + sync layer) |
| Primary operator | Wyn (AI SME Operator) |

---

## 2. Problem Statement

### Current state

Onboarding a new client into KB requires Wyn to manually:
1. Collect client info through ad-hoc WhatsApp conversations
2. Fill a paper-template (`kb-pilot-client-setup-template.md`)
3. Manually configure the tenant in KB's dashboard
4. Manually verify GHL connection
5. Manually configure bot prompts, booking, handover, follow-up
6. Manually verify everything in the Ops dashboard

There is no structured data store, no automation, and no audit trail between client intake and KB configuration. Every onboarding depends on Wyn's personal attention and memory.

### Future state

1. A WhatsApp AI agent interviews the client one step at a time
2. Answers are saved into AISBP-Onboard (structured, validated, auditable)
3. Onboard analyzes the client's workflow and suggests automations
4. Wyn reviews, edits, rejects, or approves inside Onboard
5. Only after Wyn approval does Onboard sync the approved configuration into KB and GHL
6. Every action is audited with full idempotency and rollback capability

---

## 3. Product Vision

AISBP-Onboard is the **staging, approval, audit, and sync-control layer** between the AI onboarding agent and the production KB/GHL systems.

```
┌───────────┐     ┌───────────────┐     ┌───────────┐     ┌───────────────┐
│ WhatsApp  │────▶│ AISBP-Onboard │────▶│ Wyn Review│────▶│ KB / GHL      │
│ AI Agent  │     │ (Draft)       │     │ (Approve) │     │ (Sync Apply)  │
└───────────┘     └───────────────┘     └───────────┘     └───────────────┘
                         │                    │
                         ▼                    ▼
                   Audit Trail          Rollback/Pause
```

**Onboard is the source of truth for**: onboarding drafts, approvals, sync plans, and audit trail.

---

## 4. Target Users

| Role | Description |
|------|-------------|
| **Wyn / AI SME Operator** | Reviews onboarding drafts, edits, approves/rejects, triggers sync |
| **Client / Business Owner** | Provides business info via WhatsApp interview (indirect user) |
| **WhatsApp AI Onboarding Agent** | Conducts structured interview, submits answers to Onboard API |
| **Hermes / OpenClaw Coding/Ops Agents** | May assist with integration code, must never approve their own work |
| **Sync Worker / System Actor** | Executes approved sync jobs to KB/GHL, records results |

---

## 5. User Roles (System)

| Role | Abilities |
|------|-----------|
| `operator` (Wyn) | Create projects, review, edit, approve, reject, trigger sync, view audit |
| `agent` (AI Agent) | Create sessions, submit answers, submit analysis, request review |
| `admin` (Wyn) | Full access including settings, integration config |
| `service` (System) | Execute sync jobs, write audit events |
| `viewer` (Future) | Read-only access for client/stakeholder review |

---

## 6. Primary Use Cases

1. **Manual client setup by Wyn** — Wyn opens Onboard, creates a client/project, fills the setup template manually
2. **WhatsApp AI agent interviews client** — Agent asks structured questions, saves answers via API
3. **Agent submits workflow analysis** — AI analyzes client's business and suggests automations
4. **Wyn checks review queue** — Onboard dashboard shows projects awaiting review; Wyn checks manually (MVP). External WhatsApp/email notification is future (PR 11).
5. **Wyn reviews and approves** — Wyn reviews each section, edits if needed, approves or rejects
6. **KB configuration sync** — Approved config is synced to KB (dry-run first, then apply)
7. **GHL validation and sync** — GHL setup is validated and synced (dry-run first)
8. **Controlled pilot go-live** — After all checks pass, client goes into controlled pilot

---

## 7. Core Onboarding Workflow

```
Phase 1: Intake
  Client interview → Agent submits answers → Draft stored in Onboard

Phase 2: Analysis
  AI analyzes sales workflow → Suggests automations → Stored as recommendations

Phase 3: Review
  Wyn checks dashboard → Wyn reviews sections → Approve / Reject / Request changes

Phase 4: Sync
  KB dry-run → KB approved sync → GHL dry-run → GHL approved sync

Phase 5: Go-Live
  Controlled test → Monitoring → Expand
```

---

## 8. Business Value

- **Reduces Wyn's manual onboarding time** from hours to minutes of review
- **Eliminates configuration errors** through structured data and validation
- **Prevents AI hallucination in production KB config** via approval gate
- **Provides full audit trail** for compliance and debugging
- **Scales onboarding** from 1-2 manual clients to any number of AI-assisted onboardings
- **Maintains production safety** — KB/GHL never receive unapproved AI-generated data

---

## 9. MVP Scope

### Included in MVP

- Client/project CRUD (manual creation by Wyn)
- Agent API: create session, submit answers, submit analysis
- Structured onboarding data store (all 15 tables)
- Review workflow: section-level approve/reject/request-changes
- Project-level final approval gate
- KB sync dry-run (preview only)
- KB sync apply (after approval)
- Full audit trail for all writes
- Idempotency on all sync operations
- Identifier standard compliance
- Phone masking by default
- Operator dashboard UI

### Not in MVP

- [ ] WhatsApp AI agent itself (separate system — it calls Onboard API)
- [ ] GHL apply sync (dry-run only in MVP)
- [ ] GHL workflow/pipeline creation
- [ ] External notifications (Wyn reviews manually in-app)
- [ ] Multi-user client portal
- [ ] Full analytics dashboard
- [ ] Automated E2E testing of sync pipeline

---

## 10. Success Metrics

| Metric | Target |
|--------|--------|
| Time to onboard a client (manual effort) | < 15 minutes of Wyn review |
| Configuration errors in production | Zero (approval gate prevents) |
| Audit coverage | 100% of write operations |
| Idempotency failures | Zero (duplicate sync not possible) |
| Unapproved config reaching KB/GHL | Zero (approval gate enforced) |

---

## 11. Key Assumptions

1. The WhatsApp AI agent exists separately and calls Onboard's Agent API
2. The API contracts are proposed target contracts for future PRs. Actual KB/GHL sync implementation is deferred and must be validated during PR 8 onward.
3. Wyn is the sole approver for the MVP
4. Each client maps to one onboarding project at a time
5. KB tenant data model can accept configuration from Onboard
6. GHL locations exist before onboarding (clients have GHL accounts)
7. `AISBP_OUTBOUND_THROUGH_KB_ENABLED` remains `false`

---

## 12. Rollout Phases

### Phase 1 (MVP)
- Manual client setup via Onboard UI
- Agent intake API
- Review/approval workflow
- KB dry-run + approved sync

### Phase 2 (Controlled Pilot)
- GHL dry-run
- Wyn in-app notification
- One real pilot client end-to-end

### Phase 3 (Scale)
- GHL apply sync
- WhatsApp notification to Wyn
- Multi-client pipeline
- Analytics

---

## 13. Why AISBP-Onboard Must Be the Control Layer

```
┌──────────────────────────────────────────────────────────────────┐
│                      WITHOUT ONBOARD (DANGER)                    │
│                                                                  │
│  AI Agent ──────▶ KB/GHL Directly                                │
│                                                                  │
│  Risks:                                                          │
│  - AI hallucinates client config → production errors             │
│  - No human review → wrong identity, wrong pricing               │
│  - No audit trail → impossible to debug                          │
│  - No rollback → bad config can't be undone easily              │
│  - No idempotency → duplicate tenants/configs                    │
└──────────────────────────────────────────────────────────────────┘

┌──────────────────────────────────────────────────────────────────┐
│                       WITH ONBOARD (SAFE)                        │
│                                                                  │
│  AI Agent → Draft → Wyn Review → Approved → Sync → KB/GHL       │
│                                                                  │
│  Safeguards:                                                     │
│  ✓ AI only writes drafts (never production)                      │
│  ✓ Wyn reviews/approves before any sync                          │
│  ✓ Dry-run previews before apply                                 │
│  ✓ Full audit trail                                              │
│  ✓ Idempotency prevents duplicates                               │
│  ✓ Rollback/pause possible                                       │
│  ✓ Feature flags gate sync operations                            │
└──────────────────────────────────────────────────────────────────┘
```

---

## 14. Approval-First Operating Model

| Action | Who can do it | Gate |
|--------|--------------|------|
| Create draft/answers | AI Agent | None |
| Submit for review | AI Agent | None |
| Request changes | Wyn | View draft |
| Edit draft | Wyn | View draft |
| Approve section | Wyn | Section complete |
| Approve project | Wyn | All sections approved |
| Trigger sync | Wyn | Project approved |
| Dry-run sync | Wyn | Project approved |
| Apply sync | Wyn | Dry-run passed |
| Rollback sync | Wyn | Sync completed |

**AI agents can draft only. AI agents cannot approve. AI agents cannot sync.**

---

## 15. Pilot Client Use Case

**Pilot client**: Dapper Dogs (dog grooming, Singapore)

1. **WhatsApp interview**: AI agent asks Dapper Dogs owner about services, pricing, hours, FAQs
2. **Answers stored**: Onboard stores structured profile, FAQ items, sales process map
3. **AI analysis**: Agent suggests booking automation, follow-up rules, handover rules
4. **Wyn checks dashboard**: Project appears in review queue. "Dapper Dogs onboarding ready for review"
5. **Wyn reviews**: Checks FAQ accuracy, verifies pricing, adjusts tone
6. **Wyn approves**: Section by section, then final project approval
7. **KB dry-run**: Preview what will be created in KB (tenant, prompts, knowledge vault)
8. **KB sync**: Create tenant, configure bot, load knowledge base
9. **GHL dry-run**: Validate GHL connection, preview sync plan
10. **Controlled test**: Send test message, verify bot response, check Ops dashboard
11. **Go-live**: Dapper Dogs KB tenant is live under controlled pilot monitoring

---

## 16. Long-Term Vision

AISBP-Onboard evolves into the **unified client lifecycle manager** for AISBP:

- Onboarding (current scope)
- Ongoing bot optimization (knowledge base updates, prompt tuning)
- Usage analytics per client
- Client self-service portal
- Automated health checks and recommendations
- Multi-operator approval workflows
- Client upgrade/downgrade management
