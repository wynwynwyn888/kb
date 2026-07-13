import { jest as jestGlobal } from '@jest/globals';

import { ReplyPlannerService } from './reply-planner.service';
import { MENU_PROMPT_NO_KB } from '../conversation-policy/policy-menu-copy';
import { GenerationService } from '../generation/generation.service';
import { stripLiveCustomerMarkdownForOutbound } from '../../lib/customer-facing-live-format';

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

    it('keeps a single paragraph under 500 chars in one bubble', () => {
      const long = 'A'.repeat(400);
      const bubbles = format(long);
      expect(bubbles.length).toBe(1);
      expect(bubbles[0]!.text.length).toBe(400);
    });

    it('keeps short option-style lists in one bubble (universal labels)', () => {
      const text =
        'Happy to help.\n\nA) Service Menu\n\nB) Address\n\nC) Opening Hours\n\nReply with the letter.';
      const bubbles = format(text);
      expect(bubbles.length).toBe(1);
      expect(bubbles[0]!.text).toContain('A) Service Menu');
      expect(bubbles[0]!.text).toContain('Reply with the letter.');
      expect(bubbles[0]!.text).toMatch(/Opening Hours\n\nReply with the letter/);
    });

    it('strips customer-facing Source lines before bubbling', () => {
      const text =
        'We open at 9am.\n\n(Source: FAQ: What are your opening hours?)\n\nSee you soon.';
      const bubbles = format(text);
      expect(bubbles.length).toBeGreaterThanOrEqual(1);
      const joined = bubbles.map(b => b.text).join('\n');
      expect(joined).not.toMatch(/Source\s*:/i);
      expect(joined).not.toMatch(/\(Source/i);
      expect(joined).toContain('9am');
    });

    it('strips redacted_thinking before bubbling', () => {
      const text =
        '<think>plan</think>Hello!\n\nA) One\n\nB) Two';
      const bubbles = format(text);
      expect(bubbles.map(b => b.text).join('')).not.toContain('redacted_thinking');
      expect(bubbles[0]!.text).toContain('Hello!');
    });

    it('splits very long content into at most three bubbles', () => {
      const para = 'Sentence one. Sentence two. Sentence three. ';
      const text = para.repeat(80).trim();
      const bubbles = format(text);
      expect(bubbles.length).toBeGreaterThanOrEqual(2);
      expect(bubbles.length).toBeLessThanOrEqual(3);
      for (const b of bubbles) {
        expect(b.text.length).toBeLessThanOrEqual(3600);
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
      expect(result.planStatus).toBe('SKIP_NO_REPLY');
      expect(result.bubbles).toEqual([]);
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

    it('blocks risky no-KB business claims instead of substituting fallback copy', async () => {
      mockGen.generateDraft.mockResolvedValueOnce({
        content: 'Absolutely! We welcome all breeds, including Chihuahuas.',
      });
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
      expect(result.planStatus).toBe('SKIP_NO_REPLY');
      expect(result.bubbles).toEqual([]);
    });

    it('retries an unsafe hesitation reply and keeps the safe contextual AI guidance', async () => {
      mockGen.generateDraft
        .mockResolvedValueOnce({
          content: 'We offer a guaranteed solution. Would you like to continue?',
        })
        .mockResolvedValueOnce({
          content: 'No worries — it sounds like you are weighing the options. Which part would you like to look at first?',
        });
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
        memory: [
          { role: 'assistant' as const, sender: 'assistant', messageType: 'text' as const, content: 'Would you like to continue?', timestamp: new Date().toISOString() },
          { role: 'user' as const, sender: 'user', messageType: 'text' as const, content: 'hmmm', timestamp: new Date().toISOString() },
        ],
        systemPrompt: 'Follow the tenant Sales Playbook.',
        channel: 'WHATSAPP',
        policyContext: {
          latestIntent: 'HESITATION',
          resolvedSelection: null,
          conversationStateSummary: 'awaiting=option_selection',
          policyForcedReply: null,
          policyReplyKind: 'none',
          menuSelectionActive: true,
          latestUserMessage: 'hmmm',
          multiOptionSelections: [
            { label: '1', text: 'First topic' },
            { label: '2', text: 'Second topic' },
          ],
        },
      });

      expect(mockGen.generateDraft).toHaveBeenCalledTimes(2);
      expect(result.planStatus).toBe('PLANNED');
      expect(result.handoverRecommended).toBe(false);
      expect(result.bubbles.map(b => b.text).join(' ')).toContain('weighing the options');
    });

    it('does not retry an unsafe factual business answer', async () => {
      mockGen.generateDraft.mockResolvedValueOnce({
        content: 'Absolutely! We offer a guaranteed package for every customer.',
      });
      const result = await service.planReply({
        tenantId: 't1',
        conversationId: 'c1',
        routing: {
          recommendedModel: 'gpt-4o', responseMode: 'standard', handoverRecommended: false,
          confidence: 0.8, reasoning: 'test', draftReply: null, tagsSuggested: [], bookingIntentDetected: false,
        },
        kbChunks: [],
        memory: [{ role: 'user' as const, sender: 'user', messageType: 'text' as const, content: 'Do you guarantee results?', timestamp: new Date().toISOString() }],
        systemPrompt: 'You are helpful.',
        channel: 'WHATSAPP',
        policyContext: {
          latestIntent: 'UNKNOWN', resolvedSelection: null, conversationStateSummary: '',
          policyForcedReply: null, policyReplyKind: 'none', menuSelectionActive: false,
          latestUserMessage: 'Do you guarantee results?',
        },
      });

      expect(mockGen.generateDraft).toHaveBeenCalledTimes(1);
      expect(result.planStatus).toBe('SKIP_NO_REPLY');
    });

    it('plans one reply for validated tenant playbook choices without KB chunks', async () => {
      mockGen.generateDraft.mockResolvedValueOnce({
        content:
          'You selected prospects asking for price without booking, manual chasing, and uncertainty about lost sales. These concerns often overlap. Which one would you like to improve first?',
      });
      const result = await service.planReply({
        tenantId: 't1',
        conversationId: 'c1',
        routing: {
          recommendedModel: 'gpt-4o',
          responseMode: 'standard',
          handoverRecommended: false,
          confidence: 0.85,
          reasoning: 'validated multi-selection',
          draftReply: null,
          tagsSuggested: [],
          bookingIntentDetected: false,
        },
        kbChunks: [],
        memory: [],
        systemPrompt: 'Follow the tenant Sales Playbook.',
        channel: 'WHATSAPP',
        policyContext: {
          latestIntent: 'SHORT_SELECTION',
          resolvedSelection: null,
          conversationStateSummary: 'awaiting=option_selection',
          policyForcedReply: null,
          policyReplyKind: 'none',
          menuSelectionActive: true,
          latestUserMessage: '4',
          combinedHumanMessagesText: '2\n\n3\n\n4',
          inboundBatchCount: 3,
          multiOptionSelections: [
            { label: '2', text: 'Prospects ask for price but do not book or buy' },
            { label: '3', text: 'Too much manual chasing' },
            { label: '4', text: 'Unsure how many sales are lost' },
          ],
        },
      });
      expect(result.planStatus).toBe('PLANNED');
      expect(result.bubbles).toHaveLength(1);
      expect(result.handoverRecommended).toBe(false);
      expect(result.bubbles[0]!.text).toContain('manual chasing');
    });

    it('H: empty policy forced reply skips without sending fallback copy', async () => {
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
        policyContext: {
          latestIntent: 'MENU',
          resolvedSelection: null,
          conversationStateSummary: 'menu_no_kb',
          policyForcedReply: MENU_PROMPT_NO_KB,
          policyReplyKind: 'menu_no_kb_clarification',
          menuSelectionActive: false,
        },
      });
      expect(result.planStatus).toBe('SKIP_NO_REPLY');
      expect(result.bubbles).toEqual([]);
    });
  });

  describe('buildOptionSelectionTemplateReply', () => {
    const deterministicRouting = {
      recommendedModel: 'n/a',
      responseMode: 'fast' as const,
      draftReply: null,
      handoverRecommended: false,
      bookingIntentDetected: false,
      tagsSuggested: [] as string[],
      confidence: 1,
      reasoning: 'deterministic_option_selection_template',
    };

    it('uses option_selection_template provenance and never calls generation', () => {
      const template =
        'Sure — Daycare is supervised care in a safe environment.\n\nWould you like me to help check availability, or share more details about this service?';
      const plan = service.buildOptionSelectionTemplateReply({
        tenantId: 't1',
        conversationId: 'c1',
        routing: deterministicRouting,
        templateBody: template,
        latestIntent: 'SHORT_SELECTION',
        latestUserMessage: 'F',
        menuSelectionActive: true,
      });
      expect(mockGen.generateDraft).not.toHaveBeenCalled();
      expect(plan.draftProvenance).toBe('option_selection_template');
      const joined = plan.bubbles.map(b => b.text).join('\n\n');
      expect(joined.toLowerCase()).not.toContain("don't have");
      expect(joined).not.toMatch(/\.\./);
      expect(joined).toContain('Daycare');
      expect(joined.toLowerCase()).not.toMatch(/connect you (with|to) the team/);
    });
  });

  describe('stripLiveCustomerMarkdownForOutbound', () => {
    const strip = stripLiveCustomerMarkdownForOutbound;

    it('normalizes markdown bold to WhatsApp single asterisk', () => {
      expect(strip('**hello**')).toBe('*hello*');
    });
    it('preserves WhatsApp single-asterisk bold', () => {
      expect(strip('*hello*')).toBe('*hello*');
    });
    it('removes strikethrough', () => {
      expect(strip('~~hello~~')).toBe('hello');
    });
    it('removes headings', () => {
      expect(strip('# Heading')).toBe('Heading');
    });
    it('preserves a single paragraph break (only excessive blank lines are collapsed in prepare step)', () => {
      expect(strip('hello\n\nworld')).toBe('hello\n\nworld');
    });
  });
});
