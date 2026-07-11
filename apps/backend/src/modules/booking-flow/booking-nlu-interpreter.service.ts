import { Injectable, Logger } from '@nestjs/common';
import { OpenAiProviderAdapter } from '@aisbp/ai-provider-openai';
import { normalizeModelForLiveProvider } from '@aisbp/types';
import { getSupabaseService } from '../../lib/supabase';
import { isUsableOpenAiFallbackKey } from '../../lib/ai-live-model-resolve';
import { bookingNluOutputSchema, type BookingNluInterpretInput, type BookingNluOutput } from './booking-nlu.schema';
import { listNluExtractedFieldKeysForLog } from './booking-nlu-merge';
import { softenBookingNluParsedJson } from './booking-nlu-soften';
import { BotProfilesService } from '../prompts/bot-profiles.service';

type ProviderRow = {
  provider: string;
  api_key: string;
  endpoint: string | null;
  settings: Record<string, unknown>;
};

@Injectable()
export class BookingNluInterpreterService {
  private readonly logger = new Logger(BookingNluInterpreterService.name);
  private readonly supabase = getSupabaseService();

  constructor(private readonly botProfiles: BotProfilesService) {}

  /**
   * Returns structured NLU output or null (caller keeps deterministic path only).
   * Temperature 0, JSON-only. Never creates appointments or slots.
   */
  async interpret(input: BookingNluInterpretInput): Promise<BookingNluOutput | null> {
    const agencyId = await this.getAgencyId(input.tenantId);
    if (!agencyId) {
      this.logger.log(
        `bookingNluUnavailable ${JSON.stringify({
          tenantId: input.tenantId,
          conversationId: input.conversationId,
          reason: 'no_agency',
        })}`,
      );
      return null;
    }
    const openaiRow = await this.loadProviderRow(agencyId, 'OPENAI');
    if (!openaiRow?.api_key || !isUsableOpenAiFallbackKey(openaiRow.api_key)) {
      this.logger.log(
        `bookingNluUnavailable ${JSON.stringify({
          tenantId: input.tenantId,
          conversationId: input.conversationId,
          reason: 'no_openai_key',
        })}`,
      );
      return null;
    }

    const model = normalizeModelForLiveProvider(
      'OPENAI',
      (openaiRow.settings['defaultModel'] as string | undefined) ?? 'gpt-4o-mini',
    );
    const maxTokens = 500;
    const temperature = 0;

    const userPayload = JSON.stringify(
      {
        latestInboundText: input.latestInboundText,
        transcript: input.transcript,
        booking: input.booking,
        settingsSummary: input.settingsSummary,
        pendingFieldId: input.pendingFieldId,
        requiredMissing: input.requiredMissing,
        serviceMenuOptions: input.serviceMenuOptions ?? null,
        crmTimezone: input.crmTimezone,
        offeredSlots: input.offeredSlots ?? null,
      },
      null,
      0,
    );

    const system = [
      'You are a strict NLU component for a business booking assistant.',
      'Extract structured meaning from the LATEST user message using the transcript and booking state as context.',
      'Return ONLY one JSON object matching this schema (no markdown, no prose):',
      '{',
      '  "intent": "booking_start" | "provide_field" | "select_slot" | "revise_time" | "revise_date_time" | "request_availability" | "confirm_offer" | "ask_question" | "cancel" | "unknown",',
      '  "confidence": number between 0 and 1,',
      '  "fields": {',
      '    "service": string | null,',
      '    "preferredDate": string | null,',
      '    "preferredTime": string | null,',
      '    "preferredTimeWindow": "morning"|"afternoon"|"evening"|"lunch"|"noon"|"after_work"|"before_lunch"|null,',
      '    "name": string | null,',
      '    "phone": string | null,',
      '    "email": string | null,',
      '    "firstVisit": "yes"|"no"|null,',
      '    "customAnswers": { "<customFieldId>": "<value>" }',
      '  },',
      '  "slotSelection": { "type": "index"|"time"|"none", "index": number|null, "time": string|null },',
      '  "userFrustrated": boolean,',
      '  "notes": string|null',
      '}',
      '',
      'Rules:',
      '- Extract meaning only. Do NOT write a customer reply.',
      '- Do NOT invent calendar slots or appointments.',
      '- Do NOT assume missing required fields; leave null.',
      '- Generic booking intent alone ("I want to book") => service MUST be null.',
      '- If service text matches a configured service option (same meaning), set fields.service to that EXACT configured label.',
      '- Compact times: "330pm", "3:30pm", "0330pm" => preferredTime 15:30. "1130am" => 11:30. "12pm" => 12:00. "1230pm" => 12:30.',
      '- "1530" without am/pm => 15:30 only when clearly a time (e.g. pending preferred_time or next to a date).',
      '- "29th may 330pm" => preferredDate for that day AND preferredTime 15:30.',
      '- "tomorrow 330pm" => preferredDate tomorrow + preferredTime 15:30 when calendar math is clear from context.',
      '- "30/5 330pm" => preferredDate on 30 May (infer year from context) + preferredTime 15:30.',
      '- Frustrated filler ("speechless", "...", "told you already 3pm") still extract time if present.',
      '- "afternoon la" => preferredTimeWindow afternoon.',
      '- "consultation can?" => service Consultation when that matches a configured service option.',
      '- "anything also can" / "anything" => if a pending custom field has option "Anything", put it in customAnswers under that field id.',
      '- "no. anything will do" with pending custom single_select => customAnswers for that field id only (value Anything); do not set firstVisit.',
      '- If pendingFieldId is preferred_time, prioritise extracting preferredTime or preferredTimeWindow from messy text.',
      '- slotSelection is advisory only; the host app may ignore it for safety.',
      '',
      'Intent selection (use the LATEST message; transcript gives context):',
      '- request_availability: user asks what dates/times are open, "when are you available", "tell me available slots", "which date can", not naming only one new day.',
      '- revise_date_time: user changes day and/or time ("26th", "28th?", "next week wednesday", "different date") even if booking already has a date.',
      '- revise_time: user changes time/window only on the same day.',
      '- confirm_offer: user accepts a reserve/confirm prompt ("yes", "yes please", "book it", "go ahead") while offeredSlots has one option or bot just offered one time.',
      '- select_slot: user picks a numbered option or names a time from offeredSlots list.',
      '- provide_field: user supplies intake fields (name, phone, batch line, service, date, time) without mainly asking for availability.',
      '- ask_question: general question; if it is really about availability use request_availability instead.',
      '- Relative dates: "next week", "next week wednesday", "wednesday?" => preferredDate YYYY-MM-DD using CRM context (today in payload).',
      '- Ordinal day only ("26th", "28th?") => preferredDate for that day in the current/next reasonable month.',
      '- After a failed date, "26th?" / "another day" => revise_date_time with the new preferredDate.',
      '- "9am" / "3pm" => preferredTime HH:MM (24h).',
    ].join('\n');

    const profileAppendix = await this.botProfiles.getBookingNluProfileAppendix(input.tenantId);
    const systemPromptFull =
      profileAppendix.trim().length > 0
        ? `${system}\n\n---\nSubaccount active assistant profile (hints only):\n${profileAppendix}`
        : system;

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
          { role: 'system', content: systemPromptFull },
          { role: 'user', content: userPayload },
        ],
        temperature,
        maxTokens,
      });
      const raw = result.content?.trim() ?? '';
      const parsed = parseJsonLenient(raw);
      if (parsed === null || parsed === undefined) {
        this.logger.log(
          `bookingNluMergeSkipped ${JSON.stringify({
            tenantId: input.tenantId,
            conversationId: input.conversationId,
            reason: 'parse_failed',
          })}`,
        );
        return null;
      }
      const softened = softenBookingNluParsedJson(input, parsed);
      const safe = bookingNluOutputSchema.safeParse(softened);
      if (!safe.success) {
        this.logger.log(
          `bookingNluMergeSkipped ${JSON.stringify({
            tenantId: input.tenantId,
            conversationId: input.conversationId,
            reason: 'parse_failed',
            issueCodes: safe.error.issues.slice(0, 5).map(i => i.code),
          })}`,
        );
        return null;
      }
      const data = safe.data;
      this.logger.log(
        `bookingNluInterpreted ${JSON.stringify({
          tenantId: input.tenantId,
          conversationId: input.conversationId,
          intent: data.intent,
          confidence: data.confidence,
          extractedFieldKeys: listNluExtractedFieldKeysForLog(data),
          userFrustrated: data.userFrustrated,
        })}`,
      );
      return data;
    } catch (e) {
      this.logger.log(
        `bookingNluUnavailable ${JSON.stringify({
          tenantId: input.tenantId,
          conversationId: input.conversationId,
          reason: 'provider_error',
          errorName: e instanceof Error ? e.name : 'unknown',
        })}`,
      );
      return null;
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

export function parseJsonLenient(text: string): unknown {
  const tryParse = (s: string): unknown => {
    try {
      return JSON.parse(s) as unknown;
    } catch {
      return null;
    }
  };
  let obj = tryParse(text);
  if (!obj && text.includes('{')) {
    const start = text.indexOf('{');
    const end = text.lastIndexOf('}');
    if (start >= 0 && end > start) obj = tryParse(text.slice(start, end + 1));
  }
  return obj;
}
