// AI routing response — structured output from the AI router
// Not raw freeform text — contains routing metadata and structured reply plan.

export type ResponseMode = 'fast' | 'standard' | 'handover';

export interface RoutingResponse {
  recommendedModel: string;
  responseMode: ResponseMode;
  draftReply: string | null; // null if handover recommended
  handoverRecommended: boolean;
  bookingIntentDetected: boolean;
  tagsSuggested: string[];
  confidence: number; // 0-1
  reasoning: string;
}
