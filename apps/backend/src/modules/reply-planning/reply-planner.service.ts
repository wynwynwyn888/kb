// Reply Planner Service — produces structured ReplyDecision from orchestration context
// Deterministic placeholder: combines prompt + KB context + memory into structured bubbles.
// Live LLM integration slots in via the AI provider interface in the future.

import { Injectable, Logger } from '@nestjs/common';
import type {
  ReplyDecision,
  ReplyPlanStatus,
  ReplyBubbleDraft,
  SuggestedAction,
} from './dto';
import type { RoutingResponse } from '../orchestration/dto';
import type { RetrievalChunk } from '../kb/dto/retrieval.dto';
import type { MemoryEntry } from '../orchestration/dto';

const MAX_BUBBLE_CHARS = 320; // WhatsApp soft limit per bubble

@Injectable()
export class ReplyPlannerService {
  private readonly logger = new Logger(ReplyPlannerService.name);

  /**
   * Build a ReplyDecision from orchestration context.
   *
   * Strategy:
   * - If routing says handoverRecommended=true → HANDOVER plan, no bubbles
   * - If routing responseMode=handover → HANDOVER plan
   * - Otherwise build a deterministic placeholder reply (KB+prompt+memory based)
   *   and format it into bubbles.
   *
   * TODO: When live LLM is wired, replace the placeholder generation block
   * with a call to AI provider generate(), passing full context + system prompt.
   */
  async planReply(params: {
    routing: RoutingResponse;
    kbChunks: RetrievalChunk[];
    memory: MemoryEntry[];
    systemPrompt: string;
    conversationId: string;
    channel: string;
  }): Promise<ReplyDecision> {
    const { routing, kbChunks, memory, systemPrompt, conversationId, channel } = params;

    this.logger.debug(
      `Reply planning started: conversation=${conversationId}, mode=${routing.responseMode}`,
    );

    // ---------- Handover cases ----------
    if (routing.handoverRecommended || routing.responseMode === 'handover') {
      const plan = this.buildHandoverPlan(routing);
      this.logger.log(
        `Reply planning: handover recommended for conversation=${conversationId}`,
      );
      return plan;
    }

    // ---------- Build placeholder draft ----------
    const draftText = this.buildPlaceholderDraft(
      routing,
      kbChunks,
      memory,
      systemPrompt,
    );

    // ---------- Format into bubbles ----------
    const bubbles = this.formatIntoBubbles(draftText);

    // ---------- Suggest actions ----------
    const suggestedActions = this.suggestActions(routing, kbChunks);

    const decision: ReplyDecision = {
      planStatus: 'PLANNED',
      responseMode: routing.responseMode,
      handoverRecommended: routing.handoverRecommended,
      confidence: routing.confidence,
      rationale: routing.reasoning,
      bubbles,
      suggestedActions,
    };

    this.logger.log(
      `Reply planning completed: conversation=${conversationId}, bubbles=${bubbles.length}, mode=${routing.responseMode}`,
    );

    return decision;
  }

  // ---------------------------------------------------------------------------
  // Private helpers
  // ---------------------------------------------------------------------------

  private buildHandoverPlan(routing: RoutingResponse): ReplyDecision {
    return {
      planStatus: 'HANDOVER',
      responseMode: routing.responseMode,
      handoverRecommended: true,
      confidence: routing.confidence,
      rationale: 'handoverRecommended=true from routing; no reply drafted',
      bubbles: [],
      suggestedActions: [
        {
          type: 'ESCALATE',
          params: { reason: 'handover_recommended' },
          reason: 'AI routing determined human handoff is needed',
        },
      ],
    };
  }

  /**
   * Deterministic placeholder draft builder.
   * Constructs a structured reply from KB chunks + memory + system prompt direction.
   * Replace this block with a real LLM call in the future:
   *   const llmReply = await aiProvider.generate({ messages: [...], systemPrompt });
   */
  private buildPlaceholderDraft(
    routing: RoutingResponse,
    kbChunks: RetrievalChunk[],
    memory: MemoryEntry[],
    systemPrompt: string,
  ): string {
    // If routing already has a draftReply, use it as-is
    if (routing.draftReply && routing.draftReply.trim()) {
      return routing.draftReply;
    }

    // Build from KB context
    if (kbChunks.length > 0) {
      const top = kbChunks[0]!;
      const sourceLabel = top.title || top.source || 'Knowledge base';
      // Deterministic: grab first chunk content, clamp to ~240 chars
      const snippet = top.content.slice(0, 240).trim();
      return `${snippet}${snippet.length === top.content.length ? '' : '...'}\n\n(Source: ${sourceLabel})`;
    }

    // Fallback: short acknowledgment based on response mode
    if (routing.responseMode === 'fast') {
      return 'Got it! Let me look into that for you.';
    }

    // Memory-based context reply
    const lastUserMessage = memory.filter(m => m.role === 'user').at(-1);
    if (lastUserMessage) {
      return `Thanks for your message. I received: "${lastUserMessage.content.slice(0, 100)}". A team member will follow up if needed.`;
    }

    return 'Thanks for reaching out. How can I help?';
  }

  /**
   * Format a draft string into WhatsApp-friendly bubble segments.
   * Rules:
   * - Strip markdown
   * - Split at paragraph boundaries or on blank lines
   * - Each bubble ≤ MAX_BUBBLE_CHARS
   * - Preserve short paragraphs as single bubbles
   * - Long paragraphs split on sentence/near-boundary
   */
  private formatIntoBubbles(text: string): ReplyBubbleDraft[] {
    const stripped = this.stripMarkdown(text);
    const paragraphs = stripped
      .split(/\n\s*\n/)
      .map(p => p.trim())
      .filter(p => p.length > 0);

    const bubbles: ReplyBubbleDraft[] = [];
    let index = 0;

    for (const para of paragraphs) {
      if (para.length <= MAX_BUBBLE_CHARS) {
        bubbles.push({ index: index++, text: para });
      } else {
        // Split long paragraph on sentence boundaries
        const chunks = this.splitOnSentenceBoundary(para, MAX_BUBBLE_CHARS);
        for (const chunk of chunks) {
          bubbles.push({ index: index++, text: chunk.trim() });
        }
      }
    }

    return bubbles;
  }

  private stripMarkdown(text: string): string {
    return text
      .replace(/\*\*(.+?)\*\*/g, '$1')  // bold
      .replace(/\*(.+?)\*/g, '$1')       // italic
      .replace(/__(.+?)__/g, '$1')       // underline
      .replace(/~~(.+?)~~/g, '$1')       // strikethrough
      .replace(/#{1,6}\s+(.+)/g, '$1')  // headings
      .replace(/`(.+?)`/g, '$1')         // inline code
      .replace(/\[(.+?)\]\(.+?\)/g, '$1') // links
      .replace(/^\s*[-*+]\s+/gm, '')      // list bullets
      .replace(/^\s*\d+\.\s+/gm, '')     // ordered list numbers
      .replace(/\n{3,}/g, '\n\n')        // collapse multiple blank lines
      .trim();
  }

  private splitOnSentenceBoundary(text: string, maxChars: number): string[] {
    const sentences = text.match(/[^.!?]+[.!?]+\s*/g) ?? [];
    if (sentences.length === 0) {
      // No sentence boundaries found — chunk by character count
      return this.chunkByChar(text, maxChars);
    }

    const chunks: string[] = [];
    let current = '';

    for (const sentence of sentences) {
      if ((current + sentence).trim().length <= maxChars) {
        current += sentence;
      } else {
        if (current.trim()) chunks.push(current.trim());
        current = sentence;
      }
    }

    if (current.trim()) {
      // Last chunk — if it still exceeds limit, chunk by char
      const remaining = current.trim();
      if (remaining.length <= maxChars) {
        chunks.push(remaining);
      } else {
        const sub = this.chunkByChar(remaining, maxChars);
        for (let i = 0; i < sub.length; i++) {
          chunks.push(sub[i]!);
        }
      }
    }

    return chunks.length > 0 ? chunks : [text.slice(0, maxChars)];
  }

  private chunkByChar(text: string, maxChars: number): string[] {
    const chunks: string[] = [];
    let i = 0;
    while (i < text.length) {
      chunks.push(text.slice(i, i + maxChars).trim());
      i += maxChars;
    }
    return chunks;
  }

  private suggestActions(
    routing: RoutingResponse,
    kbChunks: RetrievalChunk[],
  ): SuggestedAction[] {
    const actions: SuggestedAction[] = [];

    if (routing.bookingIntentDetected) {
      actions.push({
        type: 'BOOK_SLOT',
        params: { detected: true },
        reason: 'bookingIntentDetected=true from routing',
      });
    }

    if (routing.tagsSuggested.length > 0) {
      actions.push({
        type: 'TAG_CONTACT',
        params: { tags: routing.tagsSuggested },
        reason: `routing suggested tags: [${routing.tagsSuggested.join(', ')}]`,
      });
    }

    return actions;
  }
}
