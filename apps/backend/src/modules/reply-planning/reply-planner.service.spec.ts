import { jest as jestGlobal } from '@jest/globals';

import { ReplyPlannerService } from './reply-planner.service';
import { GenerationService } from '../generation/generation.service';

// Mock GenerationService to always return null → forces deterministic fallback
jestGlobal.mock('../generation/generation.service', () => ({
  GenerationService: jestGlobal.fn().mockImplementation(() => ({
    generateDraft: jestGlobal.fn(async () => ({
      content: null,
      skipReason: 'no_provider' as const,
    })),
  })),
}));

describe('ReplyPlannerService', () => {
  let service: ReplyPlannerService;
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  let mockGen: any;

  beforeEach(() => {
    jestGlobal.clearAllMocks();
    mockGen = {
      generateDraft: jestGlobal.fn(async () => ({
        content: null,
        skipReason: 'no_provider' as const,
      })),
    };
    service = new ReplyPlannerService(mockGen);
  });

  describe('formatIntoBubbles', () => {
    const format = (text: string) => (service as never)['formatIntoBubbles'](text);

    it('returns empty array for empty string', () => {
      expect(format('')).toEqual([]);
    });

    it('returns empty array for whitespace only', () => {
      expect(format('   \n  \n  ')).toEqual([]);
    });

    it('preserves short paragraphs as single bubbles', () => {
      const text = 'Hello, how can I help you today?';
      const bubbles = format(text);
      expect(bubbles.length).toBe(1);
      expect(bubbles[0]!.text).toBe(text);
    });

    it('respects MAX_BUBBLE_CHARS = 320', () => {
      const long = 'A'.repeat(400);
      const bubbles = format(long);
      for (const b of bubbles) {
        expect(b.text.length).toBeLessThanOrEqual(320);
      }
    });

    it('strips markdown bold', () => {
      const bubbles = format('**bold text** and normal');
      expect(bubbles[0]!.text).not.toContain('**');
      expect(bubbles[0]!.text).toContain('bold text');
    });

    it('strips markdown italic', () => {
      const bubbles = format('*italic text* and normal');
      expect(bubbles[0]!.text).not.toContain('*italic*');
    });

    it('strips markdown links', () => {
      const bubbles = format('[link text](https://example.com) here');
      expect(bubbles[0]!.text).not.toContain('[');
      expect(bubbles[0]!.text).toContain('link text');
    });
  });

  describe('buildHandoverPlan', () => {
    it('returns HANDOVER status with no bubbles', () => {
      const plan = (service as never)['buildHandoverPlan']({
        recommendedModel: 'gpt-4o',
        responseMode: 'handover',
        handoverRecommended: true,
        confidence: 0.9,
        reasoning: 'test',
        draftReply: null,
        tagsSuggested: [],
        bookingIntentDetected: false,
      });
      expect(plan.planStatus).toBe('HANDOVER');
      expect(plan.bubbles).toEqual([]);
      expect(plan.handoverRecommended).toBe(true);
      expect(plan.suggestedActions[0]!.type).toBe('ESCALATE');
    });
  });

  describe('buildPlaceholderDraft', () => {
    it('returns KB-first content when chunks present', () => {
      const draft = (service as never)['buildPlaceholderDraft'](
        { responseMode: 'standard', draftReply: null, confidence: 0.5, reasoning: '', recommendedModel: 'gpt-4o', handoverRecommended: false, tagsSuggested: [], bookingIntentDetected: false },
        [{ chunkId: 'c1', documentId: 'd1', content: 'Our hours are 9am-5pm', title: 'Business Hours', source: 'website', relevanceScore: 0.9, metadata: {} }],
        []
      );
      expect(draft).toContain('Our hours are 9am-5pm');
      expect(draft).toContain('Business Hours');
    });

    it('returns mode-based ack for fast mode with no KB', () => {
      const draft = (service as never)['buildPlaceholderDraft'](
        { responseMode: 'fast', draftReply: null, confidence: 0.5, reasoning: '', recommendedModel: 'gpt-4o', handoverRecommended: false, tagsSuggested: [], bookingIntentDetected: false },
        [],
        []
      );
      expect(draft).toContain('Got it');
    });

    it('returns generic message when nothing available', () => {
      const draft = (service as never)['buildPlaceholderDraft'](
        { responseMode: 'standard', draftReply: null, confidence: 0.5, reasoning: '', recommendedModel: 'gpt-4o', handoverRecommended: false, tagsSuggested: [], bookingIntentDetected: false },
        [],
        []
      );
      expect(draft.length).toBeGreaterThan(0);
    });
  });

  describe('planReply', () => {
    it('returns HANDOVER plan when handoverRecommended=true', async () => {
      const result = await service.planReply({
        tenantId: 't1',
        conversationId: 'c1',
        routing: {
          recommendedModel: 'gpt-4o',
          responseMode: 'standard',
          handoverRecommended: true,
          confidence: 0.9,
          reasoning: 'test',
          draftReply: null,
          tagsSuggested: [],
          bookingIntentDetected: false,
        },
        kbChunks: [],
        memory: [],
        systemPrompt: '',
        channel: 'WHATSAPP',
      });
      expect(result.planStatus).toBe('HANDOVER');
      expect(result.bubbles).toEqual([]);
    });

    it('returns PLANNED plan with bubbles when not handover', async () => {
      const result = await service.planReply({
        tenantId: 't1',
        conversationId: 'c1',
        routing: {
          recommendedModel: 'gpt-4o',
          responseMode: 'standard',
          handoverRecommended: false,
          confidence: 0.8,
          reasoning: 'test',
          draftReply: null,
          tagsSuggested: [],
          bookingIntentDetected: false,
        },
        kbChunks: [],
        memory: [{ role: 'user' as const, sender: 'user', messageType: 'text' as const, content: 'Hello', timestamp: new Date().toISOString() }],
        systemPrompt: 'You are a helpful assistant.',
        channel: 'WHATSAPP',
      });
      expect(result.planStatus).toBe('PLANNED');
      expect(result.bubbles.length).toBeGreaterThan(0);
      expect(result.draftProvenance).toBe('placeholder_fallback');
      expect(result.draftFallbackReason).toBe('no_provider');
    });

    it('marks live_generation when generateDraft returns usable content', async () => {
      mockGen.generateDraft.mockResolvedValueOnce({ content: 'Hello from the model.' });
      const result = await service.planReply({
        tenantId: 't1',
        conversationId: 'c1',
        routing: {
          recommendedModel: 'gpt-4o',
          responseMode: 'standard',
          handoverRecommended: false,
          confidence: 0.8,
          reasoning: 'test',
          draftReply: null,
          tagsSuggested: [],
          bookingIntentDetected: false,
        },
        kbChunks: [],
        memory: [],
        systemPrompt: 'You are a helpful assistant.',
        channel: 'WHATSAPP',
      });
      expect(result.draftProvenance).toBe('live_generation');
      expect(result.draftFallbackReason).toBeUndefined();
    });
  });

  describe('stripMarkdown', () => {
    const strip = (text: string) => (service as never)['stripMarkdown'](text);

    it('removes bold', () => { expect(strip('**hello**')).toBe('hello'); });
    it('removes italic', () => { expect(strip('*hello*')).toBe('hello'); });
    it('removes strikethrough', () => { expect(strip('~~hello~~')).toBe('hello'); });
    it('removes headings', () => { expect(strip('# Heading')).toBe('Heading'); });
    it('collapses multiple blank lines', () => { expect(strip('hello\n\n\n\nworld')).toBe('hello\n\nworld'); });
  });
});
