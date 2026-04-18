// TEMPORARY — Manual GHL booking endpoint verification
// Remove after live verification is complete
// Usage: npx ts-node src/scripts/ghl-book-verify.ts <token> <locationId> <calendarId> <contactId> <startTime> <endTime>
//
// Example startTime/endTime: 2026-05-01T10:00:00 / 2026-05-01T10:30:00 (ISO 8601)
//
// This script is for internal development verification only.

import { createGhlClient } from '@aisbp/ghl-client';

async function main() {
  const [,, token, locationId, calendarId, contactId, startTime, endTime] = process.argv;

  if (!token || !locationId || !calendarId || !contactId || !startTime || !endTime) {
    console.error('Usage: npx ts-node src/scripts/ghl-book-verify.ts <token> <locationId> <calendarId> <contactId> <startTime> <endTime>');
    console.error('Example: npx ts-node src/scripts/ghl-book-verify.ts tok_xxx loc_xxx cal_xxx cont_xxx 2026-05-01T10:00:00 2026-05-01T10:30:00');
    process.exit(1);
  }

  const masked = token.slice(0, 6) + '...' + token.slice(-4);
  console.debug(`[BOOK_VERIFY] Starting: token=${masked}, locationId=${locationId}, calendarId=${calendarId}`);
  console.debug(`[BOOK_VERIFY] Contact: ${contactId}, slot: ${startTime} -> ${endTime}`);

  const client = createGhlClient(token, locationId);
  const result = await client.bookSlot({ calendarId, contactId, startTime, endTime });

  if (result.success) {
    console.log('[BOOK_VERIFY] SUCCESS: bookSlot returned { success: true, appointmentId=' + result.appointmentId + ' }');
    console.log('[BOOK_VERIFY] ASSUMED endpoint POST /appointments confirmed working');
    process.exit(0);
  } else {
    console.error('[BOOK_VERIFY] FAILURE: bookSlot returned { success: false, error: "' + result.error + '" }');
    process.exit(1);
  }
}

main().catch((err) => {
  console.error('[BOOK_VERIFY] EXCEPTION:', err instanceof Error ? err.message : String(err));
  process.exit(1);
});
