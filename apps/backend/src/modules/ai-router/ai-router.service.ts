// AI Router service - placeholder routing with simple heuristics.
// When an agency-level OpenAI provider is configured, also generates live draft replies.

import { Injectable, Logger } from '@nestjs/common';
import { getSupabaseService } from '../../lib/supabase';
import { OpenAiProviderAdapter } from '@aisbp/ai-provider-openai';
import type {
  RoutingRequest,
  RoutingResponse,
  ResponseMode,
} from '../orchestration/dto';

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
  private readonly supabase = getSupabaseService();

  /**
   * Route a request using simple heuristics.
   * When an agency-level OpenAI provider is configured and generation is possible,
   * also produces a real draft reply via the LLM.
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

    const tagsSuggested: string[] = [];

    // Try live generation if not handover and provider is configured
    let draftReply: string | null = null;
    if (responseMode !== 'handover') {
      draftReply = await this.tryGenerateLiveReply(request, recommendedModel);
    }

    this.logger.log(
      `Routing: model=${recommendedModel}, mode=${responseMode}, ` +
      `confidence=${confidence}, liveDraft=${draftReply !== null}, reasoning=${reasoning}`,
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

  /**
   * Attempt live generation via agency-configured OpenAI provider.
   * Returns null on any failure — caller should use fallback.
   */
  private async tryGenerateLiveReply(
    request: RoutingRequest,
    model: string,
  ): Promise<string | null> {
    try {
      const agencyId = await this.getAgencyId(request.tenantId);
      if (!agencyId) return null;

      const providerConfig = await this.loadAgencyProvider(agencyId);
      if (!providerConfig) return null;

      const adapter = new OpenAiProviderAdapter();
      adapter.initialize({
        apiKey: providerConfig.apiKey,
        endpoint: providerConfig.endpoint,
        defaultModel: providerConfig.settings.defaultModel,
        maxTokens: providerConfig.settings.maxTokens,
        temperature: providerConfig.settings.temperature,
      });

      const messages = this.buildMessages(request);
      const result = await adapter.generate({
        model,
        messages,
        temperature: providerConfig.settings.temperature ?? 0.7,
        maxTokens: providerConfig.settings.maxTokens ?? 500,
      });

      this.logger.log(
        `Live generation success: model=${result.model}, ` +
        `tokens=${result.usage.totalTokens}, provider=${result.provider}`,
      );

      return result.content;
    } catch (error) {
      const message = error instanceof Error ? error.message : 'unknown';
      this.logger.warn(`Live generation failed, using fallback: ${message}`);
      return null;
    }
  }

  private buildMessages(
    request: RoutingRequest,
  ): Array<{ role: 'system' | 'user' | 'assistant'; content: string }> {
    const messages: Array<{ role: 'system' | 'user' | 'assistant'; content: string }> = [];

    if (request.systemPrompt) {
      messages.push({ role: 'system', content: request.systemPrompt });
    }

    for (const entry of request.memory.slice(-10)) {
      messages.push({
        role: entry.role === 'user' ? 'user' : 'assistant',
        content: entry.content,
      });
    }

    if (request.kbContext.length > 0) {
      const kbText = request.kbContext
        .map((c, i) => `[${i + 1}] ${c.content}`)
        .join('\n\n');
      messages.push({
        role: 'system',
        content: `Relevant knowledge base context:\n${kbText}`,
      });
    }

    messages.push({ role: 'user', content: request.incomingMessage });

    return messages;
  }

  private async getAgencyId(tenantId: string): Promise<string | null> {
    const { data } = await this.supabase
      .from('tenants')
      .select('agency_id')
      .eq('id', tenantId)
      .single();
    return data?.agency_id ?? null;
  }

  private async loadAgencyProvider(agencyId: string): Promise<{
    apiKey: string;
    endpoint?: string;
    settings: { defaultModel: string; maxTokens?: number; temperature?: number };
  } | null> {
    const { data } = await this.supabase
      .from('agency_model_providers')
      .select('api_key, endpoint, settings')
      .eq('agency_id', agencyId)
      .eq('provider', 'OPENAI')
      .single();

    if (!data) return null;

    return {
      apiKey: data.api_key,
      endpoint: data.endpoint ?? undefined,
      settings: data.settings as { defaultModel: string; maxTokens?: number; temperature?: number },
    };
  }
}
