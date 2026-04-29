import { BadRequestException } from '@nestjs/common';
import {
  BOOKING_MODES,
  BOOKING_REQUIRED_FIELD_KEYS,
  MVP_INTENT_KEYS,
  INTENT_TAG_TRIGGER_MODES,
  type BookingMode,
  type IntentTagTriggerMode,
} from './tenant-automation-constants';

export function parseRequiredFieldsJson(raw: unknown): string[] {
  if (raw === undefined || raw === null) return [];
  if (!Array.isArray(raw)) {
    throw new BadRequestException('requiredFieldsJson must be a JSON array of field keys');
  }
  const out: string[] = [];
  for (const x of raw) {
    if (typeof x !== 'string' || !x.trim()) {
      throw new BadRequestException('requiredFieldsJson must contain only non-empty strings');
    }
    out.push(x.trim());
  }
  return out;
}

export function assertAllowedRequiredFieldKeys(keys: string[]): void {
  const allowed = new Set<string>(BOOKING_REQUIRED_FIELD_KEYS);
  const bad = keys.filter((k) => !allowed.has(k));
  if (bad.length > 0) {
    throw new BadRequestException(`Unknown required field keys: ${bad.join(', ')}`);
  }
}

export function parseBookingMode(raw: unknown): BookingMode {
  if (typeof raw !== 'string' || !BOOKING_MODES.includes(raw as BookingMode)) {
    throw new BadRequestException(`bookingMode must be one of: ${BOOKING_MODES.join(', ')}`);
  }
  return raw as BookingMode;
}

export function parseIntentTriggerMode(raw: unknown): IntentTagTriggerMode {
  if (typeof raw !== 'string' || !INTENT_TAG_TRIGGER_MODES.includes(raw as IntentTagTriggerMode)) {
    throw new BadRequestException(`triggerMode must be AUTO or OFF`);
  }
  return raw as IntentTagTriggerMode;
}

export function assertMvpIntentKey(raw: string): void {
  if (!MVP_INTENT_KEYS.includes(raw as (typeof MVP_INTENT_KEYS)[number])) {
    throw new BadRequestException(`intentKey must be one of: ${MVP_INTENT_KEYS.join(', ')}`);
  }
}
