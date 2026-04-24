// Generation Service — live LLM generation for reply planning.
// Respects agency `active_ai_provider` with OpenAI fallback when active provider is missing or fails.

import { Injectable, Logger } from '@nestjs/common';
import { getSupabaseService } from '../../lib/supabase';
import { OpenAiProviderAdapter } from '@aisbp/ai-provider-openai';
import { minimaxChatCompletion } from './minimax.generate';
import type { MemoryEntry } from '../orchestration/dto';
import type { RetrievalChunk } from '../kb/dto/retrieval.dto';

export interface GenerateDraftParams {
  tenantId: string;
  incomingMessage: string;
  systemPrompt: string;
  memory: MemoryEntry[];
  kbContext: RetrievalChunk[];
  model: string;
  /** Subaccount prompt config — when set, overrides agency provider row temperature / max tokens. */
  temperature?: number;
  maxTokens?: number;
}

export interface GenerateDraftResult {
  content: string | null;
  skipReason?: 'no_agency' | 'no_provider' | 'generation_failed';
  /** When MiniMax (or other primary) failed but OpenAI returned text. */
  usedFallbackProvider?: 'OPENAI';
}

type ProviderRow = {
  provider: string;
  api_key: string;
  endpoint: string | null;
  settings: Record<string, unknown>;
};

@Injectable()
export class GenerationService {
  private readonly logger = new Logger(GenerationService.name);
  private readonly supabase = getSupabaseService();

  async generateDraft(params: GenerateDraftParams): Promise<GenerateDraftResult> {
    try {
      const agencyId = await this.getAgencyId(params.tenantId);
      if (!agencyId) {
        this.logger.debug('No agencyId for tenant — skipping live generation');
        return { content: null, skipReason: 'no_agency' };
      }

      const active = await this.getActiveProviderName(agencyId);
      const primary = await this.loadProviderRow(agencyId, active);
      const openaiFallback = await this.loadProviderRow(agencyId, 'OPENAI');

      if (!primary?.api_key && !openaiFallback?.api_key) {
        this.logger.debug('No API keys for active or OpenAI — skipping');
        return { content: null, skipReason: 'no_provider' };
      }

      const tryPrimary = primary && primary.api_key;
      if (tryPrimary) {
        const r = await this.runProvider(params, primary, active);
        if (r.content && r.content.length > 0) {
          return r.usedFallback
            ? { content: r.content, usedFallbackProvider: 'OPENAI' }
            : { content: r.content };
        }
        if (active !== 'OPENAI' && openaiFallback?.api_key) {
          this.logger.warn(`Primary provider ${active} failed or empty; trying OpenAI fallback`);
          const r2 = await this.runProvider(params, openaiFallback, 'OPENAI');
          if (r2.content && r2.content.length > 0) {
            return { content: r2.content, usedFallbackProvider: 'OPENAI' };
          }
        }
        return { content: null, skipReason: 'generation_failed' };
      }

      // No primary key — use OpenAI only
      if (openaiFallback?.api_key) {
        const r2 = await this.runProvider(params, openaiFallback, 'OPENAI');
        if (r2.content && r2.content.length > 0) {
          return { content: r2.content, usedFallbackProvider: 'OPENAI' };
        }
      }
      return { content: null, skipReason: 'no_provider' };
    } catch (error) {
      const message = error instanceof Error ? error.message : 'unknown';
      this.logger.warn(`Live generation failed: ${message}`);
      return { content: null, skipReason: 'generation_failed' };
    }
  }

  private async runProvider(
    params: GenerateDraftParams,
    row: ProviderRow,
    providerName: string,
  ): Promise<{ content: string | null; usedFallback: boolean }> {
    if (providerName !== 'MINIMAX' && providerName !== 'OPENAI') {
      this.logger.debug(`No live adapter for provider ${providerName}; skipping primary call`);
      return { content: null, usedFallback: false };
    }

    const settings = row.settings ?? {};
    const defModel = (settings['defaultModel'] as string) ?? 'gpt-4o-mini';
    const agTemp = (settings['temperature'] as number) ?? 0.7;
    const agMax = (settings['maxTokens'] as number) ?? 500;
    const temp =
      params.temperature != null && Number.isFinite(params.temperature) ? params.temperature! : agTemp;
    const maxT =
      params.maxTokens != null && Number.isFinite(params.maxTokens) ? Math.floor(params.maxTokens) : agMax;
    const model = params.model?.trim() || defModel;
    const messages = this.buildMessages(params);
    const groupId = (settings['minimaxGroupId'] as string | undefined)?.trim() || undefined;

    if (providerName === 'MINIMAX') {
      try {
        const mmMsg = messages.map(m => ({
          role: m.role,
          content: m.content,
        })) as Parameters<typeof minimaxChatCompletion>[0]['messages'];
        const out = await minimaxChatCompletion({
          apiKey: row.api_key,
          baseUrl: row.endpoint ?? undefined,
          groupId,
          model,
          messages: mmMsg,
          temperature: temp,
          maxTokens: maxT,
        });
        this.logger.log(`MiniMax ok: model=${out.model} tokens~=${out.totalTokens}`);
        return { content: out.content || null, usedFallback: false };
      } catch (e) {
        this.logger.warn(`MiniMax error: ${e instanceof Error ? e.message : e}`);
        return { content: null, usedFallback: false };
      }
    }

    const adapter = new OpenAiProviderAdapter();
    adapter.initialize({
      apiKey: row.api_key,
      endpoint: row.endpoint ?? undefined,
      defaultModel: defModel,
      maxTokens: maxT,
      temperature: temp,
    });
    const result = await adapter.generate({
      model,
      messages,
      temperature: temp,
      maxTokens: maxT,
    });
    this.logger.log(`OpenAI ok: model=${result.model} tokens=${result.usage.totalTokens}`);
    return { content: result.content || null, usedFallback: false };
  }

  private buildMessages(
    params: GenerateDraftParams,
  ): Array<{ role: 'system' | 'user' | 'assistant'; content: string }> {
    const messages: Array<{ role: 'system' | 'user' | 'assistant'; content: string }> = [];

    if (params.systemPrompt) {
      messages.push({ role: 'system', content: params.systemPrompt });
    }

    const mem = params.memory.slice(-10);
    const incoming = params.incomingMessage?.trim() ?? '';
    let memForHistory = mem;
    if (incoming) {
      const last = mem[mem.length - 1];
      if (last && last.role === 'user' && last.content === incoming) {
        memForHistory = mem.slice(0, -1);
      }
    }
    for (const entry of memForHistory) {
      messages.push({
        role: entry.role === 'user' ? 'user' : 'assistant',
        content: entry.content,
      });
    }

    if (params.kbContext.length > 0) {
      const kbText = params.kbContext.map((c, i) => `[${i + 1}] ${c.content}`).join('\n\n');
      messages.push({
        role: 'system',
        content: `Relevant knowledge base context:\n${kbText}`,
      });
    }

    messages.push({ role: 'user', content: params.incomingMessage });
    return messages;
  }

  private async getAgencyId(tenantId: string): Promise<string | null> {
    const { data } = await this.supabase.from('tenants').select('agency_id').eq('id', tenantId).single();
    return data?.agency_id ?? null;
  }

  private async getActiveProviderName(agencyId: string): Promise<string> {
    const { data } = await this.supabase.from('agencies').select('active_ai_provider').eq('id', agencyId).single();
    const a = (data as { active_ai_provider?: string } | null)?.active_ai_provider;
    return a && String(a).trim() ? String(a) : 'OPENAI';
  }

  private async loadProviderRow(agencyId: string, provider: string): Promise<ProviderRow | null> {
    const { data, error } = await this.supabase
      .from('agency_model_providers')
      .select('provider, api_key, endpoint, settings')
      .eq('agency_id', agencyId)
      .eq('provider', provider)
      .maybeSingle();
    if (error || !data) return null;
    return {
      provider: data.provider,
      api_key: data.api_key,
      endpoint: data.endpoint,
      settings: (data.settings as Record<string, unknown>) ?? {},
    };
  }
}
