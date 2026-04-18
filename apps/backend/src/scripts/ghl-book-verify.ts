// TEMPORARY — Manual GHL booking endpoint verification
// Remove after live verification is complete
// Usage: npx ts-node src/scripts/ghl-book-verify.ts <token> <locationId> <calendarId> <contactId> <startTime> <endTime>
//
// Example: npx ts-node src/scripts/ghl-book-verify.ts tok_xxx loc_xxx cal_xxx cont_xxx 2026-05-01T10:00:00 2026-05-01T10:30:00
//
// NOTE: If you get "Contact, calendar, or location not found" — the endpoint path is
// confirmed correct (GHL reached and rejected the request). The IDs used must all belong
// to the same GHL sub-account/location. Check that calendarId, contactId, and locationId
// all reference the same GHL account context.
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

  // Log what IDs are being used (masked)
  const masked = token.slice(0, 6) + '...' + token.slice(-4);
  console.debug(`[BOOK_VERIFY] token=${masked}`);
  console.debug(`[BOOK_VERIFY] locationId=${locationId}  <-- GHL sub-account/location`);
  console.debug(`[BOOK_VERIFY] calendarId=${calendarId}  <-- must belong to same locationId`);
  console.debug(`[BOOK_VERIFY] contactId=${contactId}  <-- must belong to same locationId`);
  console.debug(`[BOOK_VERIFY] slot=${startTime} -> ${endTime}`);

  const client = createGhlClient(token, locationId);
  const result = await client.bookSlot({ calendarId, contactId, startTime, endTime });

  if (result.success) {
    console.log('[BOOK_VERIFY] SUCCESS: bookSlot returned { success: true, appointmentId=' + result.appointmentId + ' }');
    console.log('[BOOK_VERIFY] POST /appointments — FULLY CONFIRMED');
    process.exit(0);
  } else {
    console.error('[BOOK_VERIFY] FAILURE: bookSlot returned { success: false, error: "' + result.error + '" }');
    console.error('[BOOK_VERIFY] NOTE: "Contact, calendar, or location not found" means:');
    console.error('  - endpoint path is CONFIRMED correct (GHL reached the booking endpoint)');
    console.error('  - calendarId, contactId, and locationId must all reference the same GHL sub-account');
    console.error('  - verify that the contact and calendar belong to the same GHL location as locationId');
    process.exit(1);
  }
}

main().catch((err) => {
  console.error('[BOOK_VERIFY] EXCEPTION:', err instanceof Error ? err.message : String(err));
  process.exit(1);
});
