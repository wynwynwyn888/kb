# Pipeline-Aware AI Follow-Up — Client Proposal

**Product:** AISBP (KB Middleware)  
**Integration:** GoHighLevel (GHL) + WhatsApp  
**Prepared for:** Pipeline-based demo / nurture follow-up use case  
**Status:** Proposal — scope & options for sign-off

---

## Executive summary

Your team runs **different follow-up messages** depending on where a lead sits in the GHL pipeline (e.g. message sent → opened → demo viewed). Today, when GHL workflows send those messages directly, **KB AI does not see what was sent**, so customer replies can feel disconnected or generic.

We recommend **Option 1B — Pipeline Follow-Up (KB-native)**:

- Sync pipelines & stages from GHL into KB.
- Configure per-stage follow-up copy and reply rules in the KB dashboard.
- **KB sends** the WhatsApp follow-ups (not GHL send actions).
- GHL remains the **CRM engine** (pipeline moves, opportunities, contact record).
- KB remains the **conversation brain** (memory, AI replies, follow-up copy).

This delivers stronger context, less duplicate tooling in GHL, and easier maintenance as you add more stages.

---

## The problem today

| What happens | Result |
|--------------|--------|
| GHL workflow sends WhatsApp follow-up | Customer receives correct message |
| Customer replies | KB processes reply via inbound webhook |
| KB loads conversation memory | **Workflow message often missing** — KB did not send or record it |
| AI generates reply | Weaker context → “What is this about?” / price / yes-no handled poorly |

**Root cause:** KB only remembers messages it persists. GHL-native sends bypass KB unless we add recording webhooks (Option 1A) or KB sends the messages itself (Option 1B).

---

## How KB memory works (baseline)

### Where history is stored

| Layer | Location | Purpose |
|-------|----------|---------|
| **Full message archive** | KB database (`messages` table) | Every inbound/outbound KB knows about |
| **Conversation state** | KB database (`conversations.metadata`) | Options, booking, policy, future pipeline context |
| **AI prompt window** | Loaded per reply | Last **20 customer turns** (+ replies in that window) |

Older messages remain in the database but are not all injected into the AI on every reply — this balances **quality, speed, and token cost**.

### What KB remembers today

- Customer inbound messages (GHL → KB webhook).
- Outbound messages **sent by KB** (AI replies, KB follow-up engine).

### What KB does not remember today

- WhatsApp messages sent **only** by GHL workflows (unless we add integration).

---

## Options

### Option 1A — GHL sends, KB records (webhook per message)

**How it works**

1. Keep GHL workflows that **send** WhatsApp per pipeline stage.
2. After each send, GHL fires a **second webhook** to KB with the exact message text + stage metadata.
3. KB stores outbound in conversation history.
4. On customer reply, AI uses stitched thread + stage info.

**Pros**

- Minimal change to who sends messages (GHL stays sender).
- KB gains context without replacing GHL send steps immediately.

**Cons**

- Two steps per workflow branch (send + webhook) — easy to miss one path.
- Message text must be duplicated in webhook payload (template sync discipline).
- More GHL maintenance as pipelines grow.
- Context is “stitched” from external sends — workable, less native than 1B.

| | |
|--|--|
| **Timeline** | 10–14 days (includes manual testing) |
| **Investment** | SGD 800 |

---

### Option 1B — Pipeline Follow-Up in KB (recommended)

**How it works**

1. **Sync** GHL pipelines & stages into KB (dashboard: “Pipeline Follow-Up”).
2. **Configure** per stage in KB UI:
   - Follow-up message (fixed or AI-crafted from instruction).
   - Purpose / CTA.
   - Reply playbook (yes / no / price / “what is this?”).
3. GHL **moves** opportunities through stages (your existing CRM logic).
4. On **stage change**, GHL notifies KB (thin webhook — **no send action in GHL**).
5. **KB sends** the stage-appropriate WhatsApp follow-up and **auto-saves** it to memory.
6. On customer reply, KB AI uses:
   - Last 20 chat turns.
   - Current pipeline stage.
   - Stage playbook from UI.
   - Messages KB already sent.

**Pros**

- **Best context** — KB owns send + memory in one system.
- One place to edit copy (KB UI), not scattered GHL workflows.
- Scales cleanly as you add stages / pipelines.
- Aligns with product direction: **GHL = CRM, KB = brain**.

**Cons**

- Requires thin GHL integration for **stage-change notification** (not per-message webhooks).
- GHL must **stop** sending duplicate WhatsApp on those same pipeline steps.
- New KB feature build (pipeline sync + stage follow-up engine).

| | |
|--|--|
| **Timeline** | 7–10 days |
| **Investment** | SGD 900 |

---

### Option 2 — DIY webhook setup (guided)

**How it works**

- We document webhook contracts and conversation requirements.
- Your team builds GHL workflows and outbound recording webhooks.
- Optional AI-agent assist to wire flows.

**Pros**

- Lowest build cost on our side.

**Cons**

- Ongoing maintenance on your team.
- Higher risk of missed webhooks / drift between GHL copy and KB context.

| | |
|--|--|
| **Timeline** | ~5 days (documentation + review cycles) |
| **Investment** | SGD 600 |

---

### Option 3 — Defer upgrade

Continue with current manual / generic follow-up until budget allows Option 1B.

**Trade-off:** Customer replies after GHL-only sends will remain context-limited until upgraded.

---

## Recommended architecture (Option 1B)

```
┌─────────────────────────────────────────────────────────────────┐
│                        GoHighLevel (CRM)                        │
│  • Pipelines & stages (source of truth for deal position)       │
│  • Move opportunity: Message sent → Opened → Demo viewed        │
│  • Thin webhook on stage change → KB (no WhatsApp send here)    │
└────────────────────────────┬────────────────────────────────────┘
                             │ stage change event
                             ▼
┌─────────────────────────────────────────────────────────────────┐
│                    KB Middleware (AISBP)                        │
│  • Sync pipeline definitions (UI)                               │
│  • Per-stage follow-up config (UI)                              │
│  • Send WhatsApp via GHL API                                    │
│  • Persist every outbound + inbound                             │
│  • AI reply with stage playbook + last 20 turns                 │
└────────────────────────────┬────────────────────────────────────┘
                             │ WhatsApp
                             ▼
                          Customer
```

### Division of responsibility

| Responsibility | GHL | KB |
|----------------|-----|-----|
| Pipeline / opportunity position | ✅ Primary | Reads sync |
| Moving stages | ✅ | Can tag later; stage write-back optional phase 2 |
| Sending pipeline follow-up WhatsApp | ❌ (turn off for these steps) | ✅ |
| Conversation memory & AI replies | ❌ | ✅ |
| Applying tags from AI rules | Receives tags | ✅ Can apply today |
| Per-stage copy & reply logic | ❌ | ✅ UI config |

---

## FAQ (technical)

### Does 1B give KB “full pipeline context”?

KB gets **current stage + configured playbook + full chat history KB sent/received** — not an unlimited dump of every CRM event ever.

That is **better for AI quality** than feeding 50+ raw messages every time: structured stage context tells the model *where the lead is*; chat memory tells it *what was said*.

### Can we use 50 messages instead of 20?

- **Storage:** Unlimited in KB database.
- **AI window:** Currently **20 turns** (recently upgraded from 10).
- **50 turns:** Possible; increases token cost and reply latency with diminishing returns.

**Recommendation:** Pair **20-turn memory** with **pipeline stage metadata** (1B) rather than pushing 50 messages alone.

### Will GHL fire the 2nd, 3rd follow-up message in 1B?

**No.** In 1B, **KB fires** each stage’s follow-up when the contact enters that stage (or after a KB-configured delay).

If GHL **also** sends, customers get **duplicate messages**. Clear rule:

> **GHL moves stages. KB sends customer-facing follow-ups.**

### What about stage moves — one webhook per pipeline?

Use **one stage-change webhook pattern** per location (or per pipeline), not one webhook per message.

Each time the opportunity moves:

`Stage A → KB sends Stage A message`  
`Stage B → KB sends Stage B message`  
`Customer replies → KB inbound webhook → AI reply with Stage B context`

### Does KB update GHL pipelines / stages?

- **Today:** KB can **apply tags** to contacts via GHL API (automation rules).
- **1B scope:** KB **reads** pipelines (sync) and reacts to stage changes.
- **Phase 2 (optional):** KB writes back — e.g. move stage after booking, tag “replied”, etc.

**GHL stays CRM source of truth** for pipeline structure; KB stays **conversation source of truth**.

---

## Delivery scope (Option 1B)

### Included

1. GHL pipeline & stage sync API + dashboard section (“Pipeline Follow-Up”).
2. Per-stage configuration: message mode (fixed / AI instruction), enabled flag, optional delay.
3. Stage-change webhook endpoint + GHL setup guide (copy-paste templates).
4. KB outbound send per stage (WhatsApp via existing GHL connection).
5. Persist outbound to conversation memory automatically.
6. Inject current stage + playbook into AI on inbound reply.
7. QA on your pipeline (message sent / opened / demo viewed paths).
8. Handover doc: what to disable in GHL send workflows.

### Out of scope (unless added)

- KB-initiated **pipeline stage write-back** to GHL.
- Email / SMS channel expansion beyond current verified WhatsApp path.
- Unlimited AI context window (50+ turns) without separate cost discussion.
- Rebuilding all existing GHL automations unrelated to this pipeline.

---

## Client prerequisites

Before go-live:

1. **List active pipelines & stages** used for demo nurture.
2. **Draft copy** per stage (or bullet intent for AI to expand).
3. **Reply playbook** per stage: yes / no / price / confusion.
4. **Disable** GHL “Send WhatsApp” on steps KB will own (avoid duplicates).
5. Confirm WhatsApp sender number / location ID in GHL matches KB workspace.
6. One technical contact for GHL workflow webhook testing.

---

## Test plan

| # | Scenario | Expected |
|---|----------|----------|
| 1 | Contact enters “Message sent” stage | KB sends configured follow-up; message appears in KB thread |
| 2 | Contact moves to “Demo viewed” | KB sends **different** stage message (not GHL duplicate) |
| 3 | Customer replies “yes” | AI responds per stage playbook + recent context |
| 4 | Customer replies “how much?” | AI uses KB + playbook; no hallucinated pricing |
| 5 | Customer replies “what is this?” | AI references last KB-sent invite, not generic filler |
| 6 | Stage changes without customer reply | Only KB stage message fires once per stage entry |
| 7 | `/new` or dashboard reset (if used) | Policy reset behaviour unchanged; pipeline context rules documented |

---

## Timeline (Option 1B)

| Phase | Duration | Activities |
|-------|----------|------------|
| Discovery & copy | 1–2 days | Pipeline map, stage copy, playbook |
| Build | 4–5 days | Sync, UI, webhook, send engine, AI injection |
| GHL wiring & QA | 2–3 days | Stage webhooks, disable duplicate sends, end-to-end tests |
| Go-live | 1 day | Monitor first live conversations |

**Total: 7–10 business days** after copy + GHL access confirmed.

---

## Investment summary

| Option | Description | Timeline | Investment |
|--------|-------------|----------|------------|
| **1A** | GHL sends + KB records via webhooks | 10–14 days | **SGD 800** |
| **1B** ⭐ | KB Pipeline Follow-Up (recommended) | 7–10 days | **SGD 900** |
| **2** | DIY webhooks (guided) | ~5 days | **SGD 600** |
| **3** | Defer | — | — |

---

## Recommendation

**Proceed with Option 1B.**

It solves the original issue (AI lacking workflow message context), reduces long-term GHL workflow sprawl, and matches how AISBP is designed to operate: **GHL runs the CRM; KB runs intelligent conversation.**

Option 1A is viable if you must keep GHL as the sender short-term, but it is more fragile and harder to scale across many pipeline variants.

---

## Next steps

1. Confirm **Option 1B** (or alternative).
2. Share pipeline name + stage list + sample messages per stage.
3. Schedule 30-min kickoff (GHL location access + WhatsApp test contact).
4. We deliver build + GHL webhook templates + go-live checklist.

---

*Questions? Reply in your project channel or book a short review call before sign-off.*
