#!/usr/bin/env bash
# Posts a realistic GHL inbound webhook JSON to AISBP (safe manual smoke test).
#
# Usage:
#   ./infra/vps/scripts/smoke-ghl-webhook.sh --location-id "xxx" --contact-id "yyy"
#   ./infra/vps/scripts/smoke-ghl-webhook.sh --location-id "xxx" --contact-id "yyy" --conversation-id "zzz" --message "hi"
#
# Production auth (when WEBHOOK_SIGNATURE_SECRET is configured on the backend):
#   ./infra/vps/scripts/smoke-ghl-webhook.sh --location-id "xxx" --contact-id "yyy" --webhook-token "my-secret"
#   ./infra/vps/scripts/smoke-ghl-webhook.sh --location-id "xxx" --contact-id "yyy" --webhook-secret "my-secret"
#
# Env overrides (optional): WEBHOOK_URL, MESSAGE, AISBP_WEBHOOK_TOKEN, WEBHOOK_SIGNATURE_SECRET
set -euo pipefail

WEBHOOK_URL="${WEBHOOK_URL:-https://kb.aisalesbot.pro/api/v1/webhooks/ghl}"
MESSAGE="${MESSAGE:-AISBP smoke test. Please reply with one short sentence.}"

LOCATION_ID=""
CONTACT_ID=""
CONVERSATION_ID=""
WEBHOOK_TOKEN=""
WEBHOOK_SECRET=""

while [[ $# -gt 0 ]]; do
  case "$1" in
    --location-id) LOCATION_ID="$2"; shift 2 ;;
    --contact-id) CONTACT_ID="$2"; shift 2 ;;
    --conversation-id) CONVERSATION_ID="$2"; shift 2 ;;
    --message) MESSAGE="$2"; shift 2 ;;
    --webhook-url) WEBHOOK_URL="$2"; shift 2 ;;
    --webhook-token) WEBHOOK_TOKEN="$2"; shift 2 ;;
    --webhook-secret) WEBHOOK_SECRET="$2"; shift 2 ;;
    -h|--help)
      echo "Usage: $0 --location-id ID --contact-id ID [--conversation-id ID] [--message TEXT] [--webhook-url URL] [--webhook-token TOKEN] [--webhook-secret SECRET]"
      echo ""
      echo "Production auth: set --webhook-token or --webhook-secret to match the backend's WEBHOOK_SIGNATURE_SECRET."
      echo "Env vars: AISBP_WEBHOOK_TOKEN and WEBHOOK_SIGNATURE_SECRET also work."
      exit 0
      ;;
    *) echo "Unknown option: $1" >&2; exit 1 ;;
  esac
done

if [[ -z "$LOCATION_ID" || -z "$CONTACT_ID" ]]; then
  echo "Required: --location-id and --contact-id" >&2
  exit 1
fi

if ! command -v jq >/dev/null 2>&1; then
  echo "This script requires jq (e.g. sudo apt install jq)." >&2
  exit 1
fi

# Resolve auth from env vars if not provided via CLI
TOKEN="${WEBHOOK_TOKEN:-${AISBP_WEBHOOK_TOKEN:-}}"
SECRET="${WEBHOOK_SECRET:-${WEBHOOK_SIGNATURE_SECRET:-}}"

UNIQUE_SUFFIX="$(date -u +"%Y%m%d-%H%M%S")-$(openssl rand -hex 2)"
DATA_ID="ghl-msg-smoke-${UNIQUE_SUFFIX}"
if [[ -n "$CONVERSATION_ID" ]]; then
  CONV="$CONVERSATION_ID"
else
  CONV="conv-smoke-${UNIQUE_SUFFIX}"
fi
TS="$(date -u +"%Y-%m-%dT%H:%M:%S.000Z")"

BODY="$(jq -nc \
  --arg locationId "$LOCATION_ID" \
  --arg contactId "$CONTACT_ID" \
  --arg conversationId "$CONV" \
  --arg message "$MESSAGE" \
  --arg id "$DATA_ID" \
  --arg ts "$TS" \
  '{
    locationId: $locationId,
    event: "InboundMessage",
    timestamp: $ts,
    version: "1.0",
    data: {
      id: $id,
      conversationId: $conversationId,
      contactId: $contactId,
      message: $message,
      messageType: "TextMessage",
      channel: "SMS"
    }
  }')"

echo ""
echo "--- Smoke test preview (no secrets) ---"
echo "  Webhook URL:       $WEBHOOK_URL"
echo "  locationId:        $LOCATION_ID"
echo "  contactId:         $CONTACT_ID"
echo "  conversationId:    $CONV"
echo "  message:           $MESSAGE"
echo "  generated data.id: $DATA_ID"
printf "  auth:              "
if [[ -n "$TOKEN" ]]; then
  echo "static token (****)"
elif [[ -n "$SECRET" ]]; then
  echo "HMAC-SHA256 (secret not shown)"
else
  echo "none (may fail 401 in production)"
fi
echo "----------------------------------------"
echo ""
read -r -p "Type SEND exactly to continue: " CONFIRM
if [[ "$CONFIRM" != "SEND" ]]; then
  echo "Aborted (expected exactly: SEND)." >&2
  exit 1
fi

echo ""
echo "Posting..."

RESP_FILE="$(mktemp)"
trap 'rm -f "$RESP_FILE"' EXIT

# Build auth headers
AUTH_HEADERS=(-H "Content-Type: application/json; charset=utf-8")
if [[ -n "$TOKEN" ]]; then
  # Static token auth: x-aisbp-webhook-token header
  AUTH_HEADERS+=(-H "x-aisbp-webhook-token: $TOKEN")
elif [[ -n "$SECRET" ]]; then
  # HMAC-SHA256 auth: compute signature over raw body
  # The backend strips an optional "sha256=" prefix and verifies the hex digest.
  SIG="$(echo -n "$BODY" | openssl dgst -sha256 -hmac "$SECRET" | awk '{print $NF}')"
  AUTH_HEADERS+=(-H "x-ghl-signature: sha256=$SIG")
else
  # No auth — send empty signature (works only if backend secret is not configured)
  AUTH_HEADERS+=(-H "x-ghl-signature: ")
fi

HTTP_CODE="$(curl -sS -o "$RESP_FILE" -w "%{http_code}" \
  -X POST "$WEBHOOK_URL" \
  "${AUTH_HEADERS[@]}" \
  --data-binary "$BODY")" || true

echo "HTTP $HTTP_CODE"
if [[ -s "$RESP_FILE" ]]; then cat "$RESP_FILE"; echo ""; fi

if [[ "$HTTP_CODE" == "401" ]]; then
  echo ""
  echo "Webhook auth failed (401). The backend requires a valid signature or static token."
  echo "Use --webhook-token or --webhook-secret with the same value as the backend's WEBHOOK_SIGNATURE_SECRET."
  echo "Never commit secrets — use env vars: AISBP_WEBHOOK_TOKEN or WEBHOOK_SIGNATURE_SECRET."
  exit 1
fi

if [[ "$HTTP_CODE" -lt 200 || "$HTTP_CODE" -ge 300 ]]; then
  echo "Request returned a non-2xx status." >&2
  exit 1
fi

echo ""
echo "Next: watch VPS logs, e.g. docker logs -f aisbp-backend-1"
echo "See docs/AISBP_PRODUCTION_SMOKE_TEST.md for expected log sequence."
