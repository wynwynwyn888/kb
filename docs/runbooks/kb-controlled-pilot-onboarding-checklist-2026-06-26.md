# KB Controlled Pilot Onboarding Checklist — 2026-06-26

## 1. Purpose

This checklist is for onboarding the **first 1–2 controlled paid-client tenants** into KB / AI Sales Bot Pro safely. Follow each section in order. Do not skip steps.

KB is currently running in a **controlled pilot** configuration. It is **not** open for mass self-serve onboarding. Every new tenant must be set up manually with verification at each step.

If anything looks wrong or unexpected at any step, **stop and report**. Do not proceed until the issue is understood and resolved.

---

## 2. Current Production Baseline

| Item | Value |
|------|-------|
| Production label | KB Production v1.1 — Operator-Readable Ops Dashboard |
| Latest app checkpoint | `cd41b47` |
| VPS | `root@72.62.243.54` |
| Dashboard | `https://kb.aisalesbot.pro/app/agency/ops` |
| Stable rollback tag | `stable-single-brain-tested-2026-06-26` |
| Test contact | `+6588658634` (GHL: `kfmh8xHdo4KFVLO43BWI`) |
| Test conversation | `b6bac998` |

**Key runtime flags (do not change without approval):**

| Flag | Value |
|------|-------|
| `AISBP_OUTBOUND_IDEMPOTENCY_ENABLED` | `true` |
| `AISBP_STALE_SEND_CHECK_ENABLED` | `true` |
| `AISBP_CONV_ORDERING_ENABLED` | `true` |
| `AISBP_TENANT_CAPS_ENABLED` | `true` |
| `GHL_PRE_REPLY_CONTEXT_SYNC` | `true` |
| `AISBP_OUTBOUND_THROUGH_KB_ENABLED` | `false` |

These flags are **production safety guards**. Do not disable them for a new tenant.

`AISBP_OUTBOUND_THROUGH_KB_ENABLED` must stay `false`. The system does not receive outbound webhooks from GHL for manual dashboard sends. GHL pre-reply context sync handles manual message visibility instead.

---

## 3. Pilot Eligibility Criteria

A client is suitable for the first controlled pilot if:

- [ ] Business has a simple lead flow (inquiries → AI replies → booking or FAQ)
- [ ] Expected message volume is low to moderate (under 50/day initially)
- [ ] Business offer is clear and well-defined (services, products, pricing)
- [ ] FAQ or knowledge base content exists (at least 5–10 common questions)
- [ ] Owner or a responsible staff member is available for handover/escalation
- [ ] SMS-enabled GHL contact exists for testing
- [ ] Client is **not** a complex multi-branch enterprise
- [ ] Client is **not** in a mission-critical emergency business (medical, security, etc.)
- [ ] Client understands this is a controlled pilot with human monitoring

**Do not onboard:**

- Businesses with sensitive regulated topics (finance, legal, medical advice) unless explicitly approved with compliance review
- Businesses expecting 24/7 fully autonomous operation with zero human oversight
- Businesses running live paid ads driving high volume to the bot before pilot verification

---

## 4. Pre-Onboarding Information From Client

Collect this information before setting up the tenant:

**Business identity:**
- [ ] Business name
- [ ] GHL location ID (ask client to provide from GHL dashboard)
- [ ] GHL account — confirmed connected/accessible
- [ ] Preferred channel: WhatsApp / SMS / both
- [ ] Business website URL

**Operations:**
- [ ] Opening hours (days and times)
- [ ] Timezone

**Services & pricing:**
- [ ] Services or products offered (list)
- [ ] Pricing rules (if the bot should mention prices)
- [ ] Booking link (Google Calendar, GHL calendar, Calendly, etc.)
- [ ] Deposit/payment policy (if applicable)

**Content:**
- [ ] FAQs (at least 5–10 question/answer pairs)
- [ ] Tone of voice description (friendly, professional, casual, etc.)
- [ ] Common greetings and sign-offs preferred

**Safety rules:**
- [ ] Topics the bot should **never** answer (compliance, legal, pricing guarantees, etc.)
- [ ] Opt-out / stop words the bot should recognise
- [ ] Human contact for urgent escalation (name, phone, email)
- [ ] Escalation trigger rules (when should the bot hand over to a human)

**Compliance:**
- [ ] Any industry-specific compliance rules (PDPA, GDPR, etc.)
- [ ] Data retention expectations
- [ ] Approval to store conversation history

---

## 5. Tenant Setup Checklist

### 5.1 Create/verify tenant in KB

- [ ] Log into KB at `https://kb.aisalesbot.pro` with your agency account
- [ ] Go to Agency → Client Workspaces
- [ ] Create a new workspace with the client's business name
- [ ] Note the tenant ID (visible in Ops dashboard → Tenants tab)
- [ ] Verify the tenant appears in the Operations dashboard under the Tenants tab

### 5.2 Connect GHL

- [ ] Go to the tenant's workspace → Control Panel or Settings
- [ ] Enter the client's GHL Location ID and Private Integration token
- [ ] Click "Verify connection" — confirm it shows **CONNECTED**
- [ ] Go to Ops dashboard → Tenants tab — verify the new tenant shows GHL status as CONNECTED
- [ ] Confirm the tenant's GHL Location ID matches what the client provided

### 5.3 Configure bot

- [ ] Go to the tenant's workspace → Assistant → Profiles
- [ ] Create or activate a bot profile
- [ ] Set the persona, conversation goals, business notes, tone rules
- [ ] Upload or create knowledge base documents (FAQs) in Knowledge Vaults
- [ ] Go to Assistant → Instructions — set the system prompt
- [ ] Verify the prompt represents **only** the client's business
- [ ] Verify the prompt does **not** mention other businesses
- [ ] Go to Assistant → Preview to test a few sample messages

### 5.4 Booking

- [ ] Go to Automation → Booking
- [ ] Enable booking if the client wants automated appointment booking
- [ ] Set the correct GHL calendar
- [ ] Configure required fields (name, phone, email, service, etc.)
- [ ] Set service menu options if applicable
- [ ] Test the booking link manually in a browser

### 5.5 Handover / escalation

- [ ] Go to Automation → Human Escalation
- [ ] Enable escalation if the client wants handover capability
- [ ] Set the internal alert phone number
- [ ] Configure escalation triggers

### 5.6 Follow-up

- [ ] Go to Automation → Follow-up
- [ ] Enable follow-up if the client wants automated follow-up messages
- [ ] Configure follow-up steps and delays
- [ ] Verify follow-up respects business hours

### 5.7 Verify Ops dashboard visibility

- [ ] Open `https://kb.aisalesbot.pro/app/agency/ops`
- [ ] Go to the Tenants tab — confirm the new tenant shows:
  - Readable name (e.g., "Client Business Name · abcd1234")
  - GHL status: CONNECTED
  - Sync status: On
  - Bot enabled
- [ ] If the tenant does not appear, refresh the page and check again

---

## 6. Prompt Safety Checklist

Before the bot goes live, verify these rules in the prompt/config:

- [ ] Bot represents **only** the assigned client business
- [ ] Bot does **not** adopt or answer as another business identity
- [ ] Bot does **not** fill forms or collect data for other businesses
- [ ] Bot asks for a human/owner if it detects an AI or auto-reply loop
- [ ] Bot avoids "are you human?" back-and-forth loops
- [ ] Bot attempts booking only after clear customer interest
- [ ] Bot does **not** make fake guarantees or promises
- [ ] Bot does **not** make sensitive claims (health, legal, financial) unless explicitly approved
- [ ] Bot has clear handover triggers for complaints, urgent requests, out-of-scope topics
- [ ] Bot respects opt-out / stop words

---

## 7. GHL / Channel Checklist

- [ ] GHL location is **CONNECTED** in `tenant_ghl_connections`
- [ ] A test contact exists in GHL for this location (SMS-capable)
- [ ] A test conversation exists (or will be created by the first test message)
- [ ] Booking/calendar link has been tested manually in a browser
- [ ] GHL tags/workflows do **not** conflict with KB replies (no duplicate auto-replies)
- [ ] Client understands: manual messages sent from GHL dashboard will **not** trigger KB webhooks
- [ ] Client understands: GHL pre-reply context sync imports manual messages into KB context (so the AI can see them), but this is not instant
- [ ] `AISBP_OUTBOUND_THROUGH_KB_ENABLED` remains `false` — do not enable it

---

## 8. Controlled Test Plan

Use **one approved internal/test contact only** for the initial test. Do not test with real customers yet.

### 8.1 Preparation

- [ ] Confirm the test contact has an SMS-capable phone number in GHL
- [ ] Confirm the test contact is linked to the correct GHL location
- [ ] Open the Operations dashboard in a separate tab: `https://kb.aisalesbot.pro/app/agency/ops`
- [ ] Open VPS logs if accessible: `ssh root@72.62.243.54`, then `docker logs -f aisbp-backend-1`

### 8.2 Send test message

- [ ] Send **one** inbound test message from the test contact (e.g., "Hi, I'm interested in your services")
- [ ] Watch Ops dashboard → Outbound tab for the new send
- [ ] Watch logs for the expected sequence (see `docs/AISBP_PRODUCTION_SMOKE_TEST.md`)

### 8.3 Verify

- [ ] Inbound message was received and persisted
- [ ] AI reply was generated
- [ ] AI reply was sent via GHL (provider message ID captured)
- [ ] OutboundSend ledger shows status `sent`
- [ ] **No duplicate send** — only one outbound message for this reply
- [ ] Ops dashboard → Outbound tab shows the new row with readable tenant/conversation labels
- [ ] Ops dashboard → Conversations tab shows the conversation
- [ ] Ops dashboard → Errors tab is clean (no new errors)
- [ ] If the client sent a manual GHL message before the test, GHL pre-reply sync should have imported it
- [ ] Backend logs are clean — no repeated errors or warnings

### 8.4 Stop immediately if:

- [ ] Duplicate send occurs (two identical messages sent)
- [ ] Bot uses wrong business identity
- [ ] Message goes to wrong contact
- [ ] GHL connection error appears (400, 401, 403, 429)
- [ ] Backend crash or repeated error loop

---

## 9. Go-Live Decision Gate

Check all of these before marking the tenant as live:

- [ ] Tenant config is correct (name, GHL location, connection status)
- [ ] Prompt has been reviewed and approved
- [ ] Booking link is correct and tested
- [ ] Handover contact is configured and available
- [ ] Test contact test **passed** (Section 8)
- [ ] Ops dashboard is readable and shows expected data
- [ ] No duplicate sends occurred
- [ ] No wrong-identity replies occurred
- [ ] No new backend errors
- [ ] Rollback path is confirmed (see Section 11)

If all checkboxes are ticked, the tenant is ready for controlled pilot.

**Do not** proceed if any checkbox is unticked.

---

## 10. First 24 Hours Monitoring

During the first 24 hours after go-live:

- [ ] Check Ops dashboard every 2–4 hours
- [ ] Outbound tab: review all sent messages
- [ ] Errors tab: check for new errors or warnings
- [ ] Audit tab: review recent events
- [ ] Conversations tab: verify conversations are tracked
- [ ] Open GHL dashboard manually and spot-check a few conversations
- [ ] Watch for AI-to-AI loops (bot replying to another bot)
- [ ] Watch for wrong identity (bot answering as a different business)
- [ ] Watch for repeated questions (suggests FAQ/knowledge gap)
- [ ] Check booking intent handling (are booking requests working?)
- [ ] Collect screenshots of good replies (for client report)
- [ ] Collect screenshots of bad replies (for improvement)

**What is normal:**

- Outbound sends appear with status `sent`
- Some errors may appear (rate limits, contact not found) — these are recoverable
- GHL sync events appear periodically
- Queue numbers are low (under 10 active/waiting)

**What is dangerous:**

- Multiple failed sends in a row for the same conversation
- Error rate spikes
- Bot sending messages without any inbound trigger
- Queue backlog building up (tens of waiting jobs)
- Backend container restarting or crashing

---

## 11. Rollback / Pause Plan

If something goes wrong with the new tenant:

### 11.1 Pause the bot for one tenant

- [ ] Go to the tenant's workspace in KB
- [ ] Disable the bot (toggle bot mode off) — this stops AI replies without affecting other tenants
- [ ] If GHL workflows are conflicting, pause them in GHL
- [ ] Inform the client that the bot is paused for review

### 11.2 Emergency rollback

If a code regression is suspected (not just a config issue):

- [ ] Do **not** change global runtime flags unless confirmed necessary
- [ ] The stable rollback tag is `stable-single-brain-tested-2026-06-26`
- [ ] Rollback command (from Ops dashboard → SOP tab):
  ```
  cd /root/aisbp
  git fetch origin
  git checkout stable-single-brain-tested-2026-06-26
  docker compose -f docker-compose.hostinger.yml --env-file .env.production up -d --no-build --force-recreate backend
  ```

### 11.3 After rollback

- [ ] Verify production health (root URL, ops dashboard, backend)
- [ ] Verify the paused tenant is no longer affected
- [ ] Document the issue
- [ ] Contact developer for investigation

---

## 12. Client Communication Template

Send this to the client before pilot starts:

---

Hi [Client Name],

KB is now set up for [Business Name] and ready for a controlled pilot.

**What to expect in the first few days:**
- The AI will respond to inbound messages from your customers
- I will actively monitor all conversations for the first 24–48 hours
- If any reply looks off, I can take over manually or pause the bot immediately
- You can also reply manually in GHL at any time — the AI steps aside when a human replies

**What I need from you:**
- Let me know if you see any unusual replies
- Share feedback on tone, accuracy, or missing information
- Tell me if you want to add or change FAQs

**Goal:**
Safe automation, not uncontrolled autopilot. We'll iterate and improve as we go.

Talk soon,
Wyn

---

## 13. Operator Notes For Wyn

### Daily checks (2–4 times per day during pilot)

1. Open `https://kb.aisalesbot.pro/app/agency/ops`
2. Glance at the **Outbound** tab — are messages sending successfully?
3. Glance at the **Errors** tab — anything new in red?
4. Glance at the **Conversations** tab — are conversations tracking?
5. If you see a spike in errors or failed sends, investigate.

### What is normal

- Outbound sends with status `sent` and a provider message ID
- Occasional failed sends (rate limits happen, the system retries)
- GHL sync events appearing in the Audit tab
- Queue numbers under 10

### What is dangerous — pause and investigate

- The same error repeating many times in a row
- Messages being sent without any customer first messaging
- The backend container restarting unexpectedly
- The ops dashboard showing errors or not loading

### When to ask for help

- If you see an error you don't understand
- If you need to onboard a second client
- If you want to change a runtime flag
- If the VPS seems slow or unresponsive
- If a client reports an issue you can't explain

### Key URLs

| What | URL |
|------|-----|
| KB app | `https://kb.aisalesbot.pro` |
| Ops dashboard | `https://kb.aisalesbot.pro/app/agency/ops` |
| VPS (SSH) | `ssh root@72.62.243.54` (key: `~/.ssh/aisbp_deploy`) |

---

## 14. Production Safety Confirmation

This checklist is documentation only:

- [x] No code changed
- [x] No DB changed
- [x] No migrations
- [x] No env changed
- [x] No runtime flags changed
- [x] No deployment needed
- [x] No live tests run
- [x] No messages sent
