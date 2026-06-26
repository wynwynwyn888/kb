# Contact ID Normalization at Creation — PR Notes

## Summary

Normalizes phone-formatted contact IDs to GHL internal IDs at conversation creation time, preventing data integrity issues where phone numbers were stored as `contact_id` instead of stable GHL UUIDs.

## Files Changed

| File | Change |
|------|--------|
| `src/lib/contact-resolve.ts` | **New** — shared helper that resolves phone-format contact IDs to GHL internal IDs |
| `src/lib/contact-resolve.spec.ts` | **New** — 11 tests covering all resolution paths |
| `src/queues/processors/inbound-message.processor.ts` | **Modified** — calls `resolveContactIdIfPhone` before identity derivation; handles phone-key upgrade for existing conversations |
| `docs/reviews/contact-id-normalization-pr-notes-2026-06-26.md` | **New** — this document |

## Logic Before

```
Webhook (contactId: "+6588658634") 
  → getOrCreateConversation(contactId)
    → deriveConversationIdentity(externalContactId: "+6588658634")
      → derivedKey = "aisbp:conv:whatsapp:tenant-1:+6588658634"
    → INSERT contact_id = "+6588658634" (phone stored as ID!)
```

Send-time fallback (`resolveContactIdIfPhone`) would fix it later, but the bad row already existed.

## Logic After

```
Webhook (contactId: "+6588658634")
  → getOrCreateConversation(contactId)
    → resolveContactIdIfPhone() → resolvedContactId: "kfmh8xHdo4KFVLO43BWI"
    → deriveConversationIdentity(externalContactId: "kfmh8xHdo4KFVLO43BWI")
      → derivedKey = "aisbp:conv:whatsapp:tenant-1:kfmh8xHdo4KFVLO43BWI"
    → INSERT contact_id = "kfmh8xHdo4KFVLO43BWI" (correct GHL UUID!)
    → metadata stores originalContactId + contactResolvedAt
```

## Phone-Key Upgrade (Existing Conversations)

If an existing conversation was created with a phone-derived key before this PR, the next webhook for that contact will:

1. Resolve the phone → GHL internal ID
2. Try the GHL-ID-derived key — miss (doesn't exist yet)
3. Try the phone-derived key — hit! (step 2b)
4. **Upgrade** the existing conversation: set `contact_id` to the GHL internal ID and `ghl_conversation_id` to the new derived key
5. Reuse the upgraded conversation (no duplication)

This self-heals the 2 known bad rows (`c6d0250f`, `07fd8cdd`) on the next inbound message.

## Test Coverage

| # | Scenario | Status |
|---|----------|--------|
| 1 | New inbound with valid GHL contact ID | Pass (unchanged path) |
| 2 | New inbound with phone-only contact ID | Pass — resolves then creates with correct ID |
| 3 | Existing conversation found by resolved GHL ID | Pass (step 2 hits) |
| 4 | Existing phone-key conversation gets upgraded | Pass (step 2b hits) |
| 5 | `isPhoneFormattedContactId` edge cases | Pass (5 tests) |
| 6 | Resolution failures gracefully fall back | Pass (3 tests: no credentials, no match, API error) |
| 7 | Send-time fallback still works | Pass (unchanged `outbound-send.service.ts`) |

## Risks

- **GHL API call on every new phone-format webhook**: Adds latency to first message from a new phone contact. Resolves to original on API failure (graceful degradation). Non-blocking — if it fails, the conversation is created with the phone as before.
- **Existing phone-key conversations are upgraded in-place**: Changes `contact_id` and `ghl_conversation_id` columns. Tested in spec (step 2b). The old derived key is replaced with the new one.
- **No DB migration needed**: The upgrade is done via UPDATE on existing rows. No schema change.
- **outbound-send.service.ts unchanged**: The send-time fallback (`resolveContactIdIfPhone`) still exists as a safety net and continues to work independently.

## Rollback

- Revert the commit. No DB migration to reverse.
- Conversations already upgraded remain upgraded (contact_id changed to GHL ID). This is the desired state — reverting won't undo the upgrade but prevents future upgrades.
- Existing phone-format conversations that haven't received a new webhook yet will remain as-is until the fix is re-deployed.

## What Was NOT Changed

- No DB schema changes
- No migrations
- No env changes
- No runtime flag changes
- No frontend changes
- No outbound send behavior changes
- No GHL sync changes
