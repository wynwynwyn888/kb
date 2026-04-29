/** Milestone 1 — automation settings (booking + intent tags). Shared by API validation and tests. */

export const BOOKING_MODES = [
  'COLLECT_DETAILS_ONLY',
  'CHECK_AVAILABILITY',
  'BOOK_AFTER_CONFIRMATION',
] as const;

export type BookingMode = (typeof BOOKING_MODES)[number];

/** Stored in `tenant_booking_settings.required_fields_json`. */
export const BOOKING_REQUIRED_FIELD_KEYS = [
  'name',
  'phone',
  'service',
  'preferred_date',
  'preferred_time',
  'first_visit',
  'hair_length',
  'colour_preference',
  'notes',
] as const;

export type BookingRequiredFieldKey = (typeof BOOKING_REQUIRED_FIELD_KEYS)[number];

export const MVP_INTENT_KEYS = [
  'booking_interest',
  'colour_interest',
  'scalp_interest',
  'complaint_service_issue',
  'price_question',
  'hot_lead',
] as const;

export type MvpIntentKey = (typeof MVP_INTENT_KEYS)[number];

export const INTENT_TAG_TRIGGER_MODES = ['AUTO', 'OFF'] as const;
export type IntentTagTriggerMode = (typeof INTENT_TAG_TRIGGER_MODES)[number];
