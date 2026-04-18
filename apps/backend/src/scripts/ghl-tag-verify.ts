// TEMPORARY — Manual GHL tag endpoint verification
// Remove after live verification is complete
// Usage: npx ts-node src/scripts/ghl-tag-verify.ts <token> <locationId> <contactId> <tagValue>
//
// This script is for internal development verification only.
// It makes a live call to the GHL API using provided credentials.

import { createGhlClient } from '@aisbp/ghl-client';

async function main() {
  const [,, token, locationId, contactId, tagValue] = process.argv;

  if (!token || !locationId || !contactId || !tagValue) {
    console.error('Usage: npx ts-node src/scripts/ghl-tag-verify.ts <token> <locationId> <contactId> <tagValue>');
    process.exit(1);
  }

  // Mask token in log output
  const masked = token.slice(0, 6) + '...' + token.slice(-4);
  console.debug(`[TAG_VERIFY] Starting: token=${masked}, locationId=${locationId}, contactId=${contactId}, tag=${tagValue}`);

  const client = createGhlClient(token, locationId);
  const result = await client.tagContact({ contactId, tags: [tagValue] });

  if (result.success) {
    console.log('[TAG_VERIFY] SUCCESS: tagContact returned { success: true }');
    console.log('[TAG_VERIFY] Endpoint POST /contacts/{contactId}/tags confirmed working');
    process.exit(0);
  } else {
    console.error('[TAG_VERIFY] FAILURE: tagContact returned { success: false, error: "' + result.error + '" }');
    console.error('[TAG_VERIFY] This may indicate: invalid token, contact not found, or permission denied');
    process.exit(1);
  }
}

main().catch((err) => {
  console.error('[TAG_VERIFY] EXCEPTION:', err instanceof Error ? err.message : String(err));
  process.exit(1);
});
