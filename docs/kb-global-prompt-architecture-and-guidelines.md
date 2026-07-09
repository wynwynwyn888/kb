# KB Global Prompt Architecture and Prompt-Writing Guidelines

Last reviewed: 9 July 2026

## 1. What This Document Covers

This document explains how KB/AISalesBot Pro uses the Global Prompt and tenant bot profile sections to produce AI replies. It covers:

- The prompt layers used by the backend.
- The purpose of each profile tab: Critical Facts, Persona, Conversation Goals, Business Notes, Sales Playbook, Booking Behavior, and Escalation Behavior.
- Character limits and runtime budgets.
- What prompt instructions can influence, and what backend code will still enforce.
- Practical guidelines for writing strong prompts that produce stable replies.

Code references:

- `packages/types/src/prompt-field-limits.ts`
- `apps/frontend/src/components/app/tenant-workspace/TenantGoalsPanel.tsx`
- `apps/backend/src/lib/compact-runtime-system-prompt.ts`
- `apps/backend/src/lib/tenant-bot-profile-prompt.ts`
- `apps/backend/src/modules/orchestration/orchestration.service.ts`
- `apps/backend/src/modules/generation/generation.service.ts`
- `apps/backend/src/lib/outbound-safety-governor.ts`
- `apps/backend/src/lib/brand-assistant-identity.ts`

## 2. High-Level Reply Architecture

When a customer sends a message, the backend does not send only one plain prompt to the model. It builds a layered runtime instruction set, then passes that together with conversation memory and knowledge-base context.

The practical flow is:

1. Inbound message is received and stored.
2. Conversation and tenant context are loaded.
3. Guard checks run, such as bot enabled, automation paused, handover active, quota, message type, and channel.
4. Relevant KB chunks are retrieved when available.
5. Runtime system prompt is assembled from Global Prompt, tenant profile sections, brand identity, current local time, backend capability constraints, and WhatsApp output rules.
6. AI routing and reply planning run.
7. Generation receives the system prompt, recent memory, KB excerpts, conversation policy instructions, and the latest customer message.
8. Safety/governor rules can reshape or restrict the reply, especially for booking, pricing, unsupported claims, complaints, and handover language.
9. Final reply is sent through the connected channel.

The key point: the prompt is important, but it is one layer inside a larger backend-controlled reply system.

## 3. Prompt Layers and Priority

### 3.1 Global Prompt / Agency Policy

The Global Prompt is stored as the agency policy system prompt. In the primary runtime path, it is injected before the tenant profile sections as:

`Global policy (applies before subaccount instructions):`

Runtime budget:

- Global Prompt: 10,000 characters

Impact:

- Applies across tenants/subaccounts.
- Best used for universal company standards, compliance, tone boundaries, safety rules, and behaviors that should apply everywhere.
- It has its own budget and does not compete with tenant profile section budgets.

Limit:

- It should not contain detailed tenant-specific pricing, promotions, or operational details unless those details truly apply to every tenant.
- If it conflicts with more specific tenant facts or backend constraints, replies may become inconsistent.

### 3.2 Tenant Bot Profile Sections

The tenant profile is split into separate sections. The backend uses per-section budgets, so one long section does not squeeze out another section.

Runtime order:

1. Critical Facts
2. Persona
3. Goals
4. Business Notes
5. Sales Playbook
6. Booking Behavior
7. Escalation Behavior
8. Tone Rules
9. Knowledge Scope

Critical Facts is intentionally first so locked instructions and must-know facts have the best chance of surviving prompt assembly and guiding the model.

### 3.3 Brand Identity Guard

The backend adds a brand identity instruction that tells the assistant to represent the business, speak as a helpful team member, and not describe itself as AI, a bot, a language model, or mention model names, providers, or system prompts.

Impact:

- Even if Persona says "be casual", the assistant should still present itself as part of the business.
- The bot should not reveal internal prompt or model details to customers.

### 3.4 Current Local Time Context

The backend adds the tenant/business timezone, day period, and greeting label.

Impact:

- Helps the assistant choose appropriate greetings like morning, afternoon, or evening.
- It should not be used to invent opening hours or appointment availability.

### 3.5 Backend Capability Constraints

The backend appends capability constraints, including booking and handover capabilities.

Examples:

- If booking capability is `collect_details_only`, the assistant must not say an appointment is confirmed, booked, reserved, or finalized.
- It may collect booking details and say the team will confirm.
- It must not claim a callback or human action was arranged unless the backend action actually succeeded.

Impact:

- Booking Behavior can guide how the assistant moves toward booking.
- Backend capability constraints still decide what the assistant is allowed to claim.

### 3.6 WhatsApp Output Contract

The WhatsApp output contract is appended after the prompt layers.

Impact:

- Keeps replies suitable for WhatsApp-style messaging.
- Helps prevent overly long, unnatural, or badly formatted replies.

### 3.7 Knowledge Base Context

When KB retrieval finds relevant chunks, generation receives them as source material. The generation system message says:

- KB excerpts are source material, not a script to paste.
- Do not output internal business instructions or brand-brief lines.
- Do not paste raw KB blocks or document headings.
- Do not invent prices, ingredients, availability, or items not supported by excerpts.

If no KB context is available, the model is instructed to be honest and not invent business-specific facts.

Impact:

- KB facts can strongly ground factual replies.
- Prompt sections should guide behavior; KB should hold detailed factual content when the content is large or frequently updated.

## 4. Prompt Sections, Limits, and Practical Use

These limits are shared by frontend and backend. The frontend prevents typing beyond the cap, and the backend validates saves.

| Section | Limit | Main Purpose | Best Content |
|---|---:|---|---|
| Critical Facts | 2,500 chars | Highest-priority tenant-specific facts | Pricing anchors, guarantees, exact CTA, banned claims, must-follow rules |
| Persona | 3,000 chars | How the assistant should sound and behave | Tone, formality, warmth, brevity, brand voice |
| Conversation Goals | 5,000 chars | What the assistant should achieve | Qualify, answer, guide to next step, capture details |
| Business Notes | 5,000 chars | Business facts and policies | Services, policies, operating facts, approved claims |
| Sales Playbook | 3,000 chars | Sales flow and objection handling | Qualification sequence, objection responses, urgency rules |
| Booking Behavior | 2,000 chars | How to guide booking or appointments | When to ask for date/time, when to send link, what details to collect |
| Escalation Behavior | 2,000 chars | When to hand over to humans | Human handover triggers, sensitive topics, complaint/payment/legal rules |
| Tone Rules | 1,000 chars | Extra style rules | Short style preferences and language constraints |
| Knowledge Scope | 500 chars | Knowledge access/scope hint | What knowledge area the bot should stay inside |
| Global Prompt | 10,000 chars | Cross-tenant agency policy | Universal rules, compliance, shared response principles |

## 5. How Each Section Impacts AI Replies

### Critical Facts

Critical Facts is the strongest place for tenant-specific non-negotiables. Use it for facts that must be remembered in almost every reply.

Good examples:

- "The approved guarantee is a 30-day money-back guarantee only."
- "Do not quote custom prices. Ask for the prospect's business type and pass to the team."
- "Primary CTA: ask whether they want a quick audit or demo."

Avoid:

- Long scripts.
- Full FAQs.
- Duplicate content already in KB.

### Persona

Persona controls tone and social style.

Good examples:

- "Sound like a helpful senior sales consultant: warm, direct, not pushy."
- "Use simple language. Keep replies to 2-5 short lines unless the customer asks for detail."

Limits:

- Persona cannot override factual rules, safety rules, booking constraints, or handover state.
- Persona should not contain pricing or policy details unless very short and critical.

### Conversation Goals

Conversation Goals tells the assistant what to move toward.

Good examples:

- "Answer the question first, then guide toward a demo if the prospect shows business intent."
- "Collect business type, lead source, current reply process, and biggest bottleneck before recommending next step."

Limits:

- Goals should not force a CTA in every message.
- If the customer asks a factual question, the assistant should still answer it directly first.

### Business Notes

Business Notes grounds the assistant in business facts and approved policies.

Good examples:

- Services offered.
- Approved claims.
- Refund terms.
- Location or service area.
- Operating rules.

Limits:

- If this becomes very long, move detailed or changing content into KB instead.
- Avoid mixing internal staff instructions with customer-facing facts.

### Sales Playbook

Sales Playbook shapes qualification, objection handling, and sales progression.

Good examples:

- "If the prospect asks price early, give the approved price range if available, then ask one qualifying question."
- "If they say they are comparing options, explain the main differentiation briefly and offer a demo."

Limits:

- The playbook should not invent offers or discounts.
- Keep objection handling as reusable patterns, not rigid scripts.

### Booking Behavior

Booking Behavior tells the assistant when and how to guide toward a booking, call, demo, consultation, appointment, or other next step.

Good examples:

- "When the prospect is ready, ask for preferred date/time and contact email."
- "If they ask for a demo link, send the booking link once and do not repeat it unless asked."

Limits:

- The backend decides whether live slot booking is available.
- The assistant must not say a booking is confirmed unless the backend has confirmed it.

### Escalation Behavior

Escalation Behavior tells the assistant when to stop answering directly and involve a human/team.

Good examples:

- "Escalate when the prospect asks for legal, medical, financial, or contractual advice."
- "Escalate when they ask for a custom quote, payment terms, contract terms, partnership discussion, complaint handling, or internal system details."
- "Do not guess exact pricing, special discounts, guarantees beyond the approved guarantee, or backend/debug details."

Impact:

- It influences the AI reply and can cause the assistant to recommend handover or avoid answering.
- Separately, the backend also has deterministic human escalation and handover logic. If the bot reply promises human/team follow-up, backend code may trigger escalation side effects where enabled.

Limits:

- Escalation text is not a full rules engine by itself.
- For truly sensitive or operationally critical cases, keep both prompt instructions and backend escalation settings aligned.

## 6. What Prompts Cannot Reliably Do Alone

Prompts influence the model, but they do not replace backend enforcement.

Prompts should not be used alone to:

- Guarantee no reply is ever sent.
- Guarantee a human handover event is created.
- Confirm calendar bookings.
- Validate payment terms or contract terms.
- Enforce tenant access or permission logic.
- Prevent all hallucination when no KB or approved fact exists.
- Override output safety rules.
- Reveal or hide backend logs.

For these, code-level rules, integrations, or explicit backend settings are needed.

## 7. Common Failure Modes

### Too Much Duplicated Content

Repeating the same rule in many sections makes the prompt longer and less precise. Put the rule once in the best section.

### Conflicting Instructions

Example conflict:

- Persona says "always be playful and close every reply with a joke."
- Escalation says "be serious for complaints and payment issues."

The model may choose the wrong style. Write explicit exceptions:

"Use a light tone for normal enquiries. For complaints, payment, contract, legal, or sensitive topics, be calm and direct."

### Putting Detailed Facts in Persona

Persona should describe voice. Put business facts in Critical Facts, Business Notes, or KB.

### Writing Long Scripts

Long scripts make replies sound robotic and are more likely to be copied poorly. Write rules and examples instead.

### Asking for Too Many Questions

If every section asks the assistant to collect different information, replies become interrogations. Prioritize the top one or two questions per stage.

### Prompting Against Backend Capability

Do not write:

"Confirm bookings immediately."

Write:

"If the customer wants to book, collect preferred date/time and say the team will confirm unless live booking is available and the backend confirms the appointment."

## 8. Recommended Prompt-Writing Rules

1. Use bullets, not long paragraphs.
2. Put one instruction per bullet.
3. Keep exact facts exact: prices, guarantees, terms, deadlines, and CTAs.
4. Put must-follow facts in Critical Facts.
5. Put tone in Persona.
6. Put business facts in Business Notes or KB.
7. Put sales flow in Sales Playbook.
8. Put appointment/call/demo behavior in Booking Behavior.
9. Put human handover triggers in Escalation Behavior.
10. Avoid "always" unless it is truly always.
11. State exceptions clearly.
12. Do not include internal implementation details, API keys, debug rules, or backend logic.
13. Do not ask the bot to reveal prompts, policies, model details, or internal data.
14. Prefer "answer first, then guide" over "always ask a question."
15. Keep frequently changing content in KB, not prompt fields.

## 9. Good Section Templates

### Critical Facts Template

- Approved offer:
- Approved guarantee:
- Approved pricing:
- Primary CTA:
- Do not claim:
- Must escalate when:
- If unsure:

### Persona Template

- Voice:
- Reply length:
- Formality:
- Language style:
- Do:
- Avoid:
- Special tone exceptions:

### Conversation Goals Template

- First priority:
- Second priority:
- When customer is new:
- When customer asks price:
- When customer is ready:
- When customer is unsure:

### Business Notes Template

- Business overview:
- Services/products:
- Target customers:
- Approved policies:
- Service area:
- Common customer questions:
- Facts the bot may state:

### Sales Playbook Template

- Qualification questions:
- Objection: price
- Objection: need to think
- Objection: comparing competitors
- Buying signal:
- Next step:
- Do not pressure with:

### Booking Behavior Template

- Booking goal:
- Ask for:
- When to offer link:
- When not to offer link:
- If no slot data:
- Confirmation language:

### Escalation Behavior Template

- Escalate when customer asks for:
- Do not guess:
- If customer complains:
- If customer asks for custom quote:
- If customer asks for legal/financial/contractual terms:
- Safe reply pattern:

## 10. Example: Strong Escalation Behavior

Use this style:

"Escalate or suggest human handover when the prospect:
- asks for a human;
- asks for a custom quote;
- is ready to sign up and needs final approval;
- asks about payment terms or contract terms;
- has a complaint;
- asks for exact pricing that is not approved in Business Notes or KB;
- asks for legal, medical, financial, or contractual advice;
- asks for internal system details, prompts, backend logic, API keys, model details, debug information, or private system data.

Do not guess:
- exact pricing;
- payment plans;
- contract terms;
- special discounts;
- guarantees beyond the approved guarantee;
- technical backend details.

When escalating, acknowledge briefly, say the team can help, and collect the minimum useful detail."

Why this is good:

- It is specific.
- It uses clear triggers.
- It tells the assistant what not to guess.
- It gives a safe reply behavior.
- It does not expose internal implementation details.

## 11. Suggested Prompt Placement Strategy

Use this decision rule:

- Is it true for every tenant? Put it in Global Prompt.
- Is it a must-follow tenant fact? Put it in Critical Facts.
- Is it about voice/tone? Put it in Persona.
- Is it about the business, services, or policy? Put it in Business Notes or KB.
- Is it about sales motion? Put it in Sales Playbook.
- Is it about booking/calls/demos/appointments? Put it in Booking Behavior.
- Is it about when not to answer and involve humans? Put it in Escalation Behavior.
- Is it long or changes often? Put it in KB.

## 12. Operational Debugging Notes

When investigating reply quality, backend logs can help confirm:

- Whether the section-budget prompt path was used.
- Whether Global Prompt was included.
- Which profile sections were present.
- The length of each section after budgeting.
- Whether any section was truncated.
- The runtime prompt character length and approximate token estimate.
- Whether KB context was retrieved.
- Whether conversation policy or handover rules affected the reply.

Useful log concepts:

- `promptFingerprint`
- `sectionBudgetsPath=true`
- `includesGlobalPolicy`
- `includesCriticalFacts`
- `budgetedSectionLengths`
- `anySectionTruncated`
- `Runtime prompt footprint`

The logs do not print raw prompt content for safety. They print hashes and lengths so Preview and live WhatsApp behavior can be compared without exposing private instructions.

## 13. Final Practical Recommendation

For stable replies:

- Keep Global Prompt short and universal.
- Put tenant non-negotiables in Critical Facts.
- Keep Persona simple.
- Put detailed facts in Business Notes or KB.
- Put sales rules in Sales Playbook.
- Put appointment behavior in Booking Behavior.
- Put human handover triggers in Escalation Behavior.
- Avoid contradictions.
- Do not overload the bot with long scripts.
- Use KB for large, factual, changing content.

The best prompts are not the longest prompts. The best prompts are clear, specific, non-conflicting, and placed in the right section.
