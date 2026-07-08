// GenerationService spec — unit tests for AI generation with provider selection,
// fallback, message building, KB context, vision models, error handling, and sanitization.

import { jest as jestGlobal } from '@jest/globals';
import type { GenerateDraftParams } from './generation.service';

const mockFromChain = (returnValue: unknown) => {
  const chain: Record<string, jestGlobal.Mock> = {};
  chain.eq = jestGlobal.fn(() => chain);
  chain.select = jestGlobal.fn(() => chain);
  chain.single = jestGlobal.fn(async () => returnValue);
  chain.maybeSingle = jestGlobal.fn(async () => returnValue);
  chain.order = jestGlobal.fn(() => chain);
  chain.limit = jestGlobal.fn(() => chain);
  return chain;
};

const mockSupabase = {
  from: jestGlobal.fn(),
};

jestGlobal.mock('../../lib/supabase', () => ({
  getSupabaseService: jestGlobal.fn(() => mockSupabase),
}));

const mockMinimaxChatCompletion = jestGlobal.fn<(...args: unknown[]) => Promise<{ content: string; totalTokens: number; model: string }>>();

jestGlobal.mock('./minimax.generate', () => ({
  minimaxChatCompletion: mockMinimaxChatCompletion,
}));

const mockResolveGenerationModel = jestGlobal.fn<(a: string, b?: string, c?: string) => { model: string; coercedFromStored: boolean; coercedFromRequest: boolean }>();
const mockIsUsableOpenAiFallbackKey = jestGlobal.fn<(key?: string | null) => boolean>();

jestGlobal.mock('../../lib/ai-live-model-resolve', () => ({
  __esModule: true,
  resolveGenerationModel: mockResolveGenerationModel,
  isUsableOpenAiFallbackKey: mockIsUsableOpenAiFallbackKey,
  isLikelyOpenAiModelId: jestGlobal.fn((n: string) => /^gpt-|^o[0-9]/i.test(n)),
  isLikelyMinimaxModelId: jestGlobal.fn((n: string) => /^minimax-/i.test(n.trim())),
}));

const mockOpenAiGenerate = jestGlobal.fn<() => Promise<{ content: string | null; usage: { totalTokens: number }; model?: string; finishReason?: string }>>();
const mockOpenAiInitialize = jestGlobal.fn();

jestGlobal.mock('@aisbp/ai-provider-openai', () => ({
  __esModule: true,
  OpenAiProviderAdapter: jestGlobal.fn().mockImplementation(() => ({
    initialize: mockOpenAiInitialize,
    generate: mockOpenAiGenerate,
  })),
}));

const mockImageResolveForVision = jestGlobal.fn<(params: { tenantId: string; mediaUrl: string }) => Promise<string | null>>();

jestGlobal.mock('../transcription/ghl-inbound-image-fetch.service', () => ({
  __esModule: true,
  GhlInboundImageFetchService: jestGlobal.fn().mockImplementation(() => ({
    resolveForVision: mockImageResolveForVision,
  })),
}));

import { GenerationService } from './generation.service';
import { GhlInboundImageFetchService } from '../transcription/ghl-inbound-image-fetch.service';

function makeParams(overrides: Partial<GenerateDraftParams> = {}): GenerateDraftParams {
  return {
    tenantId: 't1',
    incomingMessage: 'Hello',
    systemPrompt: 'You are a helpful assistant.',
    memory: [],
    kbContext: [],
    ...overrides,
  };
}

function setupSupabaseStubs(overrides: {
  agencyId?: string | null;
  activeProvider?: string;
  providerRow?: { provider: string; api_key: string; endpoint?: string | null; settings?: Record<string, unknown> } | null;
  openaiRow?: { provider: string; api_key: string; endpoint?: string | null; settings?: Record<string, unknown> } | null;
}) {
  const agencyId = overrides.agencyId ?? null;
  const activeRow = overrides.providerRow
    ? { data: overrides.providerRow }
    : { data: null };
  const openaiRow = overrides.openaiRow
    ? { data: overrides.openaiRow }
    : { data: null };

  mockSupabase.from.mockImplementation((table: string) => {
    if (table === 'tenants') {
      const chain = mockFromChain(agencyId ? { agency_id: agencyId } : null);
      chain.select = jestGlobal.fn(() => chain);
      chain.eq = jestGlobal.fn((_k: string, _v: string) => chain);
      chain.single = jestGlobal.fn(async () => (agencyId ? { data: { agency_id: agencyId } } : { data: null }));
      return chain;
    }
    if (table === 'agencies') {
      const data = overrides.activeProvider
        ? { active_ai_provider: overrides.activeProvider }
        : null;
      return mockFromChain({ data });
    }
    if (table === 'agency_model_providers') {
      const chain: Record<string, jestGlobal.Mock> = {};
      let providerFilter: string | undefined;
      chain.select = jestGlobal.fn(() => chain);
      chain.eq = jestGlobal.fn((_k: string, _v: string) => {
        if (_k === 'agency_id') {
          providerFilter = _v;
        }
        return chain;
      });
      chain.maybeSingle = jestGlobal.fn(async () => {
        if (providerFilter === 'OPENAI') return openaiRow;
        return activeRow;
      });
      chain.order = jestGlobal.fn(() => chain);
      chain.limit = jestGlobal.fn(() => chain);
      return chain;
    }
    return mockFromChain(null);
  });
}

describe('GenerationService', () => {
  let service: GenerationService;

  beforeEach(() => {
    jestGlobal.clearAllMocks();
    const MockImageFetch = GhlInboundImageFetchService as unknown as new () => GhlInboundImageFetchService;
    service = new GenerationService(new MockImageFetch());
    mockResolveGenerationModel.mockReturnValue({
      model: 'gpt-4o-mini',
      coercedFromStored: false,
      coercedFromRequest: false,
    });
    mockIsUsableOpenAiFallbackKey.mockReturnValue(true);
    mockOpenAiGenerate.mockResolvedValue({
      content: 'OpenAI reply',
      usage: { totalTokens: 50 },
      model: 'gpt-4o-mini',
    });
    mockMinimaxChatCompletion.mockResolvedValue({
      content: 'MiniMax reply',
      totalTokens: 40,
      model: 'MiniMax-M3',
    });
    mockImageResolveForVision.mockResolvedValue(null);
    setupSupabaseStubs({
      agencyId: 'a1',
      activeProvider: 'OPENAI',
      providerRow: { provider: 'OPENAI', api_key: 'sk-valid-key' },
    });
  });

  // ===========================================================================
  // Provider Selection (OpenAI vs MiniMax)
  // ===========================================================================

  describe('provider selection', () => {
    it('uses OPENAI when active_ai_provider is OPENAI and has a valid key', async () => {
      setupSupabaseStubs({
        agencyId: 'a1',
        activeProvider: 'OPENAI',
        providerRow: { provider: 'OPENAI', api_key: 'sk-valid-key' },
      });
      const result = await service.generateDraft(makeParams());
      expect(result.generationProvider).toBe('OPENAI');
      expect(result.generationModel).toBe('gpt-4o-mini');
      expect(result.content).toBe('OpenAI reply');
      expect(mockOpenAiGenerate).toHaveBeenCalled();
    });

    it('uses MINIMAX when active_ai_provider is MINIMAX and has a valid key', async () => {
      setupSupabaseStubs({
        agencyId: 'a1',
        activeProvider: 'MINIMAX',
        providerRow: { provider: 'MINIMAX', api_key: 'mini-key' },
      });
      const result = await service.generateDraft(makeParams());
      expect(result.generationProvider).toBe('MINIMAX');
      expect(result.generationModel).toBe('MiniMax-M3');
      expect(result.content).toBe('MiniMax reply');
      expect(mockMinimaxChatCompletion).toHaveBeenCalled();
    });

    it('returns generation_failed for unknown active_ai_provider (runs, no adapter, no fallback)', async () => {
      setupSupabaseStubs({
        agencyId: 'a1',
        activeProvider: 'ANTHROPIC',
        providerRow: { provider: 'ANTHROPIC', api_key: 'some-key' },
      });
      mockIsUsableOpenAiFallbackKey.mockReturnValue(false);
      const result = await service.generateDraft(makeParams());
      expect(result.skipReason).toBe('generation_failed');
    });

    it('returns no_provider when active provider row has no API key and no OpenAI fallback', async () => {
      setupSupabaseStubs({
        agencyId: 'a1',
        activeProvider: 'MINIMAX',
        providerRow: { provider: 'MINIMAX', api_key: '' },
      });
      mockIsUsableOpenAiFallbackKey.mockReturnValue(false);
      const result = await service.generateDraft(makeParams());
      expect(result.skipReason).toBe('no_provider');
      expect(result.agencyActiveProvider).toBe('MINIMAX');
    });
  });

  // ===========================================================================
  // Provider Fallback
  // ===========================================================================

  describe('provider fallback', () => {
    it('falls back to OpenAI when primary MiniMax fails with empty content', async () => {
      setupSupabaseStubs({
        agencyId: 'a1',
        activeProvider: 'MINIMAX',
        providerRow: { provider: 'MINIMAX', api_key: 'mini-key' },
        openaiRow: { provider: 'OPENAI', api_key: 'sk-valid-fallback' },
      });
      mockMinimaxChatCompletion.mockResolvedValue({ content: '', totalTokens: 0, model: 'MiniMax-M3' });
      const result = await service.generateDraft(makeParams());
      expect(result.usedFallbackProvider).toBe('OPENAI');
      expect(result.usedOpenAiFallback).toBe(true);
      expect(result.fallbackUsed).toBe(true);
      expect(result.content).toBe('OpenAI reply');
    });

    it('does not fall back when active is OPENAI and returns empty content', async () => {
      setupSupabaseStubs({
        agencyId: 'a1',
        activeProvider: 'OPENAI',
        providerRow: { provider: 'OPENAI', api_key: 'sk-valid' },
      });
      mockOpenAiGenerate.mockResolvedValue({ content: '', usage: { totalTokens: 0 }, model: 'gpt-4o-mini' });
      const result = await service.generateDraft(makeParams());
      expect(result.content).toBeNull();
      expect(result.skipReason).toBe('generation_failed');
    });

    it('skips fallback when OpenAI fallback key is not usable', async () => {
      setupSupabaseStubs({
        agencyId: 'a1',
        activeProvider: 'MINIMAX',
        providerRow: { provider: 'MINIMAX', api_key: 'mini-key' },
        openaiRow: { provider: 'OPENAI', api_key: 'sk-test-key' },
      });
      mockMinimaxChatCompletion.mockResolvedValue({ content: '', totalTokens: 0, model: 'MiniMax-M3' });
      mockIsUsableOpenAiFallbackKey.mockReturnValue(false);
      const result = await service.generateDraft(makeParams());
      expect(result.skipReason).toBe('generation_failed');
      expect(result.content).toBeNull();
    });

    it('uses OpenAI-only row when no primary key is configured', async () => {
      setupSupabaseStubs({
        agencyId: 'a1',
        activeProvider: 'MINIMAX',
        providerRow: { provider: 'MINIMAX', api_key: '' },
        openaiRow: { provider: 'OPENAI', api_key: 'sk-valid-fallback' },
      });
      mockIsUsableOpenAiFallbackKey.mockReturnValue(true);
      const result = await service.generateDraft(makeParams());
      expect(result.content).toBe('OpenAI reply');
      expect(result.generationProvider).toBe('OPENAI');
      expect(result.usedFallbackProvider).toBe('OPENAI');
    });

    it('returns no_provider when both primary and OpenAI rows are missing', async () => {
      setupSupabaseStubs({
        agencyId: 'a1',
        activeProvider: 'MINIMAX',
        providerRow: { provider: 'MINIMAX', api_key: '' },
        openaiRow: null,
      });
      mockIsUsableOpenAiFallbackKey.mockReturnValue(false);
      const result = await service.generateDraft(makeParams());
      expect(result.skipReason).toBe('no_provider');
    });
  });

  // ===========================================================================
  // No Provider / No Agency
  // ===========================================================================

  describe('no provider configured', () => {
    it('returns no_agency when tenant has no agency_id', async () => {
      setupSupabaseStubs({ agencyId: null });
      const result = await service.generateDraft(makeParams());
      expect(result.skipReason).toBe('no_agency');
      expect(result.content).toBeNull();
    });

    it('returns no_provider when active provider row is null and no OpenAI fallback', async () => {
      setupSupabaseStubs({
        agencyId: 'a1',
        activeProvider: 'OPENAI',
        providerRow: null,
        openaiRow: null,
      });
      mockIsUsableOpenAiFallbackKey.mockReturnValue(false);
      const result = await service.generateDraft(makeParams());
      expect(result.skipReason).toBe('no_provider');
    });
  });

  // ===========================================================================
  // Message Building
  // ===========================================================================

  describe('buildMessages', () => {
    it('includes system prompt, language mirror, and brand identity when provided', () => {
      const messages = (service as never)['buildMessages'](
        makeParams({ systemPrompt: 'Test system prompt', businessDisplayName: 'Acme Salon' }),
      );
      expect(messages[0].role).toBe('system');
      expect(messages[0].content).toBe('Test system prompt');
      const contents = messages.map(m => (typeof m.content === 'string' ? m.content : ''));
      expect(contents.some(c => c.includes('language') && c.includes('Singapore'))).toBe(true);
      expect(contents.some(c => c.includes('Acme Salon'))).toBe(true);
    });

    it('includes memory entries with role mapping', () => {
      const messages = (service as never)['buildMessages'](
        makeParams({
          memory: [
            { role: 'user', content: 'Hi there' },
            { role: 'assistant', content: 'Hello! How can I help?' },
          ],
        }),
      );
      const userMsgs = messages.filter((m: { role: string }) => m.role === 'user');
      const asstMsgs = messages.filter((m: { role: string }) => m.role === 'assistant');
      expect(userMsgs.length).toBeGreaterThanOrEqual(1);
      expect(asstMsgs.length).toBeGreaterThanOrEqual(1);
    });

    it('dedupes the last memory entry when it matches the incoming message', () => {
      const messages = (service as never)['buildMessages'](
        makeParams({
          incomingMessage: 'Hi there',
          memory: [
            { role: 'user', content: 'Hi there' },
          ],
        }),
      );
      const userMessages = messages.filter((m: { role: string }) => m.role === 'user');
      expect(userMessages.length).toBe(1);
    });

    it('drops trailing user rows for inbound batch deduplication', () => {
      const messages = (service as never)['buildMessages'](
        makeParams({
          incomingMessage: 'Line1\n\nLine2\n\nLine3',
          memory: [
            { role: 'user', content: 'Previous' },
            { role: 'user', content: 'Line1' },
            { role: 'user', content: 'Line2' },
            { role: 'user', content: 'Line3' },
          ],
          inboundBatchUserLineCount: 3,
        }),
      );
      const userMessages = messages.filter((m: { role: string }) => m.role === 'user');
      expect(userMessages.length).toBe(2);
    });

    it('passes incoming message through stripGhlImagePlaceholder and buildUserMessageContent', () => {
      const messages = (service as never)['buildMessages'](
        makeParams({ incomingMessage: 'Hello' }),
      );
      const lastUser = messages.filter((m: { role: string }) => m.role === 'user').pop();
      expect(lastUser.content).toBe('Hello');
    });

    it('includes image URL in user message content when present', () => {
      const messages = (service as never)['buildMessages'](
        makeParams({
          incomingMessage: 'Check this',
          incomingImageUrl: 'https://example.com/photo.jpg',
        }),
      );
      const lastUser = messages.filter((m: { role: string }) => m.role === 'user').pop();
      expect(Array.isArray(lastUser.content)).toBe(true);
    });

    it('includes KB context system message when kbContext has entries', () => {
      const messages = (service as never)['buildMessages'](
        makeParams({
          kbContext: [
            { chunkId: 'c1', documentId: 'd1', content: 'We offer balayage and highlights.', title: 'Services', source: 'kb', relevanceScore: 0.9 },
          ],
        }),
      );
      const hasKbBlock = messages.some(
        (m: { role: string; content: string }) =>
          m.role === 'system' && typeof m.content === 'string' && m.content.includes('Source excerpts'),
      );
      expect(hasKbBlock).toBe(true);
    });

    it('injects policy context system message when policyContext is set', () => {
      const messages = (service as never)['buildMessages'](
        makeParams({
          policyContext: {
            latestIntent: 'BOOKING' as never,
            resolvedSelection: null,
            conversationStateSummary: 'collecting_details',
          },
        }),
      );
      const hasPolicy = messages.some(
        (m: { role: string; content: string }) =>
          m.role === 'system' && typeof m.content === 'string' && m.content.includes('Conversation policy'),
      );
      expect(hasPolicy).toBe(true);
    });

    it('injects concise_repeat handling message', () => {
      const messages = (service as never)['buildMessages'](
        makeParams({
          policyContext: {
            latestIntent: 'UNKNOWN' as never,
            resolvedSelection: null,
            conversationStateSummary: 'idle',
            repeatedCustomerMessageHandling: 'concise_repeat',
          },
        }),
      );
      const hasRepeat = messages.some(
        (m: { role: string; content: string }) =>
          m.role === 'system' && typeof m.content === 'string' && m.content.includes('repeated'),
      );
      expect(hasRepeat).toBe(true);
    });

    it('injects confirm_echo handling message', () => {
      const messages = (service as never)['buildMessages'](
        makeParams({
          policyContext: {
            latestIntent: 'UNKNOWN' as never,
            resolvedSelection: null,
            conversationStateSummary: 'idle',
            repeatedCustomerMessageHandling: 'confirm_echo',
          },
        }),
      );
      const hasEcho = messages.some(
        (m: { role: string; content: string }) =>
          m.role === 'system' && typeof m.content === 'string' && m.content.includes('asked the same thing multiple times'),
      );
      expect(hasEcho).toBe(true);
    });

    it('treats a greeting after prior assistant replies as continuation, not first-message routing', () => {
      const messages = (service as never)['buildMessages'](
        makeParams({
          incomingMessage: 'hi',
          memory: [
            { role: 'user', content: 'hi' },
            {
              role: 'assistant',
              content: 'Good afternoon!\n\nCould you please share your name?\n\n1) Leads going cold\n2) Staff too busy',
            },
            { role: 'user', content: '1 2' },
            { role: 'assistant', content: 'Got it. These are common challenges.' },
            { role: 'user', content: 'hi' },
          ],
          policyContext: {
            latestIntent: 'GREETING' as never,
            resolvedSelection: null,
            conversationStateSummary: 'idle',
          },
        }),
      );
      const policyMsg = messages.find(
        (m: { role: string; content: string }) =>
          m.role === 'system' &&
          typeof m.content === 'string' &&
          m.content.includes('Continuation greeting rule'),
      );
      expect(policyMsg?.content as string).toContain('not the first message');
      expect(policyMsg?.content as string).toContain('Do not repeat first-message routing scripts');
    });

    it('adds cadence guidance after several assistant replies to avoid endless questions', () => {
      const messages = (service as never)['buildMessages'](
        makeParams({
          incomingMessage: 'Can this work for a beauty salon?',
          memory: [
            { role: 'user', content: 'I am not sure if I need this' },
            { role: 'assistant', content: 'I understand. What specific challenges do you face?' },
            { role: 'user', content: 'What industries can this work for?' },
            { role: 'assistant', content: 'It can work across several industries. What industry are you in?' },
          ],
          policyContext: {
            latestIntent: 'UNKNOWN' as never,
            resolvedSelection: null,
            conversationStateSummary: 'idle',
          },
        }),
      );
      const policyMsg = messages.find(
        (m: { role: string; content: string }) =>
          m.role === 'system' &&
          typeof m.content === 'string' &&
          m.content.includes('Conversation cadence rule'),
      );
      expect(policyMsg?.content as string).toContain('Answer the latest question directly first');
      expect(policyMsg?.content as string).toContain('Do not end every reply with another open-ended qualifying question');
      expect(policyMsg?.content as string).toContain('softly guide toward booking');
    });

    it('suppresses repeated booking URLs unless the customer asks for the link', () => {
      const messages = (service as never)['buildMessages'](
        makeParams({
          incomingMessage: 'What if the AI gives wrong answers?',
          memory: [
            { role: 'user', content: 'I have sales follow-up issues' },
            {
              role: 'assistant',
              content: 'You can book a session here: https://aisalesbot.pro/booking',
            },
            { role: 'user', content: 'Can this work for a beauty salon?' },
            { role: 'assistant', content: 'Yes, it can help beauty salons with replies and bookings.' },
          ],
          policyContext: {
            latestIntent: 'UNKNOWN' as never,
            resolvedSelection: null,
            conversationStateSummary: 'idle',
          },
        }),
      );
      const policyMsg = messages.find(
        (m: { role: string; content: string }) =>
          m.role === 'system' &&
          typeof m.content === 'string' &&
          m.content.includes('booking/scheduling URL was already sent recently'),
      );
      expect(policyMsg?.content as string).toContain('Do not include the URL again');
    });

    it('truncates memory to last 20 entries', () => {
      const longMem = Array.from({ length: 25 }, (_, i) => ({
        role: i % 2 === 0 ? 'user' as const : 'assistant' as const,
        content: 'Message ' + i,
      }));
      const messages = (service as never)['buildMessages'](
        makeParams({ memory: longMem }),
      );
      expect(messages.length).toBeLessThan(30);
    });
  });

  // ===========================================================================
  // KB Context Building
  // ===========================================================================

  describe('buildKbContextSystemMessage', () => {
    it('formats KB chunks with index labels', () => {
      const msg = (service as never)['buildKbContextSystemMessage'](
        makeParams({
          kbContext: [
            { chunkId: 'c1', documentId: 'd1', content: 'Service A details', title: 'Services', source: 'kb', relevanceScore: 0.9 },
            { chunkId: 'c2', documentId: 'd2', content: 'Pricing info', title: 'Pricing', source: 'kb', relevanceScore: 0.8 },
          ],
          policyContext: { latestIntent: 'UNKNOWN' as never, resolvedSelection: null, conversationStateSummary: 'idle' },
        }),
      );
      expect(msg.role).toBe('system');
      const content = msg.content as string;
      expect(content).toContain('[1]');
      expect(content).toContain('[2]');
      expect(content).toContain('Service A details');
      expect(content).toContain('Pricing info');
    });

    it('MENU intent includes at most 4 items rule and section guidance', () => {
      const msg = (service as never)['buildKbContextSystemMessage'](
        makeParams({
          kbContext: [
            { chunkId: 'c1', documentId: 'd1', content: 'Service A', title: '', source: 'kb', relevanceScore: 0.9 },
          ],
          policyContext: {
            latestIntent: 'MENU' as never,
            resolvedSelection: { selectedLabel: 'A', selectedText: 'Haircuts', selectionId: 's1' },
            conversationStateSummary: 'menu_shown',
            menuSelectionActive: true,
          },
        }),
      );
      expect(msg.content as string).toContain('at most **4** items');
    });

    it('injects suppressColourRecommendations scope rule', () => {
      const msg = (service as never)['buildKbContextSystemMessage'](
        makeParams({
          kbContext: [
            { chunkId: 'c1', documentId: 'd1', content: 'Hair services', title: 'Hair', source: 'kb', relevanceScore: 0.9 },
          ],
          policyContext: {
            latestIntent: 'UNKNOWN' as never,
            resolvedSelection: null,
            conversationStateSummary: 'idle',
            suppressColourRecommendations: true,
          },
        }),
      );
      expect(msg.content as string).toContain('colour');
    });

    it('includes multi-line turn rules when combinedInboundMessageCount > 1', () => {
      const msg = (service as never)['buildKbContextSystemMessage'](
        makeParams({
          kbContext: [
            { chunkId: 'c1', documentId: 'd1', content: 'Info', title: 'Facts', source: 'kb', relevanceScore: 0.9 },
          ],
          policyContext: {
            latestIntent: 'UNKNOWN' as never,
            resolvedSelection: null,
            conversationStateSummary: 'idle',
            combinedInboundMessageCount: 3,
          },
        }),
      );
      expect(msg.content as string).toContain('sent multiple short messages');
    });
  });

  // ===========================================================================
  // Vision Model Selection
  // ===========================================================================

  describe('vision model selection', () => {
    it('opens the vision path when incomingImageUrl is set', async () => {
      setupSupabaseStubs({
        agencyId: 'a1',
        activeProvider: 'OPENAI',
        providerRow: { provider: 'OPENAI', api_key: 'sk-valid' },
      });
      mockImageResolveForVision.mockResolvedValue('https://resolved.example.com/img.jpg');
      mockResolveGenerationModel.mockReturnValue({
        model: 'gpt-4o',
        coercedFromStored: false,
        coercedFromRequest: false,
      });
      jestGlobal.spyOn(service as never, 'openAiMultimodalChatCompletion').mockResolvedValue({
        content: 'Vision response',
        model: 'gpt-4o',
        totalTokens: 30,
      });
      const result = await service.generateDraft(
        makeParams({ incomingImageUrl: 'https://example.com/img.jpg' }),
      );
      expect(result.content).toBe('Vision response');
      expect(result.generationProvider).toBe('OPENAI');
    });
  });

  // ===========================================================================
  // Error Handling
  // ===========================================================================

  describe('error handling', () => {
    it('returns generation_failed on top-level error in generateDraft', async () => {
      setupSupabaseStubs({ agencyId: null });
      mockSupabase.from.mockImplementation(() => {
        throw new Error('DB connection failed');
      });
      const result = await service.generateDraft(makeParams());
      expect(result.skipReason).toBe('generation_failed');
      expect(result.content).toBeNull();
    });

    it('returns null content from MiniMax error and falls back to OpenAI', async () => {
      setupSupabaseStubs({
        agencyId: 'a1',
        activeProvider: 'MINIMAX',
        providerRow: { provider: 'MINIMAX', api_key: 'mini-key' },
        openaiRow: { provider: 'OPENAI', api_key: 'sk-valid-fallback' },
      });
      mockMinimaxChatCompletion.mockRejectedValue(new Error('MiniMax HTTP 500'));
      const result = await service.generateDraft(makeParams());
      expect(result.content).toBe('OpenAI reply');
    });

    it('returns generation_failed when OpenAI adapter throws', async () => {
      setupSupabaseStubs({
        agencyId: 'a1',
        activeProvider: 'OPENAI',
        providerRow: { provider: 'OPENAI', api_key: 'sk-valid' },
      });
      mockOpenAiGenerate.mockRejectedValue(new Error('OpenAI HTTP 500'));
      const result = await service.generateDraft(makeParams());
      expect(result.skipReason).toBe('generation_failed');
      expect(result.content).toBeNull();
    });

    it('returns generation_failed when both primary and fallback fail', async () => {
      setupSupabaseStubs({
        agencyId: 'a1',
        activeProvider: 'MINIMAX',
        providerRow: { provider: 'MINIMAX', api_key: 'mini-key' },
        openaiRow: { provider: 'OPENAI', api_key: 'sk-valid-fallback' },
      });
      mockMinimaxChatCompletion.mockRejectedValue(new Error('MiniMax error'));
      mockOpenAiGenerate.mockRejectedValue(new Error('OpenAI error'));
      const result = await service.generateDraft(makeParams());
      expect(result.skipReason).toBe('generation_failed');
      expect(result.content).toBeNull();
    });
  });

  // ===========================================================================
  // Customer-Facing Sanitization
  // ===========================================================================

  describe('customer-facing sanitization', () => {
    it('returns null when generated content is empty/whitespace after sanitization', async () => {
      setupSupabaseStubs({
        agencyId: 'a1',
        activeProvider: 'OPENAI',
        providerRow: { provider: 'OPENAI', api_key: 'sk-valid' },
      });
      mockOpenAiGenerate.mockResolvedValue({
        content: '   ',
        usage: { totalTokens: 0 },
        model: 'gpt-4o-mini',
      });
      const result = await service.generateDraft(makeParams());
      expect(result.content).toBeNull();
    });

    it('keeps non-empty content after sanitization', async () => {
      setupSupabaseStubs({
        agencyId: 'a1',
        activeProvider: 'OPENAI',
        providerRow: { provider: 'OPENAI', api_key: 'sk-valid' },
      });
      mockOpenAiGenerate.mockResolvedValue({
        content: 'Hello, how can I help?',
        usage: { totalTokens: 20 },
        model: 'gpt-4o-mini',
      });
      const result = await service.generateDraft(makeParams());
      expect(result.content).toBe('Hello, how can I help?');
    });

    it('treats newlines-only content as null after sanitization', async () => {
      setupSupabaseStubs({
        agencyId: 'a1',
        activeProvider: 'OPENAI',
        providerRow: { provider: 'OPENAI', api_key: 'sk-valid' },
      });
      mockOpenAiGenerate.mockResolvedValue({
        content: '\n \t  \n',
        usage: { totalTokens: 0 },
        model: 'gpt-4o-mini',
      });
      const result = await service.generateDraft(makeParams());
      expect(result.content).toBeNull();
    });

    it('strips response meta (bracketed content) via sanitizeCustomerFacing', async () => {
      setupSupabaseStubs({
        agencyId: 'a1',
        activeProvider: 'OPENAI',
        providerRow: { provider: 'OPENAI', api_key: 'sk-valid' },
      });
      mockOpenAiGenerate.mockResolvedValue({
        content: 'Here is your answer.',
        usage: { totalTokens: 20 },
        model: 'gpt-4o-mini',
      });
      const result = await service.generateDraft(makeParams());
      expect(result.content).toBe('Here is your answer.');
    });
  });

  // ===========================================================================
  // Vision Image Fetch Resolution
  // ===========================================================================

  describe('vision image fetch resolution', () => {
    it('resolves incoming image URL through image fetch service', async () => {
      setupSupabaseStubs({
        agencyId: 'a1',
        activeProvider: 'OPENAI',
        providerRow: { provider: 'OPENAI', api_key: 'sk-valid' },
      });
      mockImageResolveForVision.mockResolvedValue('https://resolved.example.com/img.jpg');
      await service.generateDraft(
        makeParams({ incomingImageUrl: 'https://raw.example.com/img.jpg' }),
      );
      expect(mockImageResolveForVision).toHaveBeenCalledWith({
        tenantId: 't1',
        mediaUrl: 'https://raw.example.com/img.jpg',
      });
    });
  });

  // ===========================================================================
  // Business Scenario: Pricing Question
  // ===========================================================================

  describe('pricing question with KB context', () => {
    it('includes KB context when user asks about pricing', () => {
      const messages = (service as never)['buildMessages'](
        makeParams({
          incomingMessage: 'How much does a haircut cost?',
          kbContext: [
            { chunkId: 'c1', documentId: 'd1', content: 'Haircut: $40. Balayage: $200.', title: 'Pricing', source: 'kb', relevanceScore: 0.95 },
          ],
        }),
      );
      const hasKbBlock = messages.some(
        (m: { role: string; content: string }) =>
          m.role === 'system' && typeof m.content === 'string' && m.content.includes('Source excerpts'),
      );
      expect(hasKbBlock).toBe(true);
      const kbMsg = messages.find(
        (m: { role: string; content: string }) =>
          m.role === 'system' && typeof m.content === 'string' && m.content.includes('Source excerpts'),
      );
      expect((kbMsg!.content as string)).toContain('Haircut: $40');
      expect((kbMsg!.content as string)).toContain('Do not invent prices');
    });

    it('grounds pricing response in KB content with anti-hallucination rule', () => {
      const msg = (service as never)['buildKbContextSystemMessage'](
        makeParams({
          kbContext: [
            { chunkId: 'c1', documentId: 'd1', content: 'Service costs', title: 'Prices', source: 'kb', relevanceScore: 0.9 },
          ],
          policyContext: { latestIntent: 'PRICE' as never, resolvedSelection: null, conversationStateSummary: 'idle' },
        }),
      );
      expect(msg.content as string).toContain('Do not invent prices');
      expect(msg.content as string).toContain('Keep the reply to one or two short paragraphs');
    });
  });

  // ===========================================================================
  // Business Scenario: Booking Question
  // ===========================================================================

  describe('booking question with policy context', () => {
    it('injects booking rule when booking intent is detected', () => {
      const messages = (service as never)['buildMessages'](
        makeParams({
          incomingMessage: 'I want to book an appointment',
          policyContext: {
            latestIntent: 'BOOKING' as never,
            resolvedSelection: null,
            conversationStateSummary: 'booking_in_progress',
          },
        }),
      );
      const hasBookingRule = messages.some(
        (m: { role: string; content: string }) =>
          m.role === 'system' && typeof m.content === 'string' && m.content.includes('Booking rule'),
      );
      expect(hasBookingRule).toBe(true);
    });

    it('booking policy prevents hallucinated time slots', () => {
      const messages = (service as never)['buildMessages'](
        makeParams({
          incomingMessage: 'Can I come in tomorrow at 3pm?',
          policyContext: {
            latestIntent: 'BOOKING' as never,
            resolvedSelection: null,
            conversationStateSummary: 'asking_slot',
          },
        }),
      );
      const bookingMsg = messages.find(
        (m: { role: string; content: string }) =>
          m.role === 'system' && typeof m.content === 'string' && m.content.includes('Booking rule'),
      );
      expect((bookingMsg!.content as string)).toMatch(/Never invent reservation time slots|no booking system data/);
    });
  });

  // ===========================================================================
  // Business Scenario: Complaint / Escalation
  // ===========================================================================

  describe('complaint intent preserves safe tone', () => {
    it('injects complaint rule with empathetic and safe language', () => {
      const messages = (service as never)['buildMessages'](
        makeParams({
          incomingMessage: 'I am really unhappy with the service',
          policyContext: {
            latestIntent: 'COMPLAINT' as never,
            resolvedSelection: null,
            conversationStateSummary: 'complaint_received',
          },
        }),
      );
      const hasComplaintRule = messages.some(
        (m: { role: string; content: string }) =>
          m.role === 'system' && typeof m.content === 'string' && m.content.includes('Complaint rule'),
      );
      expect(hasComplaintRule).toBe(true);
    });

    it('complaint policy prohibits internal complaint procedures in customer text', () => {
      const messages = (service as never)['buildMessages'](
        makeParams({
          incomingMessage: 'This service was horrible',
          policyContext: {
            latestIntent: 'COMPLAINT' as never,
            resolvedSelection: null,
            conversationStateSummary: 'complaint_received',
          },
        }),
      );
      const complaintMsg = messages.find(
        (m: { role: string; content: string }) =>
          m.role === 'system' && typeof m.content === 'string' && m.content.includes('Complaint rule'),
      );
      expect((complaintMsg!.content as string)).toContain('Be empathetic');
      expect((complaintMsg!.content as string)).toContain('Never paste');
    });
  });

  // ===========================================================================
  // Business Scenario: Empty KB Context
  // ===========================================================================

  describe('empty KB context - no hallucination', () => {
    it('does not inject KB context system message when kbContext is empty', () => {
      const messages = (service as never)['buildMessages'](
        makeParams({
          incomingMessage: 'Do you offer gel nails?',
          kbContext: [],
        }),
      );
      const hasKbBlock = messages.some(
        (m: { role: string; content: string }) =>
          m.role === 'system' && typeof m.content === 'string' && m.content.includes('Source excerpts'),
      );
      expect(hasKbBlock).toBe(false);
    });

    it('policy context alone does not carry hallucinated KB content', () => {
      const messages = (service as never)['buildMessages'](
        makeParams({
          incomingMessage: 'Tell me about your services',
          kbContext: [],
          policyContext: {
            latestIntent: 'MENU' as never,
            resolvedSelection: null,
            conversationStateSummary: 'idle',
          },
        }),
      );
      const msgContents = messages
        .filter(m => typeof m.content === 'string')
        .map(m => m.content as string);
      expect(msgContents.some(c => c.includes('Source excerpts'))).toBe(false);
    });

    it('buildKbContextSystemMessage still includes anti-invention rule even with empty KB', () => {
      const msg = (service as never)['buildKbContextSystemMessage'](
        makeParams({
          kbContext: [],
          policyContext: { latestIntent: 'UNKNOWN' as never, resolvedSelection: null, conversationStateSummary: 'idle' },
        }),
      );
      expect(msg.content as string).toContain('Do not invent');
    });

    it('injects honesty rule when KB context is empty and incoming message is non-empty', () => {
      const messages = (service as never)['buildMessages'](
        makeParams({
          incomingMessage: 'Do you offer gel nails?',
          kbContext: [],
        }),
      );
      const hasHonestyRule = messages.some(
        (m: { role: string; content: string }) =>
          m.role === 'system' && typeof m.content === 'string' &&
          m.content.includes('No knowledge-base data is available'),
      );
      expect(hasHonestyRule).toBe(true);
    });

    it('honesty rule is not injected when KB context is present', () => {
      const messages = (service as never)['buildMessages'](
        makeParams({
          incomingMessage: 'What services do you offer?',
          kbContext: [
            { chunkId: 'c1', documentId: 'd1', content: 'We offer haircuts and colouring.', title: 'Services', source: 'kb', relevanceScore: 0.9 },
          ],
        }),
      );
      const hasHonestyRule = messages.some(
        (m: { role: string; content: string }) =>
          m.role === 'system' && typeof m.content === 'string' &&
          m.content.includes('No knowledge-base data is available'),
      );
      expect(hasHonestyRule).toBe(false);
    });
  });

  // ===========================================================================
  // Business Scenario: Customer-Facing Sanitization
  // ===========================================================================

  describe('customer-facing sanitization strips internal content', () => {
    it('sanitizeCustomerFacing strips <think> blocks from model output', async () => {
      setupSupabaseStubs({
        agencyId: 'a1',
        activeProvider: 'OPENAI',
        providerRow: { provider: 'OPENAI', api_key: 'sk-valid' },
      });
      mockOpenAiGenerate.mockResolvedValue({
        content: '<think>I should check hours</think>\nWe are open 9am-5pm.',
        usage: { totalTokens: 30 },
        model: 'gpt-4o-mini',
      });
      const result = await service.generateDraft(makeParams());
      expect(result.content).not.toContain('think');
      expect(result.content).not.toContain('I should check hours');
      expect(result.content).toContain('We are open 9am-5pm');
    });

    it('sanitizeCustomerFacing strips customer-facing meta lines', async () => {
      setupSupabaseStubs({
        agencyId: 'a1',
        activeProvider: 'OPENAI',
        providerRow: { provider: 'OPENAI', api_key: 'sk-valid' },
      });
      mockOpenAiGenerate.mockResolvedValue({
        content: 'Source: internal-doc-123\nWe offer balayage starting at $150.',
        usage: { totalTokens: 25 },
        model: 'gpt-4o-mini',
      });
      const result = await service.generateDraft(makeParams());
      expect(result.content).not.toContain('Source:');
      expect(result.content).toContain('balayage');
    });

    it('returns null when all content is stripped as internal', async () => {
      setupSupabaseStubs({
        agencyId: 'a1',
        activeProvider: 'OPENAI',
        providerRow: { provider: 'OPENAI', api_key: 'sk-valid' },
      });
      mockOpenAiGenerate.mockResolvedValue({
        content: '<think>internal reasoning only</think>',
        usage: { totalTokens: 5 },
        model: 'gpt-4o-mini',
      });
      const result = await service.generateDraft(makeParams());
      expect(result.content).toBeNull();
    });
  });

  // ===========================================================================
  // Business Scenario: WhatsApp-Friendly Concise Replies
  // ===========================================================================

  describe('WhatsApp-friendly concise tone', () => {
    it('non-MENU KB context message includes concise paragraph rule', () => {
      const msg = (service as never)['buildKbContextSystemMessage'](
        makeParams({
          kbContext: [
            { chunkId: 'c1', documentId: 'd1', content: 'Hours: Mon-Fri 9-5', title: 'Hours', source: 'kb', relevanceScore: 0.9 },
          ],
          policyContext: { latestIntent: 'BUSINESS_HOURS' as never, resolvedSelection: null, conversationStateSummary: 'idle' },
        }),
      );
      expect(msg.content as string).toContain('one or two short paragraphs');
    });

    it('KB excerpts are labeled as source material only, not a script', () => {
      const msg = (service as never)['buildKbContextSystemMessage'](
        makeParams({
          kbContext: [
            { chunkId: 'c1', documentId: 'd1', content: 'About us', title: 'Intro', source: 'kb', relevanceScore: 0.5 },
          ],
          policyContext: { latestIntent: 'UNKNOWN' as never, resolvedSelection: null, conversationStateSummary: 'idle' },
        }),
      );
      expect(msg.content as string).toContain('source material only');
      expect(msg.content as string).toContain('not a script to paste');
    });

    it('multi-line turn includes ordered priority and only-facts rule', () => {
      const msg = (service as never)['buildKbContextSystemMessage'](
        makeParams({
          kbContext: [
            { chunkId: 'c1', documentId: 'd1', content: 'Info', title: '', source: 'kb', relevanceScore: 0.9 },
          ],
          policyContext: {
            latestIntent: 'UNKNOWN' as never,
            resolvedSelection: null,
            conversationStateSummary: 'idle',
            combinedInboundMessageCount: 2,
          },
        }),
      );
      expect(msg.content as string).toContain('sent multiple short messages');
      expect(msg.content as string).toContain('Answer each distinct question');
    });
  });
});
