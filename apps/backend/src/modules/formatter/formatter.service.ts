// Formatter service — formats ReplyBubbleDraft[] for channel delivery
// Does NOT send messages. Prepares and validates bubble sequences.

import { Injectable, Logger } from '@nestjs/common';
import { DefaultMessageFormatter } from '@aisbp/formatter';
import type {
  ReplyDecision,
  FormatterInput,
  FormatterOutput,
  ReplyBubbleDraft,
} from '../reply-planning/dto';

const WHATSAPP_BUBBLE_MAX = 1024;

@Injectable()
export class FormatterService {
  private readonly logger = new Logger(FormatterService.name);
  private readonly inner = new DefaultMessageFormatter();

  /**
   * Format a ReplyDecision into channel-ready FormatterOutput.
   * Applies:
   * - Markdown stripping
   * - Paragraph splitting into bubble-friendly chunks
   * - Whitespace normalization
   * - Channel-specific length enforcement
   */
  async formatReplyDecision(input: FormatterInput): Promise<FormatterOutput> {
    const { replyPlan, conversationId, channel } = input;
    const notes: string[] = [];

    if (replyPlan.planStatus === 'HANDOVER' || replyPlan.planStatus === 'SKIP_NO_REPLY') {
      return {
        bubbles: [],
        formattingNotes: [`status=${replyPlan.planStatus}; no formatting applied`],
        bubbleCount: 0,
      };
    }

    if (replyPlan.bubbles.length === 0) {
      return {
        bubbles: [],
        formattingNotes: ['no bubbles to format'],
        bubbleCount: 0,
      };
    }

    // Format each raw bubble draft through the inner formatter
    const formatted: ReplyBubbleDraft[] = [];
    for (const draft of replyPlan.bubbles) {
      const stripped = this.inner.stripMarkdown(draft.text);

      if (stripped.length <= WHATSAPP_BUBBLE_MAX) {
        formatted.push({
          index: draft.index,
          text: stripped.trim().replace(/\s+/g, ' '),
        });
        notes.push(`bubble[${draft.index}]: stripped + normalized`);
      } else {
        // Split oversized bubble
        const chunks = this.inner.splitIntoBubbles(stripped, WHATSAPP_BUBBLE_MAX);
        for (const chunk of chunks) {
          const cleaned = chunk.content.trim().replace(/\s+/g, ' ');
          formatted.push({
            index: formatted.length,
            text: cleaned,
          });
        }
        notes.push(
          `bubble[${draft.index}]: stripped, normalized, split into ${chunks.length} sub-bubbles`,
        );
      }
    }

    // Final whitespace collapse across all bubbles
    const finalBubbles = formatted.map(b => ({
      ...b,
      text: b.text.replace(/\n{2,}/g, '\n').trim(),
    }));

    this.logger.debug(
      `Formatter: conversation=${conversationId}, channel=${channel}, ` +
      `in=${replyPlan.bubbles.length}, out=${finalBubbles.length}`,
    );

    return {
      bubbles: finalBubbles,
      formattingNotes: notes,
      bubbleCount: finalBubbles.length,
    };
  }

  /**
   * Split any raw text into bubbles without needing a full ReplyDecision.
   * Convenience method for future layers that receive raw strings.
   */
  async formatRawText(text: string): Promise<FormatterOutput> {
    const stripped = this.inner.stripMarkdown(text);
    const chunks = this.inner.splitIntoBubbles(stripped, WHATSAPP_BUBBLE_MAX);
    return {
      bubbles: chunks.map((c, i) => ({ index: i, text: c.content.trim().replace(/\s+/g, ' ') })),
      formattingNotes: [`split into ${chunks.length} bubbles`],
      bubbleCount: chunks.length,
    };
  }
}
