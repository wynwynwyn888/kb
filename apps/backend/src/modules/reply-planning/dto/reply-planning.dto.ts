// Reply planning DTOs — contracts for structured reply planning

/**
 * Status of a reply plan overall.
 */
export type ReplyPlanStatus =
  | 'PLANNED'        // bubbles are ready
  | 'SKIP_NO_REPLY' // no reply warranted (guard skip, etc.)
  | 'HANDOVER'       // handover recommended, no reply planned
  | 'PENDING_LLM'    // waiting for live LLM generation (placeholder until real)
  | 'ERROR';

/**
 * A single formatted bubble draft.
 */
export interface ReplyBubbleDraft {
  index: number;      // 0-based order in the bubble sequence
  text: string;       // formatted bubble content
  typingSeconds?: number; // placeholder: future timing metadata
}

/**
 * A suggested action that a later layer may execute (tag contact, book slot, etc.)
 * The action is NOT executed here — only planned.
 */
export interface SuggestedAction {
  type: 'TAG_CONTACT' | 'BOOK_SLOT' | 'ESCALATE' | 'TRANSFER';
  params: Record<string, unknown>;
  reason: string;
}

/**
 * ReplyDecision — the top-level decision made by the reply planner.
 *
 * Draft provenance (optional, non-HANDOVER plans):
 * - `live_generation` — bubble text came from the provider/model path.
 * - `placeholder_fallback` — deterministic template/KB/memory/generic text; **not** model output.
 * - `policy_reply` — deterministic reply from the conversation policy layer (menu prompt, selection, etc.).
 *
 * When `placeholder_fallback`, `draftFallbackReason` is set when known:
 * `no_agency` | `no_provider` | `generation_failed`.
 */
export interface ReplyDecision {
  planStatus: ReplyPlanStatus;
  responseMode: 'fast' | 'standard' | 'handover';
  handoverRecommended: boolean;
  confidence: number; // 0-1
  rationale: string;
  bubbles: ReplyBubbleDraft[];
  suggestedActions: SuggestedAction[];
  draftProvenance?: 'live_generation' | 'placeholder_fallback' | 'policy_reply';
  draftFallbackReason?: 'no_agency' | 'no_provider' | 'generation_failed';
  /** `agencies.active_ai_provider` when live generation ran (non-HANDOVER). */
  agencyActiveProvider?: string;
  /** HTTP provider that produced live draft text (not the router heuristic). */
  generationProvider?: 'MINIMAX' | 'OPENAI';
  /** Model id sent to that provider for the live draft. */
  generationModel?: string;
  /** True when live text came from OpenAI after primary non-OPENAI failed. */
  usedOpenAiFallback?: boolean;
}

/**
 * FormatterInput — input to the formatter from the reply planner.
 */
export interface FormatterInput {
  replyPlan: ReplyDecision;
  conversationId: string;
  channel: string;
}

/**
 * FormatterOutput — the result of formatting bubbles for sending.
 */
export interface FormatterOutput {
  bubbles: ReplyBubbleDraft[];
  formattingNotes: string[]; // e.g. ["paragraph split at 320 chars", "whitespace normalized"]
  bubbleCount: number;
}

/**
 * Reply planning result attached to orchestration logs.
 */
export interface ReplyPlanSummary {
  status: ReplyPlanStatus;
  bubbleCount: number;
  responseMode: string;
  handoverRecommended: boolean;
  confidence: number;
  rationale: string;
}
