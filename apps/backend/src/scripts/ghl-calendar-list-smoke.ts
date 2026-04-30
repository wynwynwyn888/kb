/**
 * Smoke: list calendars via GET /calendars/ (Version 2023-02-21).
 *
 * Usage (from apps/backend):
 *   set GHL_PI_TOKEN=<Private Integration token>
 *   set GHL_LOCATION_ID=<sub-account location id>
 *   npx ts-node src/scripts/ghl-calendar-list-smoke.ts
 *
 * Prints only count, ids, names — never the token.
 */

import { createGhlClient, GHL_CALENDARS_LIST_API_VERSION } from '@aisbp/ghl-client';

async function main() {
  const token = process.env['GHL_PI_TOKEN'] ?? process.env['GHL_PRIVATE_INTEGRATION_TOKEN'];
  const locationId = process.env['GHL_LOCATION_ID']?.trim();

  if (!token?.trim() || !locationId) {
    // eslint-disable-next-line no-console
    console.error(
      'Set GHL_PI_TOKEN (or GHL_PRIVATE_INTEGRATION_TOKEN) and GHL_LOCATION_ID. Example:\n' +
        '  set GHL_PI_TOKEN=...\n' +
        '  set GHL_LOCATION_ID=...\n' +
        '  npx ts-node src/scripts/ghl-calendar-list-smoke.ts',
    );
    process.exit(1);
  }

  const client = createGhlClient(token.trim(), locationId);
  const r = await client.listCalendars();

  // eslint-disable-next-line no-console
  console.log('apiVersion=', GHL_CALENDARS_LIST_API_VERSION);
  // eslint-disable-next-line no-console
  console.log('path=', r.requestPath ?? '/calendars/');
  if (r.error) {
    // eslint-disable-next-line no-console
    console.error('ERROR:', r.error);
    // eslint-disable-next-line no-console
    console.error('httpStatus=', r.httpStatus);
    // eslint-disable-next-line no-console
    console.error('responseBody(excerpt)=', r.responseBodyExcerpt ?? '');
    process.exit(1);
  }

  // eslint-disable-next-line no-console
  console.log('count=', r.calendars.length);
  for (const c of r.calendars) {
    // eslint-disable-next-line no-console
    console.log(`${c.id}\t${c.name}`);
  }
}

main().catch(err => {
  // eslint-disable-next-line no-console
  console.error(err instanceof Error ? err.message : String(err));
  process.exit(1);
});
