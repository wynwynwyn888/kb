export type BookingReplyComposerStepType =
  | 'ask_service'
  | 'ask_date'
  | 'ask_time'
  | 'ask_name'
  | 'ask_phone'
  | 'ask_email'
  | 'ask_custom_field'
  | 'ask_first_visit'
  | 'offer_slots'
  | 'no_slots'
  | 'confirm_slot'
  | 'booking_confirmed'
  | 'clarify_unknown';

/** Mirrors the deterministic “next action” — composer may only rephrase `safeBaseMessage`. */
export type BookingReplyComposerNextStep = {
  type: BookingReplyComposerStepType;
  fieldId?: string;
  safeBaseMessage: string;
  serviceOptions?: string[];
  customFieldOptions?: string[];
  offeredSlots?: Array<{ option: number; label: string }>;
};

export type BookingReplyComposerComposeInput = {
  tenantId: string;
  conversationId: string;
  latestInboundText: string;
  recentTranscript: string;
  currentBookingState: Record<string, unknown>;
  nextStep: BookingReplyComposerNextStep;
  businessName?: string;
  personaPrompt?: string;
  userFrustrated?: boolean;
};
