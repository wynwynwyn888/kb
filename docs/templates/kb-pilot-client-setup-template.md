# KB Pilot Client Setup Template

> Fill in one copy per pilot client. Keep completed copies in `docs/pilots/<client-name>/`.
> This template collects everything needed to safely configure a tenant before connecting to KB.

---

## 1. Client Overview

| Field | Value |
|-------|-------|
| Client business name | |
| Legal/company name | |
| Main contact person | |
| Main contact email | |
| Main contact phone | |
| Industry | |
| Website | |
| Social pages (IG/FB/TikTok/etc.) | |
| Pilot start date | |
| Pilot owner (client side) | |
| Pilot owner (Wyn / AI SME side) | |

---

## 2. Pilot Suitability Check

- [ ] Simple lead flow (inquiry → FAQ/booking)
- [ ] Clear offer/service — well defined
- [ ] Low to moderate expected message volume (under 50/day)
- [ ] Human owner/operator available for handover
- [ ] Booking link or calendar ready
- [ ] GHL location available and active
- [ ] Not an emergency or critical-response business
- [ ] Client understands this is a controlled pilot with human monitoring

**Pilot suitability decision:**

`[ ] Approved  /  [ ] Not approved  /  [ ] Needs more info`

Reason: ________________________________

---

## 3. GHL / Channel Details

| Field | Value |
|-------|-------|
| GHL location ID | |
| GHL location name | |
| GHL connected account status | |
| SMS / WhatsApp / both? | |
| Calendar / booking link | |
| Pipeline name | |
| Relevant pipeline stages | |
| Tags used in GHL | |
| Workflows that may conflict with KB | |
| Manual message expectations (client side) | |

**Important:** `AISBP_OUTBOUND_THROUGH_KB_ENABLED` remains `false`. GHL pre-reply context sync handles manual message visibility.

Notes: ________________________________

---

## 4. Business Identity

| Field | Value |
|-------|-------|
| Bot represents this business as | |
| Business description (1–2 sentences) | |
| Main services / products | |
| Target customer | |
| Service area / location | |
| Opening hours | |
| Pricing policy | |
| Deposit / payment policy | |
| Refund / cancellation policy | |
| Things the bot must **never** claim | |
| Topics the bot must **never** answer | |

---

## 5. Conversation Goal

Primary goal (check all that apply):

- [ ] Book appointment / call
- [ ] Collect lead details
- [ ] Answer FAQs
- [ ] Qualify lead
- [ ] Route to human
- [ ] Send booking link
- [ ] Other: ______________

| Field | Value |
|-------|-------|
| Primary CTA (call to action) | |
| Booking link | |
| When to push for booking | |
| Max questions before booking attempt | |
| Lead details to collect (name, phone, email, etc.) | |

---

## 6. Prompt Personality

| Field | Value |
|-------|-------|
| Tone of voice | |
| Personality | |
| Should sound like | |
| Should avoid sounding like | |
| Language preference (English / Chinese / Malay / etc.) | |
| Use Singlish / local style? | Yes / No |
| Formality level (casual / semi-formal / formal) | |
| Example good reply | |
| Example bad reply | |

---

## 7. FAQ / Knowledge Base

### Pricing FAQs

| Question | Approved Answer | Notes |
|----------|-----------------|-------|
| | | |
| | | |
| | | |

### Service FAQs

| Question | Approved Answer | Notes |
|----------|-----------------|-------|
| | | |
| | | |
| | | |

### Booking FAQs

| Question | Approved Answer | Notes |
|----------|-----------------|-------|
| | | |
| | | |

### Objection Handling

| Objection | Recommended Response | Notes |
|-----------|----------------------|-------|
| | | |
| | | |

### Location / Hours FAQs

| Question | Approved Answer | Notes |
|----------|-----------------|-------|
| | | |

### Payment FAQs

| Question | Approved Answer | Notes |
|----------|-----------------|-------|
| | | |

### Competitor Comparison (if allowed)

| Competitor | How to respond | Notes |
|------------|----------------|-------|
| | | |

---

## 8. Handover / Escalation Rules

| Field | Value |
|-------|-------|
| Human handover contact name | |
| Human handover contact phone | |
| Handover method (SMS / WhatsApp / call) | |
| Handover availability hours | |
| Emergency escalation contact | |

**Trigger handover when:**

- [ ] Customer is angry or complaining
- [ ] Refund / cancellation issue
- [ ] Legal or compliance topic raised
- [ ] Medical, financial, or sensitive topic
- [ ] Pricing exception requested
- [ ] Customer explicitly asks for a human
- [ ] Bot is uncertain (confidence below threshold)
- [ ] Other: ______________

---

## 9. Follow-Up Rules

| Field | Value |
|-------|-------|
| Follow-up enabled? | Yes / No |
| Follow-up goal | |
| Follow-up tone | |
| Follow-up cadence (hours / days) | |
| Stop follow-up when | |
| Do-not-message rules | |
| Dormant/reactivation allowed? | Yes / No |

Notes: ________________________________

---

## 10. Compliance / Safety Boundaries

- [ ] Bot must **not** give legal, medical, or financial advice unless explicitly approved
- [ ] Bot must **not** make guarantees (prices, results, timelines)
- [ ] Bot must **not** invent prices or services
- [ ] Bot must **not** pretend to be human
- [ ] Bot must **not** adopt another business's identity
- [ ] Bot must **not** answer another business's intake questions
- [ ] Bot must respect opt-out / stop requests
- [ ] Bot must hand over sensitive topics

| Field | Value |
|-------|-------|
| Industry-specific restrictions | |
| Sensitive topics | |
| Required disclaimers | |
| Forbidden claims | |

---

## 11. Test Contact / Test Conversation

| Field | Value |
|-------|-------|
| Approved test contact name | |
| Approved test contact phone | |
| GHL contact ID | |
| GHL conversation ID (if exists) | |
| Test message to send | |
| Expected bot reply | |
| Expected booking/CTA behaviour | |
| Test approved by | |

**Important:** Use one approved test contact only. Do not test with random or real customers during setup.

---

## 12. Ops Dashboard Verification

After tenant is configured and test message is sent, verify:

- [ ] Tenant appears with readable name in Ops dashboard → Tenants tab
- [ ] Contact / conversation label readable in Conversations tab
- [ ] Outbound sends visible in Outbound tab
- [ ] Errors tab checked — no new errors
- [ ] Audit tab shows recent events
- [ ] No duplicate sends
- [ ] No secrets exposed
- [ ] No full phone numbers exposed

---

## 13. Go-Live Approval

- [ ] Client info complete (Sections 1–10 filled)
- [ ] GHL location verified and connected
- [ ] Prompt reviewed and approved
- [ ] Booking link verified and tested
- [ ] Handover contact confirmed and available
- [ ] Test contact test passed (Section 11)
- [ ] Ops dashboard verified (Section 12)
- [ ] Rollback / pause plan understood (see onboarding checklist Section 11)
- [ ] Client approved controlled pilot
- [ ] Wyn approved go-live

| Field | Value |
|-------|-------|
| Approved by | |
| Approval date | |
| Go-live date | |
| Notes | |

---

## 14. First 24 Hours Monitoring Notes

| Time | What was checked | Result | Issue? | Action taken |
|------|-----------------|--------|--------|-------------|
| | | | | |
| | | | | |
| | | | | |
| | | | | |
| | | | | |

---

## 15. Issues / Lessons Learned

| Issue | Severity | Evidence | Fix / Action | Owner | Status |
|-------|----------|----------|-------------|-------|--------|
| | | | | | |
| | | | | | |
| | | | | | |

---

## 16. Final Pilot Decision

| Field | Value |
|-------|-------|
| Continue pilot? | Yes / No |
| Pause required? | Yes / No |
| Ready to expand to more clients? | Yes / No |
| Client feedback summary | |
| Wyn notes | |
| Next action | |

---

## Template Usage Notes

- Create a copy of this template for each new pilot client
- Save filled copies in `docs/pilots/<client-name>/`
- Update the onboarding checklist (`docs/runbooks/kb-controlled-pilot-onboarding-checklist-2026-06-26.md`) alongside this template
- This template is designed for Wyn (non-technical founder) — keep it simple and practical
