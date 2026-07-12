/** Automation settings — booking, tagging, follow-up. Shared by API validation and tests. */

export const BOOKING_MODES = [
  'COLLECT_DETAILS_ONLY',
  'CHECK_AVAILABILITY',
  'BOOK_AFTER_CONFIRMATION',
] as const;

export type BookingMode = (typeof BOOKING_MODES)[number];

/** Core keys in `tenant_booking_settings.core_fields_json`. */
export const BOOKING_CORE_FIELD_KEYS = [
  'name',
  'phone',
  'email',
  'service',
  'preferred_date',
  'preferred_time',
  'first_visit',
] as const;

export type BookingCoreFieldKey = (typeof BOOKING_CORE_FIELD_KEYS)[number];

export const TAG_MATCH_MODES = ['AI', 'KEYWORD', 'HYBRID'] as const;
export type TagMatchMode = (typeof TAG_MATCH_MODES)[number];

export const CONFIDENCE_THRESHOLDS = ['LOW', 'NORMAL', 'HIGH'] as const;
export type ConfidenceThreshold = (typeof CONFIDENCE_THRESHOLDS)[number];

export const CUSTOM_FIELD_TYPES = [
  'short_text',
  'long_text',
  'yes_no',
  'checkbox',
  'single_choice',
  'single_select',
  'date',
  'time',
] as const;

export type CustomFieldType = (typeof CUSTOM_FIELD_TYPES)[number];

export const FOLLOW_UP_DELAY_UNITS = ['minutes', 'hours', 'days'] as const;
export type FollowUpDelayUnit = (typeof FOLLOW_UP_DELAY_UNITS)[number];

/** Canonical API values (do not invent new ones). */
export const FOLLOW_UP_STEP_MODES = ['fixed_message', 'ai_decides'] as const;
export type FollowUpStepMode = (typeof FOLLOW_UP_STEP_MODES)[number];

export const DEFAULT_FOLLOW_UP_AI_INSTRUCTION =
  'Gentle nudge only. Do not sound salesy. Follow up based on the previous conversation context.';

export const FOLLOW_UP_ACTIVE_HOURS_TIMEZONE_MODES = ['BUSINESS', 'CONTACT'] as const;
export type FollowUpActiveHoursTimezoneMode = (typeof FOLLOW_UP_ACTIVE_HOURS_TIMEZONE_MODES)[number];

export const ACTIVE_HOURS_DAY_KEYS = ['mon', 'tue', 'wed', 'thu', 'fri', 'sat', 'sun'] as const;
export type ActiveHoursDayKey = (typeof ACTIVE_HOURS_DAY_KEYS)[number];
