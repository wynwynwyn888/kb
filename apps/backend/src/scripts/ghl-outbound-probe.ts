/**
 * INTERNAL DEV-ONLY — probe POST /conversations/messages with caller-supplied `type` + `channel`.
 *
 * Use this to gather live evidence for WhatsApp (or any channel) the same way SMS was verified,
 * WITHOUT adding speculative values to @aisbp/ghl-client CHANNEL_MAP.
 *
 * Body shape matches GhlClient.sendMessage (SMS mapping): same top-level fields as a successful
 * SMS capture — only `type` and `channel` are supplied by you (from browser DevTools Network
 * when sending a message in a WhatsApp-enabled location, or from GHL docs once confirmed).
 *
 * Usage:
 *   npx tsx src/scripts/ghl-outbound-probe.ts <token> <locationId> <contactId> <ghlType> <ghlChannel> <message>
 *
 * Example (placeholders only — do NOT treat as verified):
 *   npx tsx src/scripts/ghl-outbound-probe.ts "$GHL_TOKEN" "$LOC" "$CONT" "???" "???" "probe message"
 *
 * SMS unchanged: keep using `ghl-send-verify.ts` for known-good SMS checks.
 *
 * -----------------------------------------------------------------------------
 * MANUAL EVIDENCE CHECKLIST (after each attempt):
 * [ ] Request body below matches what you intend (copy to ticket).
 * [ ] HTTP status: ___
 * [ ] Response JSON saved: ___
 * [ ] ghlType / ghlChannel tried: ___ / ___
 * [ ] Message visible in the correct GHL conversation/thread: yes / no
 * [ ] Only after success + UI check: update CHANNEL_MAP in ghl-client with dated comment.
 * -----------------------------------------------------------------------------
 */
import { resolveGhlApiBaseUrl } from '@aisbp/ghl-client';
import axios from 'axios';

const BASE = resolveGhlApiBaseUrl(process.env['GHL_API_BASE_URL']);

async function main() {
  const [, , token, locationId, contactId, ghlType, ghlChannel, ...messageParts] = process.argv;

  if (!token || !locationId || !contactId || !ghlType || !ghlChannel) {
    console.error(
      'Usage: npx tsx src/scripts/ghl-outbound-probe.ts <token> <locationId> <contactId> <ghlType> <ghlChannel> <message>',
    );
    console.error(
      'ghlType and ghlChannel are required — supply candidates from Network tab (no defaults in this script).',
    );
    process.exit(1);
  }

  const message = messageParts.join(' ');
  if (!message.trim()) {
    console.error('Message body cannot be empty');
    process.exit(1);
  }

  const masked = token.length > 12 ? token.slice(0, 6) + '...' + token.slice(-4) : '(token)';

  /** Same structural fields as SMS success path in ghl-client CHANNEL_MAP for sendMessage. */
  const body = {
    contactId,
    locationId,
    message,
    type: ghlType,
    channel: ghlChannel,
    attachments: [] as unknown[],
    fromOneToOneConversation: true,
  };

  const logBody = {
    ...body,
    message:
      message.length > 80 ? `${message.slice(0, 80)}… (${message.length} chars)` : message,
  };

  console.log(`[PROBE] token=${masked} base=${BASE}`);
  console.log(`[PROBE] POST /conversations/messages body=${JSON.stringify(logBody)}`);

  try {
    const response = await axios.post(`${BASE}/conversations/messages`, body, {
      headers: {
        Authorization: `Bearer ${token}`,
        'Content-Type': 'application/json',
        Version: '2021-07-28',
      },
      timeout: 30000,
      validateStatus: () => true,
    });

    console.log(`[PROBE] HTTP ${response.status}`);
    console.log(`[PROBE] response.data=${JSON.stringify(response.data)}`);

    if (response.status >= 200 && response.status < 300) {
      console.log(
        '[PROBE] OK — verify in GHL UI that the message landed on the expected thread; HTTP success alone is not enough.',
      );
      process.exit(0);
    }
    process.exit(1);
  } catch (err) {
    const ax = axios.isAxiosError(err) ? err : null;
    const status = ax?.response?.status;
    const data = ax?.response?.data;
    console.error(
      `[PROBE] ERROR status=${status ?? 'n/a'} data=${typeof data === 'object' ? JSON.stringify(data) : String(data ?? err)}`,
    );
    process.exit(1);
  }
}

void main();
