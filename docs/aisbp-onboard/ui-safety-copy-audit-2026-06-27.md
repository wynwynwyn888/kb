# AISBP-Onboard UI Safety Copy Audit — 2026-06-27

> **Result**: No unsafe wording found. No UI patches needed.
> **Method**: Grepped all `.tsx` files in `apps/onboard/src/` for unsafe claims.

---

## Unsafe Claims Searched

| Claim | Matches | Verdict |
|-------|---------|---------|
| "bot live" | 0 | ✓ Clean |
| "GHL synced" | 0 | ✓ Clean |
| "messages sent" | 1 (negated) | ✓ Safe — says "no messages sent" |
| "follow-up active" | 0 | ✓ Clean |
| "automation active" | 0 | ✓ Clean |
| "apply GHL" | 1 (negated) | ✓ Safe — says "disabled by default" |
| "activate" | 1 (negated) | ✓ Safe — says "does not activate the bot" |
| "go live" | 1 (negated) | ✓ Safe — says "deferred to future" |
| "outbound enabled" | 0 | ✓ Clean |
| "live bot" | 0 | ✓ Clean |

---

## Safe Wording Confirmed (All Present)

| Page | Safe Wording |
|------|-------------|
| Sync | "Dry run only — no KB/GHL writes, no tenant creation, no messages sent" |
| Sync | "Profile will be saved as inactive/draft. This does not activate the bot." |
| Sync | "Bot activation is deferred to a future controlled go-live PR." |
| Sync | "GHL apply sync is not implemented." |
| Sync | "No GHL writes. No workflow triggers. No appointments. No messages. No outbound." |
| Sync | "Local checks only — no GHL API calls made." |
| Settings | "Apply Sync: Disabled" |
| Settings | "GHL apply sync disabled by default. Must remain off until explicitly approved." |
| Settings | Feature flags all shown as `false` |
| Dashboard | "In-app alert only. No WhatsApp/email/SMS notification sent." |
| Review Queue | "External notifications are future (PR 11)." |
| Client Detail | "Section editing and approval comes in future PRs." |
| Client Detail | "Approval only prepares this project for future dry-run. No KB/GHL sync is active." |

---

## Verdict

No UI patches required. All pages accurately reflect the current state:
- Bot is inactive
- GHL is not synced
- Messages are not sent
- Outbound is disabled
- All execution is deferred
- All safety flags are documented

---

## Method

```bash
# Checked for unsafe claims
grep -rn "bot live\|GHL synced\|messages sent\|follow-up active\|outbound enabled" apps/onboard/src/

# Confirmed safe negations exist
grep -rn "inactive\|disabled\|noMessages\|no GHL\|not implemented\|deferred\|remains false" apps/onboard/src/
```

Result: 0 unsafe claims, 15+ safe negations present.
