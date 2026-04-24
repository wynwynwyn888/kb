// INTERNAL DEV-ONLY — GHL SMS outbound send verification
// Status: SMS CONFIRMED LIVE (2026-04-19)
//         Other channels: unverified, fail fast — for WhatsApp (or other) contract probing only, use
//         ghl-outbound-probe.ts (caller-supplied type/channel; does not change CHANNEL_MAP).
// Usage: npx ts-node src/scripts/ghl-send-verify.ts <token> <locationId> <contactId> <messageBody>
//
// Example: npx ts-node src/scripts/ghl-send-verify.ts tok_xxx loc_xxx cont_xxx "Hello, this is a test message"
//
// NOTE: conversationId was REMOVED from outbound body (live browser capture confirmed).
// This script is for internal development verification only.
// It makes a live call to the GHL API using provided credentials.

import { createGhlClient } from '@aisbp/ghl-client';

async function main() {
  const [,, token, locationId, contactId, ...messageParts] = process.argv;

  if (!token || !locationId || !contactId) {
    console.error('Usage: npx ts-node src/scripts/ghl-send-verify.ts <token> <locationId> <contactId> <messageBody>');
    console.error('Example: npx ts-node src/scripts/ghl-send-verify.ts tok_xxx loc_xxx cont_xxx "Hello world"');
    process.exit(1);
  }

  const message = messageParts.join(' ');
  if (!message.trim()) {
    console.error('Message body cannot be empty');
    process.exit(1);
  }

  // Mask token in log output
  const masked = token.slice(0, 6) + '...' + token.slice(-4);

  // Live-confirmed SMS request body (2026-04-19 browser capture)
  const requestBody: { locationId: string; contactId: string; message: string; channel: 'SMS' } = {
    locationId,
    contactId,
    message,
    channel: 'SMS',
  };
  const sanitizedBody = {
    locationId,
    contactId,
    message: message.slice(0, 50) + (message.length > 50 ? '...' : ''),
    channel: 'SMS',
  };

  console.debug(`[SEND_VERIFY] Starting: token=${masked}`);
  console.debug(`[SEND_VERIFY] Request body: ${JSON.stringify(sanitizedBody)}`);

  const client = createGhlClient(token, locationId);
  const result = await client.sendMessage(requestBody);

  if (result.success) {
    // Echo the raw response so we can see the actual field names GHL returned
    console.log('[SEND_VERIFY] Raw response: messageId=' + (result.messageId ?? 'undefined') + ', conversationId=' + (result.conversationId ?? 'n/a'));
    console.log('[SEND_VERIFY] SUCCESS: sendMessage returned { success: true }');
    console.log('[SEND_VERIFY] POST /conversations/messages SMS — FULLY CONFIRMED');
    process.exit(0);
  } else {
    console.error('[SEND_VERIFY] FAILURE: sendMessage returned { success: false }');
    console.error('[SEND_VERIFY] Error: "' + result.error + '"');
    console.error('[SEND_VERIFY] result.error is the raw GHL body excerpt (or Axios fallback) — first 500 chars.');
    process.exit(1);
  }
}

main().catch((err) => {
  console.error('[SEND_VERIFY] EXCEPTION:', err instanceof Error ? err.message : String(err));
  process.exit(1);
});