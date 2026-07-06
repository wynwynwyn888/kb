// Shared max character limits for tenant bot profile prompt fields.
// Single source of truth consumed by both backend validation and frontend
// validation/helper text so limits never drift between layers.

export const PROMPT_FIELD_LIMITS = {
  criticalFacts: 2500,
  persona: 3000,
  conversationGoals: 5000,
  businessNotes: 5000,
  bookingBehavior: 2000,
  escalationBehavior: 2000,
} as const;

export type PromptFieldLimitKey = keyof typeof PROMPT_FIELD_LIMITS;
