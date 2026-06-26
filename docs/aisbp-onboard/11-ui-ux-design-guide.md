# AISBP-Onboard — UI/UX Design Guide

## 1. Visual Style Direction

**Reuse the existing AISBP/KB dark SaaS style** where possible. Reference `docs/AISBP_DESIGN_SYSTEM.md` for the full design system.

### Key references from AISBP Design System

| Element | Value |
|---------|-------|
| Background | `#F7F8FB` or dark variant |
| Cards | `#FFFFFF` bg, `1px solid #E2E8F0`, `border-radius: 14-16px` |
| Primary Blue | `#0F62FE` / `#2563EB` |
| Green (success) | `#16A34A` / `#DCFCE7` |
| Amber (pending) | `#D97706` / `#FEF3C7` |
| Red (error) | `#DC2626` / `#FEE2E2` |
| Neutral | `#64748B` / `#E2E8F0` / `#F1F5F9` |
| Typography | Sans-serif, 14-15px body, 28-32px page titles |

---

## 2. Navigation Structure

```
┌─────────────────────────────────────────────────────────┐
│  AISBP-Onboard                          [🔔] [👤 Wyn]  │
├─────────────────────────────────────────────────────────┤
│  📊 Dashboard                                           │
│  👥 Clients                                             │
│  📋 Projects                                            │
│  🔍 Review Queue                      [3 pending]       │
│  📝 Audit Log                                           │
│  ⚙️ Settings (future)                                   │
└─────────────────────────────────────────────────────────┘
```

---

## 3. Pages

### Dashboard

**Purpose**: Overview of all onboarding activity.

**Layout**:
```
┌─────────────────────────────────────────────────────────┐
│  Dashboard                                              │
│  Overview of all client onboarding projects             │
├──────────────────┬──────────────────┬───────────────────┤
│  Projects        │  Needs Review    │  Live Clients     │
│  ┌────────────┐  │  ┌────────────┐  │  ┌─────────────┐  │
│  │     12     │  │  │      3     │  │  │      5      │  │
│  │   Total    │  │  │  Pending   │  │  │   Active    │  │
│  └────────────┘  │  └────────────┘  │  └─────────────┘  │
├──────────────────┴──────────────────┴───────────────────┤
│  Recent Activity                                        │
│  ┌─────────────────────────────────────────────────────┐│
│  │ Dapper Dogs · dapperdogs — Submitted for review    ││
│  │ 2 hours ago                                         ││
│  ├─────────────────────────────────────────────────────┤│
│  │ Pawfection · pawfection — Section approved          ││
│  │ 5 hours ago                                         ││
│  └─────────────────────────────────────────────────────┘│
│                                                         │
│  Quick Actions                                          │
│  [+ New Project]  [View Review Queue]                  │
└─────────────────────────────────────────────────────────┘
```

### Client List

**Purpose**: All onboarded clients.

**Table columns**:
- Client (Business Name · clientKey)
- Status pill
- Project
- Contact (masked phone)
- Last Updated
- Actions

### Client Detail

**Purpose**: Client overview + linked projects.

**Sections**:
- Client info card (name, contact, timezone, status)
- Projects list for this client
- Identity map (KB tenant, GHL IDs — collapsed under "Advanced details")

### Project Detail (Tabs)

**Purpose**: Main work area for reviewing/editing a project.

**Tabs**:
```
[Overview] [Business Profile] [Sales Process] [FAQ] [Prompt] [Handover] [Follow-Up] [Recommendations] [Sync] [Audit]
```

**Tab content pattern** (per section):
```
┌─────────────────────────────────────────────────────────┐
│  Business Profile                        [Status: ✅ Approved]│
│  ─────────────────────────────────────────────────────  │
│                                                         │
│  Business Name: Dapper Dogs                             │
│  Description: Premium dog grooming...                   │
│  Services: [3 items]                                    │
│  ...                                                    │
│                                                         │
│  [Edit Section]  [Approve Section]  [Request Changes]   │
└─────────────────────────────────────────────────────────┘
```

### Review Queue

**Purpose**: Projects awaiting Wyn's review.

**Layout**:
```
┌─────────────────────────────────────────────────────────┐
│  Review Queue                            [3 pending]     │
│  Projects submitted by agent, awaiting your review      │
├─────────────────────────────────────────────────────────┤
│  ┌─────────────────────────────────────────────────────┐│
│  │ 🟡 Dapper Dogs · dapperdogs                         ││
│  │ Submitted 2 hours ago · 72% complete                 ││
│  │ [Review]                                            ││
│  ├─────────────────────────────────────────────────────┤│
│  │ 🟡 Pawfection · pawfection                          ││
│  │ Submitted 5 hours ago · 85% complete                 ││
│  │ [Review]                                            ││
│  └─────────────────────────────────────────────────────┘│
└─────────────────────────────────────────────────────────┘
```

### Agent Session Detail

**Purpose**: View agent interview session progress.

**Layout**:
```
┌─────────────────────────────────────────────────────────┐
│  Agent Session                          [Status: Active] │
│  Project: Dapper Dogs · dapperdogs                       │
├─────────────────────────────────────────────────────────┤
│  Progress: ████████░░░░░░░░ 7/12 steps                   │
│                                                         │
│  Current step: FAQ — Pricing questions                   │
│  Started: 2026-06-26 10:00                               │
│  Expires: 2026-06-27 10:00                               │
│                                                         │
│  Recent Answers:                                        │
│  ┌─────────────────────────────────────────────────────┐│
│  │ business_name → "Dapper Dogs" (confidence: 0.98)    ││
│  │ description → "Premium dog grooming..." (0.95)     ││
│  │ services → [3 items] (0.90)                        ││
│  └─────────────────────────────────────────────────────┘│
└─────────────────────────────────────────────────────────┘
```

### Sync Preview

**Purpose**: Preview sync results before applying.

**Layout**:
```
┌─────────────────────────────────────────────────────────┐
│  KB Sync Preview                                         │
│  Dry-run completed · 2026-06-26 12:00                    │
├─────────────────────────────────────────────────────────┤
│  Changes to be applied:                                  │
│                                                         │
│  ✅ New Tenant: "Dapper Dogs"                            │
│  ✅ Knowledge Items: 15 FAQ items will be created        │
│  ✅ Prompt Config: Bot instructions will be created      │
│  ⚠️ Handover Rules: Not configured                       │
│  ⚠️ Follow-Up Rules: Not configured                      │
│                                                         │
│  No conflicts detected.                                  │
│                                                         │
│  [⬅ Back to Project]  [Apply KB Sync]                   │
└─────────────────────────────────────────────────────────┘
```

### Audit Log

**Purpose**: Chronological audit trail.

**Layout**:
```
┌─────────────────────────────────────────────────────────┐
│  Audit Log — Dapper Dogs · dapperdogs                    │
│  Filter: [All ▼]                                         │
├─────────────────────────────────────────────────────────┤
│  ┌─────────────────────────────────────────────────────┐│
│  │ 12:15  wyn-operator     sync.kb.apply    ✅ Applied ││
│  │ 12:00  wyn-operator     sync.kb.dry-run   ✅ Passed ││
│  │ 11:30  wyn-operator     project.approve   ✅        ││
│  │ 11:00  wyn-operator     section.approve   ✅        ││
│  │ 10:30  whatsapp-agent   project.submit     📤       ││
│  │ 10:00  whatsapp-agent   answer.submit     ✅        ││
│  └─────────────────────────────────────────────────────┘│
└─────────────────────────────────────────────────────────┘
```

### Settings / Integrations (Future)

**Sections**:
- KB Integration — connection status, base URL, test connection
- GHL Integration — mode (dry_run/apply), base URL, test connection
- Notification Settings — channel, phone number
- Feature Flags — read-only status display

---

## 4. Component Patterns

### Status Pills

```
🟢 Approved    — #DCFCE7 bg, #16A34A text
🟢 Live        — #DCFCE7 bg, #16A34A text
🟢 Complete    — #DCFCE7 bg, #16A34A text
🟢 Applied     — #DCFCE7 bg, #16A34A text
🟡 In Review   — #FEF3C7 bg, #D97706 text
🟡 Submitted   — #FEF3C7 bg, #D97706 text
🟡 Partial     — #FEF3C7 bg, #D97706 text
🟡 Pending     — #FEF3C7 bg, #D97706 text
🔴 Rejected    — #FEE2E2 bg, #DC2626 text
🔴 Failed      — #FEE2E2 bg, #DC2626 text
⚪ Draft       — #F1F5F9 bg, #64748B text
⚪ Empty       — #F1F5F9 bg, #64748B text
⚪ Paused      — #F1F5F9 bg, #64748B text
⚪ Archived    — #F1F5F9 bg, #64748B text
```

### Warning Banners

```
┌─────────────────────────────────────────────────────────┐
│  ⚠️ This project has 3 missing required fields.          │
│  Sections: Sales Process (2), Handover (1)              │
│  [View Missing Fields]                                  │
└─────────────────────────────────────────────────────────┘

┌─────────────────────────────────────────────────────────┐
│  🔒 Dry-run only. No changes have been made to KB.       │
│  Review the preview above, then click "Apply KB Sync".  │
└─────────────────────────────────────────────────────────┘
```

### Approval Buttons

```
Primary (approve):
  [Approve Section]  — blue bg, white text

Danger (reject):
  [Request Changes]  — outlined red, red text

Neutral:
  [Edit Section]     — outlined gray, dark text
  [View Details]     — text only, blue
```

**Button states**:
- Active: full opacity, clickable
- Disabled: 50% opacity, not clickable, tooltip explains why
- Loading: spinner inside button, text "Approving..."

### Empty States

```
┌─────────────────────────────────────────────────────────┐
│                                                         │
│              📋 No projects yet                          │
│                                                         │
│     Create your first onboarding project to get         │
│     started with client setup.                          │
│                                                         │
│              [+ New Project]                            │
│                                                         │
└─────────────────────────────────────────────────────────┘
```

### Error States

```
┌─────────────────────────────────────────────────────────┐
│  ❌ Failed to load project                               │
│  The server returned an error. Please try again.        │
│  [Retry]                                                │
└─────────────────────────────────────────────────────────┘
```

### Loading States

```
┌─────────────────────────────────────────────────────────┐
│  ⏳ Loading project details...                           │
│  ████████████░░░░░░░░                                    │
└─────────────────────────────────────────────────────────┘
```

---

## 5. Identifier Display Standard

| Context | Display Format |
|---------|---------------|
| Client list | `Dapper Dogs · dapperdogs` |
| Project header | `Dapper Dogs · dapperdogs` |
| Contact phone | `+65****1234` (masked by default) |
| GHL conversation short ID | `b6bac998` |
| GHL contact short ID | `kfmh8xHo` |
| KB tenant short ID | `34c62859` |
| Session ID | `b8c9d0e1` (first 8 chars) |
| Full ID (copyable) | Available on click/copy |

**Rules**:
- Always show `Business Name · clientKey` as primary identifier
- Never show full phone numbers by default
- Short IDs (first 8 chars of UUID) in list views
- Full UUIDs in detail views and copy-to-clipboard

---

## 6. Privacy Display Rules

| Data | List View | Detail View | Audit View |
|------|-----------|-------------|------------|
| Business Name | Full | Full | Full |
| Contact Name | Full | Full | Full |
| Phone | `+65****1234` | `+65****1234` (click to reveal) | Never shown |
| Email | `jam***@dapp***` | Full (operator only) | Never shown |
| GHL Location ID | `kfmh8xHo` | Full | Full |
| KB Tenant ID | `34c62859` | Full | Full |
| API Keys/Tokens | Never | Never | Never |

---

## 7. Mobile Considerations

- Single column layout on mobile (stacked cards)
- Navigation collapses to hamburger menu
- Tables become card lists
- Action buttons stack vertically
- Status pills remain inline
- Touch targets minimum 44px

---

## 8. Accessibility Basics

- All form fields have labels
- Error messages are descriptive
- Color is not the only indicator (status pills include text)
- Buttons have visible focus states
- Page titles are in `<h1>`
- ARIA labels on icon-only buttons
- Keyboard navigation for approval workflow

---

## 9. Main UX Principle

**Wyn should always know**:

1. **Who** the client is — Business Name · clientKey, prominently displayed
2. **What stage** they are at — Status pill, progress bar, current phase
3. **What is missing** — Missing fields panel, section status
4. **What AI suggested** — Recommendations tab, AI confidence scores
5. **What will sync** to KB/GHL — Sync preview before apply
6. **What is safe** to approve — Warning banners for risky changes
7. **What needs correction** — Rejected sections with comments

---

## 10. Page Inventory (MVP)

| Page | Route | MVP? |
|------|-------|------|
| Dashboard | `/` | Yes |
| Client List | `/clients` | Yes |
| Client Detail | `/clients/[id]` | Yes |
| Project Detail | `/projects/[id]` | Yes |
| Review Queue | `/review-queue` | Yes |
| Agent Session Detail | `/sessions/[id]` | Yes |
| Sync Preview | `/projects/[id]/sync` | Yes |
| Audit Log | `/audit` | Yes |
| Settings | `/settings` | Future |
