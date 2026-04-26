# AISBP Design System

## Product Context

AISBP Middleware is a premium AI conversation middleware platform for agencies using GoHighLevel.

AISBP helps agencies control AI replies, formatting, tone, knowledge, provider settings, handover rules, and client workspace behavior.

The core product promise:

> Turn messy AI replies into clean, controlled, human-like customer conversations.

AISBP is not replacing GoHighLevel.  
AISBP sits on top of GoHighLevel as the AI control and quality layer.

---

## Target Users

### 1. Agency Owner

Uses AISBP to:

- Manage client workspaces
- Connect HighLevel locations
- Configure AI providers
- Set global reply standards
- Monitor credits and usage
- Manage team access

They want clarity, control, and confidence.

### 2. Non-Technical Client

Uses AISBP to:

- Add business knowledge
- Update bot instructions
- Test bot replies
- Check whether their bot is ready

They want simple wording and obvious next steps.

### 3. Internal Support/Admin

Uses AISBP to:

- Troubleshoot setup
- Check connection status
- Inspect raw identifiers
- Verify provider and bot behavior

They need technical details, but those details should live under **Advanced** or **Support details**, not in the main user view.

---

## Brand Feel

AISBP should feel like:

- Premium B2B SaaS
- Calm
- Clean
- Modern
- Confident
- High-trust
- Practical
- Guided
- Professional without feeling cold

Reference feel:

- Linear
- Intercom
- Stripe Dashboard
- Claude-style clean chat preview
- Modern AI SaaS admin console

Avoid:

- Developer console feel
- Raw admin panel feel
- Debug dashboard feel
- Overly playful design
- Heavy animations
- Cluttered tables
- Tiny text
- Too many borders
- Too many blue links

---

## Visual Direction

### Background

Use a soft neutral app background.

Suggested:

#F7F8FB
#F8FAFC
#F9FAFB

### Cards

Cards should feel soft and structured.

Suggested:

background: #FFFFFF;
border: 1px solid #E2E8F0;
border-radius: 14px to 16px;
box-shadow: 0 1px 2px rgba(15, 23, 42, 0.04);
padding: 20px to 24px;

Avoid heavy borders or harsh shadows.

### Typography

Use modern SaaS typography.

- Prefer sans-serif
- Avoid editorial serif headings unless intentionally used
- Page titles should be clear and confident
- Helper text should be short and muted

Suggested hierarchy:

Page title: 28 to 32px, 700 weight  
Section title: 16 to 18px, 650 to 700 weight  
Body text: 14 to 15px  
Helper text: 13px, muted  
Small meta text: 12px, muted

### Page Width

Main content should usually sit inside:

max-width: 1120px to 1200px

Large technical pages may use wider layouts, but avoid full-width chaos.

### Spacing

Use generous spacing.

Page header bottom margin: 24px  
Card gap: 16px to 24px  
Section gap: 24px to 32px  
Form field gap: 12px to 16px

---

## Colors

### Primary Blue

Use blue as the main action color.

#0F62FE  
#2563EB

Use for:

- Primary buttons
- Active navigation
- Selected tabs
- Key highlights

Do not make everything blue.

### Navy

Use dark navy sparingly for premium emphasis.

#0F172A  
#111827

Use for:

- Dark header panels
- Important preview cards
- Strong text

### Green

Use for successful states.

#16A34A  
#DCFCE7

Examples:

- Connected
- Saved
- Active
- Ready

### Amber

Use for setup/pending states.

#D97706  
#FEF3C7

Examples:

- Pending
- Needs setup
- Processing
- Needs review

### Red

Use for destructive or error states.

#DC2626  
#FEE2E2

Examples:

- Delete
- Failed
- Invalid
- Disconnected when urgent

### Neutral

Use for inactive or non-urgent states.

#64748B  
#E2E8F0  
#F1F5F9

---

## Product Language

### Agency Area

Use these labels:

- Control Center
- Client Workspaces
- AI Provider
- Credits
- Global Prompt
- Team
- Recent Activity
- Needs Attention

Avoid:

- Subaccounts
- Tenant
- Quotas
- Policy
- Audit log
- Database terms

### Workspace Area

Use these labels:

- Workspace Settings
- Knowledge
- Bot Instructions
- Test your bot
- Usage
- Team
- Advanced

Avoid:

- Tenant
- Profile default
- API-only
- CRUD
- Schema
- Row
- Heuristic
- Not implemented

### GoHighLevel Language

First mention:

HighLevel

Compact/advanced usage:

GHL

Use:

HighLevel location ID  
HighLevel private integration token  
HighLevel connection

Avoid showing raw IDs in the main view. Put them under:

Advanced details  
Support details

---

## Copy Principles

Every page should answer:

1. What is this page for?
2. What is the current status?
3. What should the user do next?
4. What can safely be ignored or hidden?

Use one clear sentence under each page title.

Avoid long helper paragraphs.

Prefer:

Add approved answers your bot can use when replying.

Instead of:

Add FAQ, long-form text, and documents. Plain text and .txt work reliably. PDF, Word docs, and .docx can be uploaded...

---

## Common Copy Replacements

| Avoid | Use |
|---|---|
| Tenant | Workspace / Client workspace |
| Subaccount | Workspace / Client workspace |
| GHL location id | HighLevel location ID |
| Provider credentials | AI provider |
| Policy | Prompt / Reply rules |
| Quota | Credits |
| Audit log | Activity log |
| Master Prompt | Global Prompt |
| Your bot | Bot Instructions |
| Max tokens | Maximum reply length |
| Not implemented | Coming soon / Managed in HighLevel |
| API-only | Available in Advanced / Support details |
| CRUD | Manage / Edit / Update |
| Row | Record / Item |
| Database | System / Workspace data |

---

## Button System

### Primary Button

Use for the main action on the page.

Examples:

- Save changes
- Add FAQ
- Test reply
- Connect HighLevel
- Save provider

Style:

background: #0F62FE;
color: #FFFFFF;
border-radius: 10px;
font-weight: 600;

### Secondary Button

Use for neutral actions.

Examples:

- Upload file
- Add note
- Search
- Open workspace

Style:

background: #FFFFFF;
border: 1px solid #CBD5E1;
color: #0F172A;

### Danger Button

Use for destructive actions.

Examples:

- Delete
- Remove user
- Disconnect

Style:

background: #FFFFFF;
border: 1px solid #FCA5A5;
color: #DC2626;

Do not place destructive buttons beside primary actions without spacing.

---

## Status Pills

Use short, readable labels.

### Green

- Connected
- Active
- Saved
- Ready

### Amber

- Needs setup
- Pending
- Processing
- Needs review

### Red

- Failed
- Invalid
- Error

### Neutral

- Inactive
- Draft
- Not connected

Avoid raw enum values.

Convert:

OWNER → Owner  
MINIMAX → MiniMax  
DISCONNECTED → Not connected

---

## Layout Patterns

### 1. Page Header

Each main page should start with:

Kicker, optional  
Title  
One-sentence subtitle  
Optional right-side primary action

Example:

Knowledge

Manage the information your bot uses to answer customer questions.

---

### 2. Section Card

Use cards for grouped work.

Each card should have:

Title  
Short helper text  
Main content  
Optional footer/action

Avoid cards with only one tiny line unless it is a dashboard metric.

---

### 3. Empty State

Empty states should be useful.

Bad:

No data.

Good:

No answers yet. Add your first FAQ to help the bot respond accurately.

Pattern:

What is missing?  
Why does it matter?  
What should the user do next?

---

### 4. Advanced Details

Use collapsible sections for technical data.

Labels:

- Advanced details
- Support details
- Response details
- Technical details

Put these inside:

- Raw IDs
- JSON
- Tokens
- Provider payloads
- Debug output
- Diagnostics
- Internal routing notes

---

# Page-Specific Design Guidance

## Control Center

Purpose:

Monitor workspaces, AI provider status, usage, and recent activity.

Primary sections:

- Workspaces
- HighLevel Connections
- Live AI
- Credits
- Recent Activity
- Needs Attention
- Quick Actions

Avoid raw audit/database wording.

---

## Client Workspaces

Purpose:

Create and manage the workspaces connected to HighLevel.

Table columns:

- Workspace
- Status
- HighLevel
- AI setup
- Actions

Actions:

- Open workspace
- Connect HighLevel
- Set token
- Delete

Hide IDs under Advanced details.

---

## AI Provider

Purpose:

Choose the AI provider and default model used across your agency.

Sections:

1. Provider
   - Provider
   - API key
   - Organization or group ID
   - Default model

2. Workspace limits
   - Model override
   - Style range
   - Reply length range

---

## Global Prompt

Purpose:

Set the agency-wide reply standards applied before each workspace’s own bot instructions.

Use:

- Prompt versions
- Prompt instructions
- Use as default
- Save prompt
- Delete version

Avoid:

- Policy
- Row
- Internal priority wording

Priority helper:

When multiple prompts exist, the highest priority becomes active.

---

## Workspace Settings

Purpose:

Review setup, connection status, and routing options for this workspace.

Top summary card should show:

- Workspace name
- Status
- HighLevel connection
- Active model
- Bot mode

Sections:

- HighLevel connection
- Bot status
- Human handoff
- Booking
- Tags
- Advanced identifiers

---

## Knowledge

Purpose:

Manage the information your bot uses to answer customer questions.

Actions:

- Add note
- Upload file
- Add FAQ

Tabs:

- FAQs
- Notes
- Files

Knowledge item cards should show:

- Title
- Short summary
- Status pill
- Updated time
- Usage count if available
- Edit / More actions

Empty state:

No answers yet. Add your first FAQ to help the bot answer common customer questions.

Search:

Search knowledge  
Search question or phrase

---

## Test Your Bot

This is a preview panel, not a debug console.

Purpose:

Preview the reply your bot would send to a customer.

Layout:

- Customer message bubble aligned right
- Bot reply bubble aligned left
- Input fixed at bottom
- Button: Test reply
- Response details collapsed or muted
- Source chips below reply

Sandbox note:

Preview only. This message will not be sent to customers.

Important safety rule:

Never show or send:

- <think>...</think>
- hidden reasoning
- chain-of-thought
- raw model thinking
- XML-like reasoning tags
- internal debug text

The preview should only show the final customer-facing reply.

If model output includes thinking, sanitize it before rendering or sending.

---

## Bot Instructions

Purpose:

Define how this workspace’s bot should sound, what it should achieve, and what it must know.

Sections:

- Persona
- Conversation goals
- Business notes
- Reply settings

Labels:

- Persona
- Conversation goals
- Business notes
- Maximum reply length

Keep advanced profile details collapsed.

---

## Usage

Purpose:

Track credits, message usage, and activity for this workspace.

Empty state:

No usage recorded yet. Usage will appear here after the bot starts replying to customers.

---

## Team

Purpose:

Manage who can access this agency account.

Columns:

- Email
- Name
- Role
- Actions

Use title-case role labels:

- Owner
- Admin
- Operator
- Member
- Agent
- Viewer

Keep internal IDs under Advanced options.

---

# Stitch Usage Guide

When using Stitch, prompt it with this design system.

Ask Stitch to produce:

1. Visual redesign
2. React/Tailwind-style code
3. Reusable component styling
4. Notes on spacing, cards, buttons, and responsive behavior

Do not ask Stitch to design all pages at once.

Use this order:

1. Knowledge + Test your bot
2. Workspace Settings
3. Client Workspaces
4. AI Provider
5. Global Prompt
6. Control Center

Then ask Cursor to adapt the Stitch design into the real codebase.

---

# Cursor Implementation Rule

Stitch output is visual direction only.

Cursor must:

- Preserve existing API calls
- Preserve route structure
- Preserve form handlers
- Preserve save/delete/test/upload actions
- Preserve auth behavior
- Avoid backend changes unless required for safety
- Avoid new libraries unless approved
- Reuse existing shared frontend components where practical
- Run build checks before commit

---

# Production Safety Rule

AISBP must never expose model reasoning to end customers.

Any customer-facing response must be sanitized before display or send.

At minimum, strip:

<think>...</think>

including multiline, multiple blocks, case variants, and unclosed opening tags.

Customer-facing output means:

- Live chat replies
- WhatsApp replies
- SMS replies
- Messenger replies
- Instagram replies
- Dashboard bot preview
- Any exported or logged reply shown to normal users

Internal debug may exist only behind explicit Support/Advanced details and must not be visible by default.
