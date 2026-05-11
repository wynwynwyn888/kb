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

  describe('buildPlaceholderDraft', () => {
    it('returns KB-first content when chunks present (no source label in draft)', () => {
      const draft = (service as never)['buildPlaceholderDraft'](
        { responseMode: 'standard', draftReply: null, confidence: 0.5, reasoning: '', recommendedModel: 'gpt-4o', handoverRecommended: false, tagsSuggested: [], bookingIntentDetected: false },
        [{ chunkId: 'c1', documentId: 'd1', content: 'Our hours are 9am-5pm', title: 'Business Hours', source: 'website', relevanceScore: 0.9, metadata: {} }],
        []
      );
      expect(draft).toContain('Our hours are 9am-5pm');
      expect(draft).not.toMatch(/Source\s*:/i);
      expect(draft).not.toContain('Business Hours');
    });

    it('polishes weekday/weekend FAQ lines in KB fallback', () => {
      const draft = (service as never)['buildPlaceholderDraft'](
        {
          responseMode: 'standard',
          draftReply: null,
          confidence: 0.5,
          reasoning: '',
          recommendedModel: 'gpt-4o',
          handoverRecommended: false,
          tagsSuggested: [],
          bookingIntentDetected: false,
        },
        [
          {
            chunkId: 'c1',
            documentId: 'd1',
            content: 'Weekdays 9am-11pm\nWeekends 9am-12am',
            title: 'FAQ: Hours',
            source: 'faq',
            relevanceScore: 0.95,
            metadata: {},
          },
        ],
        [],
      );
      expect(draft).toMatch(/We're open from/i);
      expect(draft.toLowerCase()).toContain('weekday');
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

    it('uses generic menu clarification when no KB and user asks about menu (no hardcoded categories)', () => {
      const draft = (service as never)['buildPlaceholderDraft'](
        { responseMode: 'standard', draftReply: null, confidence: 0.5, reasoning: '', recommendedModel: 'gpt-4o', handoverRecommended: false, tagsSuggested: [], bookingIntentDetected: false },
        [],
        [
          {
            role: 'user' as const,
            sender: 'user',
            messageType: 'text' as const,
            content: 'your menu?',
            timestamp: new Date().toISOString(),
          },
        ],
      );
      expect(draft).toMatch(/help|offerings|details/i);
      expect(draft).not.toMatch(/starters|mains|desserts|vegan/i);
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
      expect(result.bubbles[0]!.text).toContain("don't have those details");
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

    it('rewrites risky no-KB business claims to uncertainty response', async () => {
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
      const joined = result.bubbles.map(b => b.text).join('\n\n').toLowerCase();
      expect(joined).not.toContain('welcome all breeds');
      expect(joined).toContain("don’t have");
    });

    it('H: policy forced no-KB menu clarification stays one bubble and skips generation', async () => {
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
      expect(mockGen.generateDraft).not.toHaveBeenCalled();
      expect(result.draftProvenance).toBe('policy_reply');
      expect(result.bubbles).toHaveLength(1);
      expect(result.bubbles[0]!.text).toMatch(/Happy to help/i);
      expect(result.bubbles[0]!.text.toLowerCase()).not.toMatch(
        /connect you (with|to) the team|speak with the team/,
      );
      expect(result.bubbles[0]!.text).not.toMatch(/Starters|Mains|Desserts|Vegan/);
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
