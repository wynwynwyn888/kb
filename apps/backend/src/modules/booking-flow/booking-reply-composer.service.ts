import { Injectable, Logger } from '@nestjs/common';
import { OpenAiProviderAdapter } from '@aisbp/ai-provider-openai';
import { normalizeModelForLiveProvider } from '@aisbp/types';
import { getSupabaseService } from '../../lib/supabase';
import { isUsableOpenAiFallbackKey } from '../../lib/ai-live-model-resolve';
import { parseJsonLenient } from './booking-nlu-interpreter.service';
import { bookingReplyComposerOutputSchema } from './booking-reply-composer.schema';
import { bookingReplyComposerOutputPassesGuardrails } from './booking-reply-composer.guards';
import type { BookingReplyComposerComposeInput } from './booking-reply-composer.types';
import { BotProfilesService } from '../prompts/bot-profiles.service';

type ProviderRow = {
  provider: string;
  api_key: string;
  endpoint: string | null;
  settings: Record<string, unknown>;
};

const MIN_APPLY_CONFIDENCE = 0.6;

function clip(s: string, max: number): string {
  const t = s.trim();
  if (t.length <= max) return t;
  return `${t.slice(0, max)}\n…`;
}

@Injectable()
export class BookingReplyComposerService {
  private readonly logger = new Logger(BookingReplyComposerService.name);
  private readonly supabase = getSupabaseService();

  constructor(private readonly botProfiles: BotProfilesService) {}

  /**
   * Rewrites deterministic `safeBaseMessage` in a short WhatsApp tone without changing the booking action.
   */
  async compose(input: BookingReplyComposerComposeInput): Promise<string> {
    const agencyId = await this.getAgencyId(input.tenantId);
    if (!agencyId) {
      this.logger.log(
        `bookingReplyComposerSkipped ${JSON.stringify({
          tenantId: input.tenantId,
          conversationId: input.conversationId,
          reason: 'unavailable',
          detail: 'no_agency',
        })}`,
      );
      return input.nextStep.safeBaseMessage;
    }
    const openaiRow = await this.loadProviderRow(agencyId, 'OPENAI');
    if (!openaiRow?.api_key || !isUsableOpenAiFallbackKey(openaiRow.api_key)) {
      this.logger.log(
        `bookingReplyComposerSkipped ${JSON.stringify({
          tenantId: input.tenantId,
          conversationId: input.conversationId,
          reason: 'unavailable',
          detail: 'no_openai_key',
        })}`,
      );
      return input.nextStep.safeBaseMessage;
    }

    const model = normalizeModelForLiveProvider(
      'OPENAI',
      (openaiRow.settings['defaultModel'] as string | undefined) ?? 'gpt-4o-mini',
    );
    const maxTokens = 400;
    const temperature = 0.65;

    const profilePersona = await this.botProfiles.getBookingReplyPersonaPrompt(input.tenantId);
    const personaPromptMerged =
      [input.personaPrompt?.trim(), profilePersona].filter(Boolean).join('\n\n') || null;

    const userPayload = JSON.stringify(
      {
        latestInboundText: input.latestInboundText,
        recentTranscript: clip(input.recentTranscript, 8000),
        currentBookingState: input.currentBookingState,
        nextStep: input.nextStep,
        businessName: input.businessName ?? null,
        personaPrompt: personaPromptMerged,
        userFrustrated: Boolean(input.userFrustrated),
      },
      null,
      0,
    );

    const system = [
      'You rewrite booking chat replies for WhatsApp. Output ONLY JSON: {"reply": string, "confidence": number 0-1}.',
      'Reply in the same language as latestInboundText (strict). Do not switch to English unless the customer wrote in English.',
      'Rules:',
      '- Preserve the exact business action implied by nextStep.type and safeBaseMessage.',
      '- Do not invent calendar slots, times, or availability.',
      '- Do not confirm an appointment unless nextStep.type is booking_confirmed.',
      '- Do not skip required fields; ask what safeBaseMessage asks.',
      '- If nextStep.offeredSlots is set, the reply must only reference those options/labels (same count of numbered choices).',
      '- If nextStep.type is no_slots, do not claim you found openings or list new numbered slots.',
      '- If userFrustrated is true, acknowledge briefly once, then continue (e.g. "Got it —").',
      '- Use personaPrompt and businessName only for tone; do not contradict facts.',
      '- Short, natural, not corporate; no long essays.',
      '- Keep any A)/B)/C) option letters if present in safeBaseMessage; you may lightly rephrase the intro line.',
      '- Do not invent a street address, postal address, neighborhood, or MRT/transit station unless it appears verbatim in safeBaseMessage.',
    ].join('\n');

    const adapter = new OpenAiProviderAdapter();
    adapter.initialize({
      apiKey: openaiRow.api_key,
      endpoint: openaiRow.endpoint ?? undefined,
      defaultModel: model,
      maxTokens,
      temperature,
    });

    try {
      const result = await adapter.generate({
        model,
        messages: [
          { role: 'system', content: system },
          { role: 'user', content: userPayload },
        ],
        temperature,
        maxTokens,
      });
      const raw = result.content?.trim() ?? '';
      const parsed = parseJsonLenient(raw);
      const safe = bookingReplyComposerOutputSchema.safeParse(parsed);
      if (!safe.success) {
        this.logger.log(
          `bookingReplyComposerSkipped ${JSON.stringify({
            tenantId: input.tenantId,
            conversationId: input.conversationId,
            reason: 'parse_failed',
          })}`,
        );
        return input.nextStep.safeBaseMessage;
      }
      const { reply, confidence } = safe.data;
      this.logger.log(
        `bookingReplyComposerInterpreted ${JSON.stringify({
          tenantId: input.tenantId,
          conversationId: input.conversationId,
          nextStepType: input.nextStep.type,
          fieldId: input.nextStep.fieldId ?? null,
          confidence,
          replyLength: reply.trim().length,
        })}`,
      );
      if (confidence < MIN_APPLY_CONFIDENCE) {
        this.logger.log(
          `bookingReplyComposerSkipped ${JSON.stringify({
            tenantId: input.tenantId,
            conversationId: input.conversationId,
            reason: 'low_confidence',
            confidence,
          })}`,
        );
        return input.nextStep.safeBaseMessage;
      }
      if (!bookingReplyComposerOutputPassesGuardrails(input.nextStep, input.nextStep.safeBaseMessage, reply)) {
        this.logger.log(
          `bookingReplyComposerSkipped ${JSON.stringify({
            tenantId: input.tenantId,
            conversationId: input.conversationId,
            reason: 'guardrails_failed',
          })}`,
        );
        return input.nextStep.safeBaseMessage;
      }
      this.logger.log(
        `bookingReplyComposerApplied ${JSON.stringify({
          tenantId: input.tenantId,
          conversationId: input.conversationId,
          nextStepType: input.nextStep.type,
          fieldId: input.nextStep.fieldId ?? null,
          confidence,
          replyLength: reply.trim().length,
        })}`,
      );
      return reply.trim();
    } catch (e) {
      this.logger.log(
        `bookingReplyComposerSkipped ${JSON.stringify({
          tenantId: input.tenantId,
          conversationId: input.conversationId,
          reason: 'unavailable',
          detail: 'provider_error',
          errorName: e instanceof Error ? e.name : 'unknown',
        })}`,
      );
      return input.nextStep.safeBaseMessage;
    }
  }

  private async getAgencyId(tenantId: string): Promise<string | null> {
    const { data } = await this.supabase.from('tenants').select('agency_id').eq('id', tenantId).single();
    return data?.agency_id ?? null;
  }

  private async loadProviderRow(agencyId: string, provider: string): Promise<ProviderRow | null> {
    const { data } = await this.supabase
      .from('agency_model_providers')
      .select('provider, api_key, endpoint, settings')
      .eq('agency_id', agencyId)
      .eq('provider', provider)
      .maybeSingle();
    if (!data) return null;
    return data as ProviderRow;
  }
}
