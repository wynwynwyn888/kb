import { z } from 'zod';

export const BOOKING_NLU_INTENTS = [
  'booking_start',
  'provide_field',
  'select_slot',
  'revise_time',
  'revise_date_time',
  /** User asks what dates/times are open (no specific new date yet). */
  'request_availability',
  /** User accepts a single-slot “reserve this time?” offer (yes / yes please). */
  'confirm_offer',
  'ask_question',
  'cancel',
  'unknown',
] as const;

export const BOOKING_NLU_TIME_WINDOWS = [
  'morning',
  'afternoon',
  'evening',
  'lunch',
  'noon',
  'after_work',
  'before_lunch',
] as const;

export const bookingNluSlotSelectionSchema = z.object({
  type: z.enum(['index', 'time', 'none']),
  index: z.number().int().nullable(),
  time: z.string().nullable(),
});

export const bookingNluFieldsSchema = z.object({
  service: z.string().nullable(),
  preferredDate: z.string().nullable(),
  preferredTime: z.string().nullable(),
  preferredTimeWindow: z.enum(BOOKING_NLU_TIME_WINDOWS).nullable(),
  name: z.string().nullable(),
  phone: z.string().nullable(),
  email: z.string().nullable(),
  firstVisit: z.enum(['yes', 'no']).nullable(),
  customAnswers: z.record(z.string()).optional().default({}),
});

export const bookingNluOutputSchema = z.object({
  intent: z.enum(BOOKING_NLU_INTENTS),
  confidence: z.number().min(0).max(1),
  fields: bookingNluFieldsSchema,
  slotSelection: bookingNluSlotSelectionSchema,
  userFrustrated: z.boolean(),
  notes: z.string().nullable(),
});

export type BookingNluOutput = z.infer<typeof bookingNluOutputSchema>;

export type BookingNluInterpretInput = {
  tenantId: string;
  conversationId: string;
  latestInboundText: string;
  transcript: string;
  booking: Record<string, unknown>;
  settingsSummary: {
    bookingMode: string;
    coreRequired: string[];
    customFieldDefs: { id: string; label: string; fieldType: string; required: boolean; options?: string[] }[];
  };
  pendingFieldId: string | null;
  requiredMissing: string[];
  serviceMenuOptions?: string[];
  crmTimezone: string;
  offeredSlots?: { option: number; displayText: string; startIso: string }[];
};
