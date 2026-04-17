// Generation Service — owns live LLM generation for reply planning.
// Loads agency provider config, builds messages, calls the provider adapter.

import { Injectable, Logger } from '@nestjs/common';
import { getSupabaseService } from '../../lib/supabase';
import { OpenAiProviderAdapter } from '@aisbp/ai-provider-openai';
import type { MemoryEntry } from '../orchestration/dto';
import type { RetrievalChunk } from '../kb/dto/retrieval.dto';

export interface GenerateDraftParams {
  tenantId: string;
  incomingMessage: string;
  systemPrompt: string;
  memory: MemoryEntry[];
  kbContext: RetrievalChunk[];
  model: string;
}

@Injectable()
export class GenerationService {
  private readonly logger = new Logger(GenerationService.name);
  private readonly supabase = getSupabaseService();

  /**
   * Attempt live draft generation via the agency-configured OpenAI provider.
   * Returns null if no provider is configured or the call fails.
   */
  async generateDraft(params: GenerateDraftParams): Promise<string | null> {
    try {
      const agencyId = await this.getAgencyId(params.tenantId);
      if (!agencyId) {
        this.logger.debug('No agencyId for tenant — skipping live generation');
        return null;
      }

      const providerConfig = await this.loadAgencyProvider(agencyId);
      if (!providerConfig) {
        this.logger.debug('No agency provider configured — skipping live generation');
        return null;
      }

      const adapter = new OpenAiProviderAdapter();
      adapter.initialize({
        apiKey: providerConfig.apiKey,
        endpoint: providerConfig.endpoint,
        defaultModel: providerConfig.settings.defaultModel,
        maxTokens: providerConfig.settings.maxTokens,
        temperature: providerConfig.settings.temperature,
      });

      const messages = this.buildMessages(params);
      const result = await adapter.generate({
        model: params.model,
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
    params: GenerateDraftParams,
  ): Array<{ role: 'system' | 'user' | 'assistant'; content: string }> {
    const messages: Array<{ role: 'system' | 'user' | 'assistant'; content: string }> = [];

    if (params.systemPrompt) {
      messages.push({ role: 'system', content: params.systemPrompt });
    }

    for (const entry of params.memory.slice(-10)) {
      messages.push({
        role: entry.role === 'user' ? 'user' : 'assistant',
        content: entry.content,
      });
    }

    if (params.kbContext.length > 0) {
      const kbText = params.kbContext
        .map((c, i) => `[${i + 1}] ${c.content}`)
        .join('\n\n');
      messages.push({
        role: 'system',
        content: `Relevant knowledge base context:\n${kbText}`,
      });
    }

    messages.push({ role: 'user', content: params.incomingMessage });

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
