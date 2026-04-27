// Generation Service — live LLM generation for reply planning.
// Respects agency `active_ai_provider` with OpenAI fallback when active provider is missing or fails.

import { Injectable, Logger } from '@nestjs/common';
import { stripCustomerFacingMeta, stripModelThinking } from '@aisbp/formatter';
import { summarizeAxiosErrorForLogs } from '../../lib/safe-http-error';
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
  /** `agencies.active_ai_provider` at call time (when resolved). */
  agencyActiveProvider?: string;
  /** Provider whose HTTP API produced `content` (live path only). */
  generationProvider?: 'MINIMAX' | 'OPENAI';
  /** Model id sent to that provider (not the router heuristic id). */
  generationModel?: string;
  /** True when `content` came from OpenAI after a non-OPENAI primary failed. */
  usedOpenAiFallback?: boolean;
}

type ProviderRow = {
  provider: string;
  api_key: string;
  endpoint: string | null;
  settings: Record<string, unknown>;
};

const DEFAULT_MINIMAX_MODEL = 'MiniMax-M2.7';
const DEFAULT_OPENAI_MODEL = 'gpt-4o-mini';

@Injectable()
export class GenerationService {
  private readonly logger = new Logger(GenerationService.name);
  private readonly supabase = getSupabaseService();

  /** OpenAI fallback only when a real-looking API key is configured (no demo/placeholder keys). */
  private isUsableOpenAiFallbackKey(apiKey: string | null | undefined): boolean {
    const k = (apiKey ?? '').trim();
    if (!k) return false;
    const lower = k.toLowerCase();
    if (lower.startsWith('demo-key')) return false;
    if (lower.startsWith('sk-test')) return false;
    if (/^sk-(demo|test|placeholder|xxxx)/i.test(k)) return false;
    if (lower === 'placeholder' || lower === 'replace-me' || lower === 'your-api-key-here') return false;
    return true;
  }

  /** Routing / planner may recommend an OpenAI model id; never send that string to MiniMax. */
  private isLikelyOpenAiModelId(name: string): boolean {
    const n = name.trim();
    if (!n) return false;
    if (/^gpt-/i.test(n)) return true;
    if (/^o[0-9]/i.test(n)) return true;
    if (/^chatgpt-/i.test(n)) return true;
    if (/^text-davinci|^davinci|^curie|^babbage|^ada\b/i.test(n)) return true;
    return false;
  }

  /** Avoid sending MiniMax model names to the OpenAI adapter. */
  private isLikelyMinimaxModelId(name: string): boolean {
    return /^minimax-/i.test(name.trim());
  }

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
      const openaiFallbackOk = this.isUsableOpenAiFallbackKey(openaiFallback?.api_key);

      if (!primary?.api_key && !openaiFallbackOk) {
        this.logger.debug('No API keys for active or OpenAI — skipping');
        return { content: null, skipReason: 'no_provider', agencyActiveProvider: active };
      }

      const tryPrimary = primary && primary.api_key;
      if (tryPrimary) {
        const r = await this.runProvider(params, primary, active);
        const cleaned = this.sanitizeCustomerFacing(r.content);
        if (cleaned && r.generationProvider && r.generationModel) {
          return {
            content: cleaned,
            agencyActiveProvider: active,
            generationProvider: r.generationProvider,
            generationModel: r.generationModel,
            usedOpenAiFallback: false,
          };
        }
        if (active !== 'OPENAI' && openaiFallbackOk && openaiFallback) {
          this.logger.warn(`Primary provider ${active} failed or empty; trying OpenAI fallback`);
          const r2 = await this.runProvider(params, openaiFallback, 'OPENAI');
          const cleaned2 = this.sanitizeCustomerFacing(r2.content);
          if (cleaned2 && r2.generationProvider && r2.generationModel) {
            return {
              content: cleaned2,
              usedFallbackProvider: 'OPENAI',
              agencyActiveProvider: active,
              generationProvider: r2.generationProvider,
              generationModel: r2.generationModel,
              usedOpenAiFallback: true,
            };
          }
        } else if (active !== 'OPENAI' && openaiFallback?.api_key && !openaiFallbackOk) {
          this.logger.warn(
            `Primary provider ${active} failed; OpenAI fallback skipped (no usable OpenAI API key configured)`,
          );
        }
        return { content: null, skipReason: 'generation_failed', agencyActiveProvider: active };
      }

      // No primary key — use OpenAI only
      if (openaiFallbackOk && openaiFallback) {
        const r2 = await this.runProvider(params, openaiFallback, 'OPENAI');
        const cleaned2 = this.sanitizeCustomerFacing(r2.content);
        if (cleaned2 && r2.generationProvider && r2.generationModel) {
          return {
            content: cleaned2,
            usedFallbackProvider: 'OPENAI',
            agencyActiveProvider: active,
            generationProvider: r2.generationProvider,
            generationModel: r2.generationModel,
            usedOpenAiFallback: false,
          };
        }
      }
      return { content: null, skipReason: 'no_provider', agencyActiveProvider: active };
    } catch (error) {
      const message = error instanceof Error ? error.message : 'unknown';
      this.logger.warn(`Live generation failed: ${message}`);
      return { content: null, skipReason: 'generation_failed' };
    }
  }

  /** Strip internal reasoning; empty after strip is treated as no content. */
  private sanitizeCustomerFacing(content: string | null): string | null {
    if (content == null) return null;
    const t = stripCustomerFacingMeta(stripModelThinking(content)).trim();
    return t.length > 0 ? t : null;
  }

  private async runProvider(
    params: GenerateDraftParams,
    row: ProviderRow,
    providerName: string,
  ): Promise<{
    content: string | null;
    generationProvider?: 'MINIMAX' | 'OPENAI';
    generationModel?: string;
  }> {
    if (providerName !== 'MINIMAX' && providerName !== 'OPENAI') {
      this.logger.debug(`No live adapter for provider ${providerName}; skipping primary call`);
      return { content: null };
    }

    const settings = row.settings ?? {};
    const settingsModel = (settings['defaultModel'] as string | undefined)?.trim();
    const defModel =
      providerName === 'MINIMAX'
        ? settingsModel || DEFAULT_MINIMAX_MODEL
        : settingsModel || DEFAULT_OPENAI_MODEL;
    const agTemp = (settings['temperature'] as number) ?? 0.7;
    const agMax = (settings['maxTokens'] as number) ?? 500;
    const temp =
      params.temperature != null && Number.isFinite(params.temperature) ? params.temperature! : agTemp;
    const maxT =
      params.maxTokens != null && Number.isFinite(params.maxTokens) ? Math.floor(params.maxTokens) : agMax;
    const requested = params.model?.trim() ?? '';
    let model = requested || defModel;
    if (providerName === 'MINIMAX') {
      if (!requested || this.isLikelyOpenAiModelId(requested) || this.isLikelyOpenAiModelId(model)) {
        model = defModel;
      }
      if (this.isLikelyOpenAiModelId(model)) {
        model = DEFAULT_MINIMAX_MODEL;
      }
    } else if (providerName === 'OPENAI') {
      if (requested && this.isLikelyMinimaxModelId(requested)) {
        model = defModel;
      } else if (this.isLikelyMinimaxModelId(model)) {
        model = DEFAULT_OPENAI_MODEL;
      }
    }
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
        this.logger.log(
          `Live generation ok: provider=MINIMAX generationModel=${out.model} tokens~=${out.totalTokens}`,
        );
        return {
          content: out.content || null,
          generationProvider: 'MINIMAX',
          generationModel: (out.model && String(out.model).trim()) || model,
        };
      } catch (e) {
        this.logger.warn(
          `MiniMax error: ${e instanceof Error ? e.message : e} — ` +
            `check Agency AI: MiniMax default model, API base (must be https://api.minimax.io/v1), ` +
            `and minimaxGroupId if your account requires it.`,
        );
        return { content: null, generationProvider: 'MINIMAX', generationModel: model };
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
    try {
      const result = await adapter.generate({
        model,
        messages,
        temperature: temp,
        maxTokens: maxT,
      });
      this.logger.log(
        `Live generation ok: provider=OPENAI generationModel=${result.model} tokens=${result.usage.totalTokens}`,
      );
      return {
        content: result.content || null,
        generationProvider: 'OPENAI',
        generationModel: result.model?.trim() || model,
      };
    } catch (e) {
      const detail = summarizeAxiosErrorForLogs(e, 'OpenAI chat/completions');
      this.logger.warn(
        `${detail} — verify OPENAI provider API key and endpoint in Agency Settings → AI; ` +
          `401 usually means missing/invalid/revoked key.`,
      );
      return { content: null, generationProvider: 'OPENAI', generationModel: model };
    }
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
        content:
          entry.role === 'assistant' ? stripModelThinking(entry.content ?? '') : (entry.content ?? ''),
      });
    }

    if (params.kbContext.length > 0) {
      const kbText = params.kbContext
        .map((c, i) => {
          const label =
            c.title?.trim() || c.source?.trim()
              ? ` (topic: ${(c.title ?? c.source ?? '').trim()})`
              : '';
          return `[${i + 1}]${label}\n${c.content}`;
        })
        .join('\n\n');
      messages.push({
        role: 'system',
        content:
          'Relevant knowledge base context (trusted facts — do not invent details not present here):\n' +
          `${kbText}\n\n` +
          'Reply guidelines: Write one or two short natural sentences for the customer. ' +
          'If the context lists structured facts (for example opening hours on separate lines), ' +
          'rephrase them into fluent prose without changing times or days. ' +
          'Do not paste raw bullet lists unless the customer explicitly asked for a list. ' +
          'Do not add offers, prices, policies, or availability that are not in the context.',
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
