// Reply Planner Service — produces structured ReplyDecision from orchestration context.
// Uses live LLM generation when a provider is configured; falls back to deterministic drafting.
//
// FORMATTING OWNERSHIP (live outbound): `formatIntoBubbles` below is the canonical formatter
// for text shape on the real queue → GHL send path (orchestration enqueues `ReplyDecision`
// produced here). `FormatterService` (HTTP `/formatter`) is a separate optional/tooling path —
// not invoked during send-bubble execution. Do not assume parity; see drift note on FormatterService.

import { Injectable, Logger } from '@nestjs/common';
import { stripModelThinking } from '@aisbp/formatter';
import { GenerationService } from '../generation/generation.service';
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

  constructor(private readonly generationService: GenerationService) {}

  /**
   * Build a ReplyDecision from orchestration context.
   *
   * Strategy:
   * - If handover → HANDOVER plan, no bubbles
   * - Otherwise attempt live generation via GenerationService
   * - Fall back to deterministic drafting if generation is unavailable or fails
   */
  async planReply(params: {
    tenantId: string;
    routing: RoutingResponse;
    kbChunks: RetrievalChunk[];
    memory: MemoryEntry[];
    systemPrompt: string;
    conversationId: string;
    channel: string;
    /** From subaccount `tenant_prompt_configs` when set. */
    temperature?: number;
    maxTokens?: number | null;
  }): Promise<ReplyDecision> {
    const { tenantId, routing, kbChunks, memory, systemPrompt, conversationId } = params;

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

    // ---------- Live generation or fallback ----------
    const draft = await this.buildDraft(
      tenantId,
      routing,
      kbChunks,
      memory,
      systemPrompt,
      params.temperature,
      params.maxTokens,
    );

    // ---------- Format into bubbles ----------
    const bubbles = this.formatIntoBubbles(draft.text);

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
      draftProvenance: draft.provenance,
      ...(draft.provenance === 'placeholder_fallback' && draft.fallbackReason
        ? { draftFallbackReason: draft.fallbackReason }
        : {}),
    };

    this.logger.log(
      `Reply planning completed: conversation=${conversationId}, bubbles=${bubbles.length}, ` +
        `mode=${routing.responseMode}, draftProvenance=${draft.provenance}` +
        (draft.fallbackReason ? `, draftFallbackReason=${draft.fallbackReason}` : ''),
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
   * Build a draft: try live generation first, fall back to deterministic placeholder.
   */
  private async buildDraft(
    tenantId: string,
    routing: RoutingResponse,
    kbChunks: RetrievalChunk[],
    memory: MemoryEntry[],
    systemPrompt: string,
    subaccountTemperature?: number,
    subaccountMaxTokens?: number | null,
  ): Promise<{
    text: string;
    provenance: 'live_generation' | 'placeholder_fallback';
    fallbackReason?: 'no_agency' | 'no_provider' | 'generation_failed';
  }> {
    const lastUser = [...memory].reverse().find(m => m.role === 'user');
    const incomingMessage = lastUser?.content?.trim() ?? '';

    const liveDraft = await this.generationService.generateDraft({
      tenantId,
      incomingMessage,
      systemPrompt,
      memory,
      kbContext: kbChunks,
      model: routing.recommendedModel,
      ...(subaccountTemperature != null && Number.isFinite(subaccountTemperature)
        ? { temperature: subaccountTemperature }
        : {}),
      ...(subaccountMaxTokens != null && subaccountMaxTokens > 0
        ? { maxTokens: subaccountMaxTokens }
        : {}),
    });

    const trimmed = stripModelThinking(liveDraft.content ?? '').trim();
    if (trimmed.length > 0) {
      this.logger.log(`Live draft generated: ${trimmed.length} chars`);
      return { text: trimmed, provenance: 'live_generation' };
    }

    const fallbackReason =
      liveDraft.skipReason ??
      (liveDraft.content !== null && trimmed.length === 0 ? 'generation_failed' : undefined);

    const text = this.buildPlaceholderDraft(routing, kbChunks, memory);
    return {
      text,
      provenance: 'placeholder_fallback',
      fallbackReason,
    };
  }

  /**
   * Deterministic fallback: KB-first, then mode-based ack, then memory, then generic.
   */
  private buildPlaceholderDraft(
    routing: RoutingResponse,
    kbChunks: RetrievalChunk[],
    memory: MemoryEntry[],
  ): string {
    // Build from KB context
    if (kbChunks.length > 0) {
      const top = kbChunks[0]!;
      const sourceLabel = top.title || top.source || 'Knowledge base';
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
   * Canonical outbound bubble shaping for live sends: this is what enqueue → GHL uses.
   * Rules:
   * - Local `stripMarkdown` (regex-based)
   * - Split at paragraph boundaries (`\n\s*\n`)
   * - Each bubble ≤ MAX_BUBBLE_CHARS (320)
   * - Long paragraphs split on sentence / char boundaries
   * Not the same as `FormatterService` / `@aisbp/formatter` (see FormatterService drift doc).
   */
  private formatIntoBubbles(text: string): ReplyBubbleDraft[] {
    const stripped = this.stripMarkdown(stripModelThinking(text));
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
