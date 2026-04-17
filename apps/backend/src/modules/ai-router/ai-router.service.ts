// AI Router service - placeholder routing with simple heuristics
// Routes to simple vs complex model based on message characteristics.
// Real LLM calls, KB retrieval, and cost-aware routing are TODO.

import { Injectable, Logger } from '@nestjs/common';
import type {
  RoutingRequest,
  RoutingResponse,
  ResponseMode,
} from '../orchestration/dto';

const SIMPLE_ROUTE = 'gpt-4o-mini';
const COMPLEX_ROUTE = 'gpt-4o';

// Keyword hints that suggest complex routing (booking, multi-part questions, etc.)
const COMPLEX_KEYWORDS = [
  'book',
  'schedule',
  'appointment',
  'reservation',
  'cancel',
  'refund',
  'change',
  'modify',
  'pricing',
  'cost',
  'discount',
  'deal',
  'special',
  'availability',
  'when',
  'how long',
  'multiple',
  '?',
];

@Injectable()
export class AiRouterService {
  private readonly logger = new Logger(AiRouterService.name);

  /**
   * Route a request using simple heuristics (message length, keywords, turn count).
   * This is a placeholder — real routing will use LLM-based classification,
   * KB availability, tenant config, cost optimization.
   */
  async route(request: RoutingRequest): Promise<RoutingResponse> {
    const { incomingMessage, memory, handoverRecommended, bookingIntentDetected, estimatedInputTokens } = request;

    const messageLength = incomingMessage.trim().length;
    const userTurnCount = memory.filter(m => m.role === 'user').length;
    const hasComplexKeywords = COMPLEX_KEYWORDS.some(k =>
      incomingMessage.toLowerCase().includes(k),
    );

    // Determine response mode and model
    let responseMode: ResponseMode = 'standard';
    let recommendedModel = SIMPLE_ROUTE;
    let confidence = 0.7;
    let reasoning = 'simple heuristic route';

    // Handover override
    if (handoverRecommended) {
      responseMode = 'handover';
      recommendedModel = COMPLEX_ROUTE;
      confidence = 0.9;
      reasoning = 'handover recommended — escalated to complex route';
    }
    // Booking intent detected
    else if (bookingIntentDetected) {
      responseMode = 'standard';
      recommendedModel = COMPLEX_ROUTE;
      confidence = 0.85;
      reasoning = 'booking intent detected — complex route';
    }
    // Long or multi-turn conversation → complex
    else if (messageLength > 300 || userTurnCount > 3) {
      responseMode = 'standard';
      recommendedModel = COMPLEX_ROUTE;
      confidence = 0.75;
      reasoning = `message length=${messageLength} or turn count=${userTurnCount} exceeds threshold`;
    }
    // Keyword hints → complex
    else if (hasComplexKeywords) {
      responseMode = 'standard';
      recommendedModel = COMPLEX_ROUTE;
      confidence = 0.8;
      reasoning = 'complex keyword detected in message';
    }
    // Fast path for short simple messages
    else if (messageLength < 50) {
      responseMode = 'fast';
      recommendedModel = SIMPLE_ROUTE;
      confidence = 0.9;
      reasoning = 'short simple message — fast route';
    }

    // TODO: Real LLM call to generate draft reply
    // For now, produce a placeholder structured response
    const draftReply = responseMode === 'handover' ? null : 'AI reply placeholder (TODO: real generation)';

    // TODO: Detect tags from message content
    const tagsSuggested: string[] = [];

    this.logger.debug(
      `Routing: model=${recommendedModel}, mode=${responseMode}, confidence=${confidence}, reasoning=${reasoning}`,
    );

    return {
      recommendedModel,
      responseMode,
      draftReply,
      handoverRecommended,
      bookingIntentDetected,
      tagsSuggested,
      confidence,
      reasoning,
    };
  }
}
