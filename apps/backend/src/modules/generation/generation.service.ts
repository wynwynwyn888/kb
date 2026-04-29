// Generation Service — live LLM generation for reply planning.
// Respects agency `active_ai_provider` with OpenAI fallback when active provider is missing or fails.

import { Injectable, Logger } from '@nestjs/common';
import { stripCustomerFacingMeta, stripModelThinking } from '@aisbp/formatter';
import { summarizeAxiosErrorForLogs } from '../../lib/safe-http-error';
import { getSupabaseService } from '../../lib/supabase';
import { OpenAiProviderAdapter } from '@aisbp/ai-provider-openai';
import { normalizeModelForLiveProvider } from '@aisbp/types';
import { isUsableOpenAiFallbackKey, resolveGenerationModel } from '../../lib/ai-live-model-resolve';
import { minimaxChatCompletion } from './minimax.generate';
import type { MemoryEntry } from '../orchestration/dto';
import type { RetrievalChunk } from '../kb/dto/retrieval.dto';
import type { ConversationIntent } from '../conversation-policy/conversation-intent';
import type { SelectionResolution } from '../conversation-policy/option-resolver';

export interface GenerateDraftPolicyContext {
  latestIntent: ConversationIntent;
  resolvedSelection: SelectionResolution | null;
  conversationStateSummary: string;
  menuSelectionActive?: boolean;
  /** Live debounce: >1 when multiple customer lines were combined into one user turn. */
  combinedInboundMessageCount?: number;
  /** Live: customer repeated the same text across separate messages (not provider dedupe). */
  repeatedCustomerMessageHandling?: 'none' | 'concise_repeat' | 'confirm_echo';
}

export interface GenerateDraftParams {
  tenantId: string;
  incomingMessage: string;
  systemPrompt: string;
  memory: MemoryEntry[];
  kbContext: RetrievalChunk[];
  /**
   * Live debounced batch: when >1, `buildMessages` drops that many trailing user rows from replayed
   * memory so the combined user line is not duplicated after individual inbound rows were persisted.
   */
  inboundBatchUserLineCount?: number;
  /** Router `recommendedModel` — logged only; never selects the HTTP model by itself. */
  routingRecommendedModel?: string;
  /**
   * Optional model for the active provider (e.g. bot smoke test, future tenant override when policy allows).
   * Registry-validated via `resolveGenerationModel`; does not include router hints.
   */
  tenantGenerationModelOverride?: string;
  /** Subaccount prompt config — when set, overrides agency provider row temperature / max tokens. */
  temperature?: number;
  maxTokens?: number;
  /** Conversation policy summary for the latest turn (intent, selection, state). */
  policyContext?: GenerateDraftPolicyContext;
}

export interface GenerateDraftResult {
  content: string | null;
  skipReason?: 'no_agency' | 'no_provider' | 'generation_failed';
  /** When MiniMax (or other primary) failed but OpenAI returned text. */
  usedFallbackProvider?: 'OPENAI';
  /** `agencies.active_ai_provider` at call time (when resolved). */
  agencyActiveProvider?: string;
  /** Agency active provider row default model (registry-normalized), for cost accounting. */
  configuredModel?: string;
  /** Router-recommended model id (informational; billing uses configured + generation fields). */
  routingRecommendedModel?: string;
  /** Provider whose HTTP API produced `content` (live path only). */
  generationProvider?: 'MINIMAX' | 'OPENAI';
  /** Model id sent to that provider (not the router heuristic id). */
  generationModel?: string;
  /** Same as `generationModel` — explicit name for logs and orchestration metadata. */
  generationModelActuallyUsed?: string;
  /** True when live text came from OpenAI after a non-OPENAI primary failed. */
  usedOpenAiFallback?: boolean;
  /** True when `usedOpenAiFallback` (alias for orchestration metadata). */
  fallbackUsed?: boolean;
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
    const routingRecommendedModel = params.routingRecommendedModel?.trim() || undefined;
    try {
      const agencyId = await this.getAgencyId(params.tenantId);
      if (!agencyId) {
        this.logger.debug('No agencyId for tenant — skipping live generation');
        return { content: null, skipReason: 'no_agency', routingRecommendedModel };
      }

      const active = await this.getActiveProviderName(agencyId);
      const primary = await this.loadProviderRow(agencyId, active);
      const configuredModel = normalizeModelForLiveProvider(
        active,
        (primary?.settings as Record<string, unknown> | undefined)?.['defaultModel'] as string | undefined,
      );
      const openaiFallback = await this.loadProviderRow(agencyId, 'OPENAI');
      const openaiFallbackOk = isUsableOpenAiFallbackKey(openaiFallback?.api_key);

      if (!primary?.api_key && !openaiFallbackOk) {
        this.logger.debug('No API keys for active or OpenAI — skipping');
        return {
          content: null,
          skipReason: 'no_provider',
          agencyActiveProvider: active,
          configuredModel,
          routingRecommendedModel,
        };
      }

      const tryPrimary = primary && primary.api_key;
      if (tryPrimary) {
        const r = await this.runProvider(params, primary, active);
        const cleaned = this.sanitizeCustomerFacing(r.content);
        if (cleaned && r.generationProvider && r.generationModel) {
          const generationModelActuallyUsed = r.generationModel;
          this.logger.log(
            `Live generation ok: agencyActiveProvider=${active} configuredModel=${configuredModel} ` +
              `routingRecommendedModel=${routingRecommendedModel ?? 'n/a'} generationProvider=${r.generationProvider} ` +
              `generationModelActuallyUsed=${generationModelActuallyUsed}`,
          );
          return {
            content: cleaned,
            agencyActiveProvider: active,
            configuredModel,
            routingRecommendedModel,
            generationProvider: r.generationProvider,
            generationModel: generationModelActuallyUsed,
            generationModelActuallyUsed,
            usedOpenAiFallback: false,
            fallbackUsed: false,
          };
        }
        if (active !== 'OPENAI' && openaiFallbackOk && openaiFallback) {
          this.logger.warn(`Primary provider ${active} failed or empty; trying OpenAI fallback`);
          const r2 = await this.runProvider(params, openaiFallback, 'OPENAI');
          const cleaned2 = this.sanitizeCustomerFacing(r2.content);
          if (cleaned2 && r2.generationProvider && r2.generationModel) {
            const generationModelActuallyUsed = r2.generationModel;
            this.logger.log(
              `Live generation ok (OpenAI fallback): agencyActiveProvider=${active} configuredModel=${configuredModel} ` +
                `routingRecommendedModel=${routingRecommendedModel ?? 'n/a'} generationProvider=${r2.generationProvider} ` +
                `generationModelActuallyUsed=${generationModelActuallyUsed} fallbackUsed=true`,
            );
            return {
              content: cleaned2,
              usedFallbackProvider: 'OPENAI',
              agencyActiveProvider: active,
              configuredModel,
              routingRecommendedModel,
              generationProvider: r2.generationProvider,
              generationModel: generationModelActuallyUsed,
              generationModelActuallyUsed,
              usedOpenAiFallback: true,
              fallbackUsed: true,
            };
          }
        } else if (active !== 'OPENAI' && openaiFallback?.api_key && !openaiFallbackOk) {
          this.logger.warn(
            `Primary provider ${active} failed; OpenAI fallback skipped (no usable OpenAI API key configured)`,
          );
        }
        return {
          content: null,
          skipReason: 'generation_failed',
          agencyActiveProvider: active,
          configuredModel,
          routingRecommendedModel,
        };
      }

      // No primary key — use OpenAI only
      if (openaiFallbackOk && openaiFallback) {
        const r2 = await this.runProvider(params, openaiFallback, 'OPENAI');
        const cleaned2 = this.sanitizeCustomerFacing(r2.content);
        if (cleaned2 && r2.generationProvider && r2.generationModel) {
          const generationModelActuallyUsed = r2.generationModel;
          this.logger.log(
            `Live generation ok (OpenAI-only row): agencyActiveProvider=${active} configuredModel=${configuredModel} ` +
              `routingRecommendedModel=${routingRecommendedModel ?? 'n/a'} generationProvider=${r2.generationProvider} ` +
              `generationModelActuallyUsed=${generationModelActuallyUsed}`,
          );
          return {
            content: cleaned2,
            usedFallbackProvider: 'OPENAI',
            agencyActiveProvider: active,
            configuredModel,
            routingRecommendedModel,
            generationProvider: r2.generationProvider,
            generationModel: generationModelActuallyUsed,
            generationModelActuallyUsed,
            usedOpenAiFallback: false,
            fallbackUsed: false,
          };
        }
      }
      return {
        content: null,
        skipReason: 'no_provider',
        agencyActiveProvider: active,
        configuredModel,
        routingRecommendedModel,
      };
    } catch (error) {
      const message = error instanceof Error ? error.message : 'unknown';
      this.logger.warn(`Live generation failed: ${message}`);
      return { content: null, skipReason: 'generation_failed', routingRecommendedModel };
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
    const { model, coercedFromStored, coercedFromRequest } = resolveGenerationModel(
      providerName,
      settingsModel,
      params.tenantGenerationModelOverride?.trim() || undefined,
    );
    if (coercedFromStored || coercedFromRequest) {
      this.logger.warn(
        `Resolved generation model for ${providerName}: using ${model}` +
          (coercedFromStored ? ' (stored agency default was not in the allowed registry)' : '') +
          (coercedFromRequest ? ' (tenant/router model was not valid for this provider)' : ''),
      );
    }
    const agTemp = (settings['temperature'] as number) ?? 0.7;
    const agMax = (settings['maxTokens'] as number) ?? 500;
    const temp =
      params.temperature != null && Number.isFinite(params.temperature) ? params.temperature! : agTemp;
    const maxT =
      params.maxTokens != null && Number.isFinite(params.maxTokens) ? Math.floor(params.maxTokens) : agMax;
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
        this.logger.debug(
          `MiniMax HTTP ok: generationModelActuallyUsed=${(out.model && String(out.model).trim()) || model} tokens~=${out.totalTokens}`,
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
      defaultModel: model,
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
      this.logger.debug(
        `OpenAI HTTP ok: generationModelActuallyUsed=${result.model?.trim() || model} tokens=${result.usage.totalTokens}`,
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

  private buildKbContextSystemMessage(params: GenerateDraftParams): {
    role: 'system';
    content: string;
  } {
    const pc = params.policyContext;
    const intent = pc?.latestIntent ?? 'UNKNOWN';
    const menuish =
      intent === 'MENU' ||
      (intent === 'SHORT_SELECTION' &&
        Boolean(pc?.menuSelectionActive || pc?.resolvedSelection));

    const kbText = params.kbContext
      .map((c, i) => {
        const shortLabel = (c.title ?? c.source ?? '').trim();
        const label = shortLabel ? ` (${shortLabel.slice(0, 72)})` : '';
        return `[${i + 1}]${label}\n${c.content}`;
      })
      .join('\n\n');

    const multiLineTurn = (params.policyContext?.combinedInboundMessageCount ?? 0) > 1;
    const baseRules =
      'The excerpts below are **source material only**. They are not a script to paste. ' +
      'Never output internal business instructions, persona training, or brand-brief lines. ' +
      'Never paste raw KB blocks, document headings, or long lists unless the customer explicitly asked for the full list. ' +
      (multiLineTurn
        ? 'The customer sent multiple short messages at once (separated by blank lines in their user turn). ' +
          'Answer each distinct question or theme **in order** in one reply — do not only address the last line. ' +
          'If one line is factual (hours, location, price) and another is different, answer both briefly in the same message. ' +
          'If one line requests something likely out of scope for this business and another is in scope, address the in-scope part and politely clarify the other. ' +
          'When several threads compete, prioritize: (1) safety, allergy, medical concerns, complaints (2) booking (3) factual KB (hours, location, price) (4) out-of-scope vs alternatives (5) recommendations (6) menu / meta / small talk. ' +
          'Use only facts that answer those messages; '
        : 'Use only facts that answer the **latest** customer message; ignore irrelevant snippets. ') +
      'Summarize and rewrite into a short, natural WhatsApp-style reply.\n\n' +
      `Source excerpts:\n${kbText}\n\n` +
      'Do not invent prices, ingredients, availability, or items not clearly supported by the excerpts.';

    if (menuish) {
      const selectedSection = pc?.resolvedSelection?.selectedText?.trim();
      const sectionRule = selectedSection
        ? ` The customer selected "${selectedSection}" — only answer from that section of the excerpts; ignore other sections.`
        : ' If the excerpts only cover one section, stay in that section. If the customer named a specific category, only answer from that section.';
      return {
        role: 'system',
        content:
          baseRules +
          ' For menu/services/products questions: reply with at most **4** items unless the customer asked for the full list. ' +
          'Use a clean shape: each item = name on one line, then a very short description (from the excerpt only).' +
          sectionRule,
      };
    }

    return {
      role: 'system',
      content: baseRules + ' Keep the reply to one or two short paragraphs unless they asked for detail.',
    };
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
      const batchN = params.inboundBatchUserLineCount;
      if (batchN != null && batchN > 1) {
        let strip = 0;
        for (let i = mem.length - 1; i >= 0 && strip < batchN; i--) {
          if (mem[i]!.role === 'user') strip++;
          else break;
        }
        if (strip > 0) memForHistory = mem.slice(0, -strip);
      } else {
        const last = mem[mem.length - 1];
        if (last && last.role === 'user' && last.content === incoming) {
          memForHistory = mem.slice(0, -1);
        }
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
      messages.push(this.buildKbContextSystemMessage(params));
    }

    const pc = params.policyContext;
    if (pc) {
      const multi = (pc.combinedInboundMessageCount ?? 0) > 1;
      const parts: string[] = [
        `Conversation policy: latestIntent=${pc.latestIntent}. State: ${pc.conversationStateSummary}.`,
        multi
          ? `Use KB only if relevant to the customer messages in this combined turn (${pc.combinedInboundMessageCount} lines). ` +
            'Address each separate ask in order; do not only follow the final line. If the user chose an option (A/B/C), continue that flow for the option line only.'
          : 'Use KB only if relevant to the latest customer message. If the user selected an option, continue that flow.',
      ];
      if (pc.resolvedSelection) {
        parts.push(
          `The user chose option ${pc.resolvedSelection.selectedLabel} (${pc.resolvedSelection.selectedText}).`,
        );
      }
      if (pc.latestIntent === 'MENU' || pc.latestIntent === 'SHORT_SELECTION') {
        parts.push(
          'Menu rule: Never invent dish names, drink names, prices, availability, dietary claims, or marketing descriptions not explicitly supported by the KB excerpts.',
        );
      }
      if (pc.latestIntent === 'BOOKING') {
        parts.push(
          'Booking rule: Never invent reservation time slots or table availability. If no booking system data is in context, only ask which date and time they prefer.',
        );
      }
      if (pc.latestIntent === 'COMPLAINT') {
        parts.push(
          'Complaint rule: Be empathetic and solution-oriented. Never paste internal complaint procedures, logging templates, or staff-only scripts to the customer.',
        );
      }
      messages.push({ role: 'system', content: parts.join(' ') });
    }

    const repeat = params.policyContext?.repeatedCustomerMessageHandling;
    if (repeat === 'concise_repeat') {
      messages.push({
        role: 'system',
        content:
          'The customer repeated their last message (same wording as their previous user line). Reply again briefly and helpfully — do not stay silent.',
      });
    } else if (repeat === 'confirm_echo') {
      messages.push({
        role: 'system',
        content:
          'The customer has asked the same thing multiple times. Reply with a short, polite "just to confirm" style answer — restate the key fact once; do not ignore them.',
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
