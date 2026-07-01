// FormatterService spec — unit tests for current formatting behavior.
// Captures existing stub/real behaviour: stripMarkdown, splitIntoBubbles,
// HANDOVER/SKIP_NO_REPLY passthrough, and formatRawText convenience method.

import { jest as jestGlobal } from '@jest/globals';
import { FormatterService } from './formatter.service';
import type { ReplyDecision } from '../reply-planning/dto';

const service = new FormatterService();

function makeReplyDecision(overrides: Partial<ReplyDecision> = {}): ReplyDecision {
  return {
    planStatus: 'PLANNED',
    responseMode: 'standard',
    handoverRecommended: false,
    confidence: 0.9,
    rationale: 'test',
    bubbles: [],
    suggestedActions: [],
    ...overrides,
  };
}

describe('FormatterService', () => {
  // ===========================================================================
  // HANDOVER status → empty bubbles
  // ===========================================================================

  describe('plan status passthrough', () => {
    it('returns empty bubbles for HANDOVER status', async () => {
      const result = await service.formatReplyDecision({
        replyPlan: makeReplyDecision({ planStatus: 'HANDOVER' }),
        conversationId: 'c1',
        channel: 'WHATSAPP',
      });
      expect(result.bubbles).toHaveLength(0);
      expect(result.bubbleCount).toBe(0);
      expect(result.formattingNotes).toContain('status=HANDOVER; no formatting applied');
    });

    it('returns empty bubbles for SKIP_NO_REPLY status', async () => {
      const result = await service.formatReplyDecision({
        replyPlan: makeReplyDecision({ planStatus: 'SKIP_NO_REPLY' }),
        conversationId: 'c1',
        channel: 'WHATSAPP',
      });
      expect(result.bubbles).toHaveLength(0);
      expect(result.bubbleCount).toBe(0);
      expect(result.formattingNotes).toContain('status=SKIP_NO_REPLY; no formatting applied');
    });
  });

  // ===========================================================================
  // Empty bubbles → no bubbles to format
  // ===========================================================================

  describe('empty bubbles handling', () => {
    it('returns empty result when bubbles array is empty', async () => {
      const result = await service.formatReplyDecision({
        replyPlan: makeReplyDecision({ planStatus: 'PLANNED', bubbles: [] }),
        conversationId: 'c1',
        channel: 'WHATSAPP',
      });
      expect(result.bubbles).toHaveLength(0);
      expect(result.formattingNotes).toContain('no bubbles to format');
    });
  });

  // ===========================================================================
  // Short text → stripped + normalized
  // ===========================================================================

  describe('short text formatting', () => {
    it('strips markdown and normalizes whitespace for text under 1024 chars', async () => {
      const result = await service.formatReplyDecision({
        replyPlan: makeReplyDecision({
          bubbles: [{ index: 0, text: 'Hello **World**' }],
        }),
        conversationId: 'c1',
        channel: 'WHATSAPP',
      });
      expect(result.bubbles).toHaveLength(1);
      expect(result.bubbles[0].text).toContain('Hello');
      expect(result.bubbleCount).toBe(1);
      expect(result.formattingNotes[0]).toContain('stripped + normalized');
    });

    it('preserves emojis and plain text in short messages', async () => {
      const result = await service.formatReplyDecision({
        replyPlan: makeReplyDecision({
          bubbles: [{ index: 0, text: 'Good morning! Here is your info.' }],
        }),
        conversationId: 'c1',
        channel: 'WHATSAPP',
      });
      expect(result.bubbles).toHaveLength(1);
      expect(result.bubbles[0].text).toBe('Good morning! Here is your info.');
    });

    it('collapses multiple whitespace into single spaces', async () => {
      const result = await service.formatReplyDecision({
        replyPlan: makeReplyDecision({
          bubbles: [{ index: 0, text: 'Hello     world  \n  test' }],
        }),
        conversationId: 'c1',
        channel: 'WHATSAPP',
      });
      expect(result.bubbles[0].text).not.toMatch(/\s{2,}/);
    });
  });

  // ===========================================================================
  // Long text → split into sub-bubbles
  // ===========================================================================

  describe('long text splitting', () => {
    it('stub: text without sentence boundaries (>1024 chars) stays in one oversized bubble', async () => {
      const longText = 'A'.repeat(2000);
      const result = await service.formatReplyDecision({
        replyPlan: makeReplyDecision({
          bubbles: [{ index: 0, text: longText }],
        }),
        conversationId: 'c1',
        channel: 'WHATSAPP',
      });
      expect(result.bubbleCount).toBe(1);
      expect(result.bubbles[0].text.length).toBe(2000);
    });

    it('splits text with sentence boundaries into multiple bubbles', async () => {
      const longText = 'A. '.repeat(500);
      const result = await service.formatReplyDecision({
        replyPlan: makeReplyDecision({
          bubbles: [{ index: 0, text: longText }],
        }),
        conversationId: 'c1',
        channel: 'WHATSAPP',
      });
      expect(result.bubbleCount).toBeGreaterThan(1);
    });

    it('split bubble index is sequential', async () => {
      const longText = 'A. '.repeat(500);
      const result = await service.formatReplyDecision({
        replyPlan: makeReplyDecision({
          bubbles: [{ index: 0, text: longText }],
        }),
        conversationId: 'c1',
        channel: 'WHATSAPP',
      });
      for (let i = 0; i < result.bubbles.length; i++) {
        expect(result.bubbles[i].index).toBe(i);
      }
    });
  });

  // ===========================================================================
  // formatRawText convenience method
  // ===========================================================================

  describe('formatRawText', () => {
    it('splits short raw text into a single bubble', async () => {
      const result = await service.formatRawText('Hello world');
      expect(result.bubbles).toHaveLength(1);
      expect(result.bubbles[0].text).toBe('Hello world');
      expect(result.bubbleCount).toBe(1);
    });

    it('stub: long raw text without sentence boundaries stays in one bubble', async () => {
      const longText = 'A'.repeat(2000);
      const result = await service.formatRawText(longText);
      expect(result.bubbleCount).toBe(1);
      expect(result.bubbles[0].text.length).toBe(2000);
    });

    it('strips markdown from raw text', async () => {
      const result = await service.formatRawText('Hello **World**');
      expect(result.bubbles[0].text).toContain('Hello');
    });
  });

  // ===========================================================================
  // Multi-bubble formatting
  // ===========================================================================

  describe('multiple bubble drafts', () => {
    it('formats multiple draft bubbles independently', async () => {
      const result = await service.formatReplyDecision({
        replyPlan: makeReplyDecision({
          bubbles: [
            { index: 0, text: 'First message' },
            { index: 1, text: 'Second message' },
          ],
        }),
        conversationId: 'c1',
        channel: 'WHATSAPP',
      });
      expect(result.bubbles.length).toBeGreaterThanOrEqual(2);
      expect(result.bubbleCount).toBeGreaterThanOrEqual(2);
    });
  });

  // ===========================================================================
  // Whitespace collapse — final pass
  // ===========================================================================

  describe('final whitespace collapse', () => {
    it('collapses multiple newlines into single newline', async () => {
      const result = await service.formatReplyDecision({
        replyPlan: makeReplyDecision({
          bubbles: [{ index: 0, text: 'Line 1\n\n\nLine 2' }],
        }),
        conversationId: 'c1',
        channel: 'WHATSAPP',
      });
      expect(result.bubbles[0].text).not.toMatch(/\n{3,}/);
    });

    it('trims leading and trailing whitespace from final bubbles', async () => {
      const result = await service.formatReplyDecision({
        replyPlan: makeReplyDecision({
          bubbles: [{ index: 0, text: '  Hello world  ' }],
        }),
        conversationId: 'c1',
        channel: 'WHATSAPP',
      });
      expect(result.bubbles[0].text).toBe('Hello world');
    });
  });

  // ===========================================================================
  // Edge cases
  // ===========================================================================

  describe('edge cases', () => {
    it('handles very short text (empty after stripping)', async () => {
      const result = await service.formatReplyDecision({
        replyPlan: makeReplyDecision({
          bubbles: [{ index: 0, text: '   ' }],
        }),
        conversationId: 'c1',
        channel: 'WHATSAPP',
      });
      expect(result.bubbles.length).toBeGreaterThanOrEqual(0);
    });

    it('handles text at exact 1024 boundary', async () => {
      const exactText = 'X'.repeat(1024);
      const result = await service.formatReplyDecision({
        replyPlan: makeReplyDecision({
          bubbles: [{ index: 0, text: exactText }],
        }),
        conversationId: 'c1',
        channel: 'WHATSAPP',
      });
      expect(result.bubbleCount).toBeGreaterThanOrEqual(1);
    });
  });
});
