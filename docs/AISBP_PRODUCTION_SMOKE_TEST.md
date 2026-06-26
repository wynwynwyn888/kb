# AISBP production smoke test (GHL → AISBP → GHL)

This describes a **manual** check of the live loop using a controlled webhook POST. **Nothing runs automatically** in production from this repo; use the helper scripts when you choose to test.

## What path is verified

- **Inbound:** `POST /api/v1/webhooks/ghl` (see `apps/backend` `WebhooksController`).
- **Processing:** BullMQ → `InboundMessageProcessor` → orchestration.
- **Outbound:** GHL **`POST /conversations/messages`** as **SMS only** in current code (`OutboundSendService` + `@aisbp/ghl-client`).

**WhatsApp** (and other channels) are **not** verified for outbound in this codebase; use **SMS-capable** HighLevel contacts for a meaningful end-to-end check.

## Required real values (HighLevel + AISBP)

| Value | Required? | Notes |
|--------|------------|--------|
| **`locationId`** | **Yes** | Must match AISBP: `tenants.ghl_location_id` and a `tenant_ghl_connections` row with **`CONNECTED`**. |
| **`contactId`** | **Yes** | Real GHL contact in that location; **SMS-capable** if you expect an SMS delivery from AISBP’s outbound path. |
| **`conversationId`** | **Recommended** | Use a **real** GHL conversation id for thread consistency; if omitted, the helper generates `conv-smoke-<suffix>`. |
| **`message` / `messageType`** | Format matters | Use `messageType` that maps to **text** (e.g. `TextMessage`). |

No AISBP secrets are sent in the webhook helper; the Private Integration token is used **server-side** when AISBP calls GHL outbound.

## Production Auth Notes

**When `WEBHOOK_SIGNATURE_SECRET` is configured on the backend**, unsigned webhook POSTs return `401 {"message":"Webhook verification failed","reason":"missing_signature"}`. This is **correct and expected** — the backend must not accept unsigned webhooks in production.

To run a production smoke test, provide auth credentials via the helper scripts:

### Static token (simplest)
```bash
# Via CLI flag (NOT recommended for committing):
./infra/vps/scripts/smoke-ghl-webhook.sh --location-id "xxx" --contact-id "yyy" --webhook-token "your-secret"

# Via env var (recommended — never committed):
export AISBP_WEBHOOK_TOKEN="your-secret"
./infra/vps/scripts/smoke-ghl-webhook.sh --location-id "xxx" --contact-id "yyy"
```

### HMAC-SHA256 signature
```bash
# Via env var (recommended):
export WEBHOOK_SIGNATURE_SECRET="your-secret"
./infra/vps/scripts/smoke-ghl-webhook.sh --location-id "xxx" --contact-id "yyy"
```
The script computes the correct `x-ghl-signature` header automatically. The secret is never printed.

**Never commit real secrets.** Use environment variables only. The scripts accept `AISBP_WEBHOOK_TOKEN` and `WEBHOOK_SIGNATURE_SECRET` env vars as fallbacks.

Without auth (local/dev): unsigned webhooks are accepted when the backend secret is not configured. No flags or env changes needed.

## Helper scripts (from repo root)

**PowerShell** (Windows or cross-platform `pwsh`):

```powershell
pwsh infra/vps/scripts/smoke-ghl-webhook.ps1 -LocationId "YOUR_LOCATION_ID" -ContactId "YOUR_CONTACT_ID"
pwsh infra/vps/scripts/smoke-ghl-webhook.ps1 -LocationId "..." -ContactId "..." -ConversationId "..." -Message "hi"
```

**Bash** (Linux VPS; requires `jq` and `curl`):

```bash
chmod +x infra/vps/scripts/smoke-ghl-webhook.sh
./infra/vps/scripts/smoke-ghl-webhook.sh --location-id "YOUR_LOCATION_ID" --contact-id "YOUR_CONTACT_ID"
./infra/vps/scripts/smoke-ghl-webhook.sh --location-id "..." --contact-id "..." --conversation-id "..." --message "hi"
```

Default webhook URL: `https://kb.aisalesbot.pro/api/v1/webhooks/ghl`  
Override: `-WebhookUrl` / `--webhook-url` or env `WEBHOOK_URL` (bash).

Each run generates a **new** `data.id` (`ghl-msg-smoke-<yyyyMMdd-HHmmss>-<random>`) so dedupe does not swallow the event.

## Watch logs (VPS)

Use your actual backend container name if it differs:

```bash
docker logs -f aisbp-backend-1
```

If workers run in a **separate** container, tail that container too for queue processors.

## Success log sequence (substrings to expect)

Rough order:

1. `Webhook received: event=` … `locationId=`
2. `Webhook processed: eventId=` … (not “unregistered or inactive location”)
3. `Processing inbound message: conversationId=`
4. `Message stored: conversationId=`
5. `Orchestration result:` with **`outcome=PROCEED`** (or `Orchestration completed:` in orchestration service logs)
6. `Send-bubble job enqueued: conversationId=`
7. `Send-bubble job started: conversationId=`
8. `Outbound send completed: conversationId=` with succeeded bubbles

**Note:** If the workspace is in **suggestive** bot mode, orchestration may proceed **without** enqueueing send-bubble (by design).

## Failure hints

| Observation | Likely cause |
|-------------|----------------|
| No `Webhook received` | Wrong URL, TLS/proxy, or not hitting the Nest process you are tailing. |
| `unregistered or inactive location` | `locationId` not linked / not `CONNECTED` in AISBP. |
| Webhook OK, no `Processing inbound message` | Redis / BullMQ / worker not consuming `inbound-message` jobs. |
| `Orchestration skipped` / outcome not `PROCEED` | Guards (bot off, GHL disconnected, handover, quota, message type, channel, etc.). |
| Outbound **401 / 403 / 404 / 422** | Token, permissions, or GHL payload/contact/conversation mismatch. |

See inline comments in `infra/vps/scripts/smoke-ghl-webhook.ps1` and `smoke-ghl-webhook.sh` for payload shape.
