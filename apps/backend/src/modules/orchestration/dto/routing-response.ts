// AI routing response — structured output from the AI router
// Not raw freeform text — contains routing metadata and structured reply plan.

export type ResponseMode = 'fast' | 'standard' | 'handover';

/** Slot hint parsed from KB when booking intent is detected (BOOK_SLOT / planner hints). */
export interface RoutingExtractedKbSlot {
  startTime: string;
  endTime: string;
  calendarId: string;
  source: 'KB';
  timezone?: string;
}

export interface RoutingResponse {
  recommendedModel: string;
  responseMode: ResponseMode;
  draftReply: string | null; // null if handover recommended
  handoverRecommended: boolean;
  bookingIntentDetected: boolean;
  tagsSuggested: string[];
  confidence: number; // 0-1
  reasoning: string;
  /** Present when booking intent + KB chunks contain a parseable slot range/date */
  extractedSlot?: RoutingExtractedKbSlot;
}
