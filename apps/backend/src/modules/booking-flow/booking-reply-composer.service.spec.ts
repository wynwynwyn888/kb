import { beforeEach, describe, expect, it, jest } from '@jest/globals';

var mockComposerGenerate = jest.fn();

jest.mock('@aisbp/ai-provider-openai', () => ({
  OpenAiProviderAdapter: jest.fn().mockImplementation(() => ({
    initialize: jest.fn(),
    generate: (...args: unknown[]) => mockComposerGenerate(...args),
  })),
}));

const mockFrom = jest.fn();

jest.mock('../../lib/supabase', () => ({
  getSupabaseService: () => ({
    from: (table: string) => mockFrom(table),
  }),
}));

import { BookingReplyComposerService } from './booking-reply-composer.service';
import type { BotProfilesService } from '../prompts/bot-profiles.service';

function chainTenantAgencyOpenAi() {
  mockFrom.mockImplementation((table: string) => {
    if (table === 'tenants') {
      return {
        select: () => ({
          eq: () => ({
            single: () => ({ data: { agency_id: 'ag1' }, error: null }),
          }),
        }),
      };
    }
    if (table === 'agency_model_providers') {
      return {
        select: () => ({
          eq: () => ({
            eq: () => ({
              maybeSingle: () => ({
                data: {
                  provider: 'OPENAI',
                  api_key: 'sk-proj-unit-test-key-xxxxxxxx',
                  endpoint: null,
                  settings: { defaultModel: 'gpt-4o-mini' },
                },
                error: null,
              }),
            }),
          }),
        }),
      };
    }
    return { select: () => ({ eq: () => ({ single: () => ({ data: null, error: null }) }) }) };
  });
}

describe('BookingReplyComposerService', () => {
  let svc: BookingReplyComposerService;

  beforeEach(() => {
    mockComposerGenerate.mockReset();
    mockFrom.mockReset();
    chainTenantAgencyOpenAi();
    const mockBotProfiles = {
      getBookingReplyPersonaPrompt: async () => undefined as string | undefined,
    };
    svc = new BookingReplyComposerService(mockBotProfiles as unknown as BotProfilesService);
  });

  const baseInput = {
    tenantId: 't1',
    conversationId: 'c1',
    latestInboundText: 'Hi',
    recentTranscript: 'U: Hi',
    currentBookingState: {},
    businessName: 'Test Salon',
    userFrustrated: false,
  };

  it('includes active assistant profile text in composer user payload', async () => {
    const mockBotProfiles2 = {
      getBookingReplyPersonaPrompt: async () => 'Speak briefly and warmly.',
    };
    const svc2 = new BookingReplyComposerService(mockBotProfiles2 as unknown as BotProfilesService);
    mockComposerGenerate.mockResolvedValue({
      content: JSON.stringify({ reply: 'What time works for you?', confidence: 0.9 }),
    });
    const safe = 'What time would you like?';
    await svc2.compose({
      ...baseInput,
      nextStep: { type: 'ask_time', fieldId: 'preferred_time', safeBaseMessage: safe },
    });
    const arg = mockComposerGenerate.mock.calls[0]?.[0] as { messages: Array<{ role: string; content: string }> };
    const user = JSON.parse(arg.messages[1].content) as { personaPrompt: string | null };
    expect(user.personaPrompt).toContain('briefly');
  });

  it('rewrites ask_service and keeps option letters when model includes them', async () => {
    const safe =
      'What service are you interested in?\n\nA) Haircut\nB) Colour\n\nReply with a letter, pick from the list, or describe another service.';
    mockComposerGenerate.mockResolvedValue({
      content: JSON.stringify({
        reply:
          'Sure — what would you like?\n\nA) Haircut\nB) Colour\n\nLetter, pick from the list, or describe another.',
        confidence: 0.88,
      }),
    });
    const out = await svc.compose({
      ...baseInput,
      nextStep: { type: 'ask_service', fieldId: 'service', safeBaseMessage: safe, serviceOptions: ['Haircut', 'Colour'] },
    });
    expect(out).toContain('A)');
    expect(out).toContain('Haircut');
    expect(out).not.toBe(safe);
  });

  it('rewrites ask_time naturally at high confidence', async () => {
    const safe = 'What time would you prefer? Morning, afternoon, or a specific time works.';
    mockComposerGenerate.mockResolvedValue({
      content: JSON.stringify({
        reply: 'Got it. What time works best — morning, afternoon, or something like 3:30pm?',
        confidence: 0.85,
      }),
    });
    const out = await svc.compose({
      ...baseInput,
      nextStep: { type: 'ask_time', fieldId: 'preferred_time', safeBaseMessage: safe },
    });
    expect(out.toLowerCase()).toContain('morning');
    expect(out).not.toBe(safe);
  });

  it('applies frustrated-aware ask_name rewrite', async () => {
    mockComposerGenerate.mockResolvedValue({
      content: JSON.stringify({
        reply: 'Got it, 3:30pm. May I have the booking name?',
        confidence: 0.82,
      }),
    });
    const out = await svc.compose({
      ...baseInput,
      latestInboundText: '330pm..... speechless',
      userFrustrated: true,
      nextStep: { type: 'ask_name', fieldId: 'name', safeBaseMessage: 'May I have the booking name, please?' },
    });
    expect(out.toLowerCase()).toContain('name');
    expect(out).not.toBe('May I have the booking name, please?');
  });

  it('falls back to safeBaseMessage on invalid JSON', async () => {
    const safe = 'What service would you like to book?';
    mockComposerGenerate.mockResolvedValue({ content: 'not json at all' });
    const out = await svc.compose({
      ...baseInput,
      nextStep: { type: 'ask_service', fieldId: 'service', safeBaseMessage: safe },
    });
    expect(out).toBe(safe);
  });

  it('falls back to safeBaseMessage when confidence is below 0.6', async () => {
    const safe = 'What date would you prefer?';
    mockComposerGenerate.mockResolvedValue({
      content: JSON.stringify({ reply: 'When works for you?', confidence: 0.55 }),
    });
    const out = await svc.compose({
      ...baseInput,
      nextStep: { type: 'ask_date', fieldId: 'preferred_date', safeBaseMessage: safe },
    });
    expect(out).toBe(safe);
  });

  it('falls back when offer_slots reply violates guardrails', async () => {
    const safe = 'I found these available slots for 1 May:\n\n1. Mon 9am\n2. Mon 10am\n\nWhich one would you like me to reserve?';
    mockComposerGenerate.mockResolvedValue({
      content: JSON.stringify({
        reply: `${safe}\n3. Tue 2pm`,
        confidence: 0.95,
      }),
    });
    const out = await svc.compose({
      ...baseInput,
      nextStep: {
        type: 'offer_slots',
        safeBaseMessage: safe,
        offeredSlots: [
          { option: 1, label: 'Mon 9am' },
          { option: 2, label: 'Mon 10am' },
        ],
      },
    });
    expect(out).toBe(safe);
  });

  it('falls back when no_slots reply invents numbered slots', async () => {
    const safe =
      "I couldn't find open slots for that date in the live calendar. Try another date, or the team can help find a time.";
    mockComposerGenerate.mockResolvedValue({
      content: JSON.stringify({
        reply: `${safe}\n\n1. Mon 9am`,
        confidence: 0.9,
      }),
    });
    const out = await svc.compose({
      ...baseInput,
      nextStep: { type: 'no_slots', safeBaseMessage: safe },
    });
    expect(out).toBe(safe);
  });

  it('skips to safeBaseMessage when tenant has no agency', async () => {
    mockFrom.mockImplementation((table: string) => {
      if (table === 'tenants') {
        return {
          select: () => ({
            eq: () => ({
              single: () => ({ data: { agency_id: null }, error: null }),
            }),
          }),
        };
      }
      return { select: () => ({ eq: () => ({ single: () => ({ data: null, error: null }) }) }) };
    });
    const safe = 'What service would you like to book?';
    const out = await svc.compose({
      ...baseInput,
      nextStep: { type: 'ask_service', fieldId: 'service', safeBaseMessage: safe },
    });
    expect(out).toBe(safe);
    expect(mockComposerGenerate).not.toHaveBeenCalled();
  });
});
