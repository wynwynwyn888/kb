// AI Router service — decides which model to use and response mode.
// Does NOT perform generation — that belongs to the reply planner.

import { Injectable, Logger } from '@nestjs/common';
import type {
  RoutingRequest,
  RoutingResponse,
  ResponseMode,
} from '../orchestration/dto';
import { extractSlotFromKb } from './kb-slot-extract';

export { extractSlotFromKb } from './kb-slot-extract';

const SIMPLE_ROUTE = 'gpt-4o-mini';
const COMPLEX_ROUTE = 'gpt-4o';

const COMPLEX_KEYWORDS = [
  'book', 'schedule', 'appointment', 'reservation',
  'cancel', 'refund', 'change', 'modify',
  'pricing', 'cost', 'discount', 'deal', 'special',
  'availability', 'when', 'how long', 'multiple', '?',
];

@Injectable()
export class AiRouterService {
  private readonly logger = new Logger(AiRouterService.name);

  /**
   * Decide model and response mode using simple heuristics.
   * Generation is owned by ReplyPlannerService via GenerationService.
   */
  async route(request: RoutingRequest): Promise<RoutingResponse> {
    const { incomingMessage, memory, handoverRecommended, bookingIntentDetected } = request;

    const messageLength = incomingMessage.trim().length;
    const userTurnCount = memory.filter(m => m.role === 'user').length;
    const hasComplexKeywords = COMPLEX_KEYWORDS.some(k =>
      incomingMessage.toLowerCase().includes(k),
    );

    let responseMode: ResponseMode = 'standard';
    let recommendedModel = SIMPLE_ROUTE;
    let confidence = 0.7;
    let reasoning = 'simple heuristic route';

    if (handoverRecommended) {
      responseMode = 'handover';
      recommendedModel = COMPLEX_ROUTE;
      confidence = 0.9;
      reasoning = 'handover recommended — escalated to complex route';
    } else if (bookingIntentDetected) {
      responseMode = 'standard';
      recommendedModel = COMPLEX_ROUTE;
      confidence = 0.85;
      reasoning = 'booking intent detected — complex route';
    } else if (messageLength > 300 || userTurnCount > 3) {
      responseMode = 'standard';
      recommendedModel = COMPLEX_ROUTE;
      confidence = 0.75;
      reasoning = `message length=${messageLength} or turn count=${userTurnCount} exceeds threshold`;
    } else if (hasComplexKeywords) {
      responseMode = 'standard';
      recommendedModel = COMPLEX_ROUTE;
      confidence = 0.8;
      reasoning = 'complex keyword detected in message';
    } else if (messageLength < 50) {
      responseMode = 'fast';
      recommendedModel = SIMPLE_ROUTE;
      confidence = 0.9;
      reasoning = 'short simple message — fast route';
    }

    const tenantOverride = request.tenantModelOverride?.trim();
    if (tenantOverride) {
      recommendedModel = tenantOverride;
      reasoning = `tenant model override from prompt config (${reasoning})`;
    }

    const tagsSuggested: string[] = [];

    const extractedSlot =
      bookingIntentDetected &&
      Array.isArray(request.kbContext) &&
      request.kbContext.length > 0
        ? extractSlotFromKb(
            request.kbContext.map((c) => ({
              content: c.content,
              metadata: c.metadata,
            })),
          )
        : undefined;

    this.logger.log(
      `Routing: routingRecommendedModel=${recommendedModel}, mode=${responseMode}, ` +
        `confidence=${confidence}, reasoning=${reasoning}`,
    );

    return {
      recommendedModel,
      responseMode,
      draftReply: null,   // generation belongs to reply planner
      handoverRecommended,
      bookingIntentDetected,
      tagsSuggested,
      confidence,
      reasoning,
      ...(extractedSlot ? { extractedSlot } : {}),
    };
  }
}
