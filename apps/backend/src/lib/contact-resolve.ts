/**
 * Contact ID resolution — normalizes phone-format contact IDs to GHL internal IDs.
 *
 * When GHL webhooks deliver a phone number as the contactId (e.g. +6588658634),
 * we resolve it to the internal GHL contact UUID (e.g. kfmh8xHdo4KFVLO43BWI) at
 * the earliest opportunity so that conversation matching, outbound sends, and
 * all downstream services use a stable identifier.
 *
 * This is a pure utility — it does NOT depend on NestJS DI so both processors
 * and services can call it directly.
 */

import { Logger } from '@nestjs/common';
import type { SupabaseClient } from '@supabase/supabase-js';
import { createGhlClient } from '@aisbp/ghl-client';
import { decrypt } from './encryption';

const logger = new Logger('ContactResolve');

export interface ContactResolveResult {
  /** The best available contact ID to use (GHL internal ID if resolved, else original). */
  resolvedContactId: string;
  /** The original contactId as received from the webhook. */
  originalContactId: string;
  /** True if a phone number was resolved to a GHL internal ID. */
  wasResolved: boolean;
}

/**
 * Check if a contactId looks like an E.164 phone number (starts with +, at least 7 digits).
 */
export function isPhoneFormattedContactId(contactId: string): boolean {
  return /^\+[0-9]{7,}$/.test(contactId.trim());
}

/**
 * Resolve a contact ID to the best available stable identifier.
 *
 * If the contactId is phone-formatted, attempts to look up the GHL internal
 * contact ID via the GHL API. Falls back gracefully to the original contactId
 * on any failure (credentials missing, API error, no match found).
 */
export async function resolveContactIdIfPhone(
  supabase: SupabaseClient,
  tenantId: string,
  locationId: string,
  contactId: string,
): Promise<ContactResolveResult> {
  const trimmed = contactId.trim();

  if (!isPhoneFormattedContactId(trimmed)) {
    return { resolvedContactId: trimmed, originalContactId: trimmed, wasResolved: false };
  }

  // Load GHL credentials
  const { data } = await supabase
    .from('tenant_ghl_connections')
    .select('private_token_encrypted')
    .eq('tenant_id', tenantId)
    .eq('ghl_location_id', locationId)
    .eq('status', 'CONNECTED')
    .maybeSingle();

  if (!data) {
    logger.warn(`contactResolveNoCredentials: tenantId=${tenantId} locationId=${locationId} contactId=${trimmed}`);
    return { resolvedContactId: trimmed, originalContactId: trimmed, wasResolved: false };
  }

  let token: string;
  try {
    token = decrypt(String(data['private_token_encrypted']));
  } catch (e) {
    logger.warn(`contactResolveDecryptFailed: ${e instanceof Error ? e.message : String(e)}`);
    return { resolvedContactId: trimmed, originalContactId: trimmed, wasResolved: false };
  }

  const ghlClient = createGhlClient(token, locationId);

  try {
    const result = await ghlClient.findContactByPhone(locationId, trimmed);

    if (!result.success) {
      logger.warn(
        `contactResolveApiFailed: contactId=${trimmed} locationId=${locationId} error=${result.error ?? 'unknown'}`,
      );
      return { resolvedContactId: trimmed, originalContactId: trimmed, wasResolved: false };
    }

    if (!result.contact?.id) {
      logger.warn(
        `contactResolveNoMatch: contactId=${trimmed} locationId=${locationId} — no GHL contact found`,
      );
      return { resolvedContactId: trimmed, originalContactId: trimmed, wasResolved: false };
    }

    logger.log(
      `contactResolveResolved: contactId=${trimmed} → ghlContactId=${result.contact.id}`,
    );
    return { resolvedContactId: result.contact.id, originalContactId: trimmed, wasResolved: true };
  } catch (e) {
    logger.warn(
      `contactResolveError: contactId=${trimmed} error=${e instanceof Error ? e.message : String(e)}`,
    );
    return { resolvedContactId: trimmed, originalContactId: trimmed, wasResolved: false };
  }
}
