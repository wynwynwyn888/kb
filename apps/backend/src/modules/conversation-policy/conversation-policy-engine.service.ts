import { Injectable, Logger } from '@nestjs/common';
import type { MemoryEntry } from '../orchestration/dto';
import type { RetrievalChunk } from '../kb/dto/retrieval.dto';
import type { ConversationIntent } from './conversation-intent';
import {
  clearAwaitingState,
  emptyPolicyState,
  parseAisbpPolicyState,
  policyStateExpired,
  shouldClearOptionMemory,
  type AisbpPolicyStateV1,
} from './conversation-policy-state';
import {
  parseAssistantOptionLines,
  resolveShortSelection,
  type SelectionResolution,
} from './option-resolver';
import {
  buildOptionsFromKbSectionTitles,
} from './policy-menu-copy';

export type PolicyReplyKind =
  | 'none'
  | 'menu_category_prompt'
  | 'menu_category_selected_no_kb'
  | 'selection_clarification'
  | 'menu_no_kb_clarification';

export interface ConversationPolicyEvaluateInput {
  intent: ConversationIntent;
  incomingRaw: string;
  memory: MemoryEntry[];
  policyState: AisbpPolicyStateV1;
  kbChunksRanked: RetrievalChunk[];
  /**
   * When true, a menu option was resolved with **no** KB context on purpose (pure A–H / 1–8 pick).
   * Do not force the canned no-KB category reply — allow live generation with policy hints only.
   */
  optionPickResolvedWithoutKb?: boolean;
  /** Tenant / subaccount display name for booking copy */
  tenantDisplayName?: string;
  /** Active prompt config updated_at — used to invalidate stale option memory. */
  promptConfigUpdatedAtIso?: string | null;
  /** Latest tenant KB document updated_at — used together with KB titles to invalidate stale memory. */
  kbDocumentUpdatedAtIso?: string | null;
  /** Current tenant id — invalidates option memory tied to a previous tenant. */
  currentTenantId?: string | null;
}

export interface ConversationPolicyOutcome {
  latestIntent: ConversationIntent;
  resolvedSelection: SelectionResolution | null;
  kbChunks: RetrievalChunk[];
  policyForcedReply: string | null;
  policyReplyKind: PolicyReplyKind;
  nextPolicyState: AisbpPolicyStateV1;
  conversationStateSummary: string;
  /** For outbound guard */
  menuSelectionActive: boolean;
}

@Injectable()
export class ConversationPolicyEngineService {
  private readonly logger = new Logger(ConversationPolicyEngineService.name);

  evaluate(params: ConversationPolicyEvaluateInput): ConversationPolicyOutcome {
    const {
      intent,
      incomingRaw,
      memory,
      kbChunksRanked,
      promptConfigUpdatedAtIso,
      kbDocumentUpdatedAtIso,
      currentTenantId,
    } = params;
    const now = Date.now();
    let state: AisbpPolicyStateV1 = { ...params.policyState, v: 1 };
    const hadOptionsAwaiting =
      state.awaiting === 'menu_category_selection' || state.awaiting === 'option_selection';

    // Clear obvious stale state up-front: legacy expiresAt path.
    if (policyStateExpired(state, now)) {
      this.logger.log('Policy state replaced: reason=expired');
      state = emptyPolicyState();
    }

    // Newer prompt config / KB / tenant change / TTL → clear option memory.
    const currentKbSectionTitles = kbChunksRanked
      .map(c => {
        const t = c.metadata['sectionTitle'];
        return typeof t === 'string' ? t : '';
      })
      .filter(Boolean);
    const stale = shouldClearOptionMemory(state, {
      promptConfigUpdatedAtIso,
      kbDocumentUpdatedAtIso,
      currentKbSectionTitles,
      currentTenantId,
      nowMs: now,
    });
    if (stale.stale) {
      this.logger.log(`Option memory cleared: reason=${stale.reason}`);
      state = {
        ...state,
        ...clearAwaitingState(state),
      };
    }

    this.logger.log(
      `Conversation policy: latestIntent=${intent}, activeTopic=${state.activeTopic ?? 'none'}, awaiting=${state.awaiting ?? 'none'}, optionsCount=${state.options ? Object.keys(state.options).length : 0}`,
    );

    const replaceTopicIfNeeded = (
      base: AisbpPolicyStateV1,
      topicKey: string,
    ): { next: AisbpPolicyStateV1; clearedAwaiting: boolean } => {
      const clearedAwaiting =
        base.awaiting === 'menu_category_selection' || base.awaiting === 'option_selection';
      const next: AisbpPolicyStateV1 = {
        ...base,
        ...clearAwaitingState(base),
        activeTopic: topicKey,
        updatedAt: new Date().toISOString(),
      };
      if (clearedAwaiting) {
        this.logger.log(`Policy state replaced: reason=new_topic intent=${intent}`);
      }
      return { next, clearedAwaiting };
    };

    if (intent === 'HUMAN_HANDOVER' || intent === 'COMPLAINT') {
      if (hadOptionsAwaiting) {
        this.logger.log(`Policy state replaced: reason=new_topic intent=${intent}`);
      }
      state = {
        v: 1,
        activeTopic: intent === 'COMPLAINT' ? 'complaint' : 'handover',
        awaiting: null,
        options: undefined,
        optionsUpdatedAt: null,
        optionsSource: null,
        optionsDerivedFromChunkIds: null,
        expiresAt: null,
        updatedAt: new Date().toISOString(),
      };
      return {
        latestIntent: intent,
        resolvedSelection: null,
        kbChunks: kbChunksRanked,
        policyForcedReply: null,
        policyReplyKind: 'none',
        nextPolicyState: state,
        conversationStateSummary: `cleared_for_${intent.toLowerCase()}`,
        menuSelectionActive: false,
      };
    }

    if (intent === 'BOOKING') {
      // Universal booking: just record the topic, let generation use KB context.
      const { next } = replaceTopicIfNeeded(state, 'booking');
      return {
        latestIntent: intent,
        resolvedSelection: null,
        kbChunks: kbChunksRanked,
        policyForcedReply: null,
        policyReplyKind: 'none',
        nextPolicyState: next,
        conversationStateSummary: 'topic=booking',
        menuSelectionActive: false,
      };
    }

    if (intent === 'PRICE' || intent === 'LOCATION') {
      const { next } = replaceTopicIfNeeded(state, intent === 'PRICE' ? 'price' : 'location');
      return {
        latestIntent: intent,
        resolvedSelection: null,
        kbChunks: kbChunksRanked,
        policyForcedReply: null,
        policyReplyKind: 'none',
        nextPolicyState: next,
        conversationStateSummary: `topic=${intent.toLowerCase()}`,
        menuSelectionActive: false,
      };
    }

    if (intent === 'BUSINESS_HOURS') {
      const { next } = replaceTopicIfNeeded(state, 'hours');
      return {
        latestIntent: intent,
        resolvedSelection: null,
        kbChunks: kbChunksRanked,
        policyForcedReply: null,
        policyReplyKind: 'none',
        nextPolicyState: next,
        conversationStateSummary: 'topic=hours awaiting_cleared',
        menuSelectionActive: false,
      };
    }

    if (intent === 'SHORT_SELECTION') {
      const sel = resolveShortSelection(incomingRaw, state, memory);
      const optionMemoryFound = Boolean(sel);
      const optionMemoryLabels = state.options ? Object.keys(state.options) : [];
      const optionsAge = state.optionsUpdatedAt
        ? Math.max(0, now - Date.parse(state.optionsUpdatedAt))
        : null;

      this.logger.log(
        `SHORT_SELECTION: shortSelectionDetected=true optionMemoryFound=${optionMemoryFound} ` +
          `optionMemoryLabels=${JSON.stringify(optionMemoryLabels)} ` +
          (sel
            ? `resolvedSelectionLabel=${sel.selectedLabel} resolvedSelectionText=${JSON.stringify(sel.selectedText.slice(0, 60))} `
            : 'resolvedSelectionLabel=none ') +
          `optionMemoryAgeMs=${optionsAge ?? 'n/a'} optionMemorySource=${state.optionsSource ?? 'n/a'}`,
      );

      if (sel) {
        // Selection resolved — clear awaiting so we move to the resolved-topic generation.
        const next: AisbpPolicyStateV1 = {
          ...clearAwaitingState(state),
          activeTopic: state.activeTopic ?? 'menu',
          updatedAt: new Date().toISOString(),
        };
        if (kbChunksRanked.length > 0) {
          return {
            latestIntent: intent,
            resolvedSelection: sel,
            kbChunks: kbChunksRanked,
            policyForcedReply: null,
            policyReplyKind: 'none',
            nextPolicyState: next,
            conversationStateSummary: `pick=${sel.selectedLabel}`,
            menuSelectionActive: true,
          };
        }
        if (params.optionPickResolvedWithoutKb) {
          return {
            latestIntent: intent,
            resolvedSelection: sel,
            kbChunks: [],
            policyForcedReply: null,
            policyReplyKind: 'none',
            nextPolicyState: next,
            conversationStateSummary: `pick=${sel.selectedLabel}_option_pick_no_kb_gen`,
            menuSelectionActive: true,
          };
        }
        return {
          latestIntent: intent,
          resolvedSelection: sel,
          kbChunks: [],
          policyForcedReply: null,
          policyReplyKind: 'none',
          nextPolicyState: next,
          conversationStateSummary: `pick=${sel.selectedLabel}_no_kb_live_generation`,
          menuSelectionActive: true,
        };
      }

      // No selection resolvable — keep awaiting (if it was set), and ask for clarification.
      this.logger.log(
        `KB rejected: reason=${state.awaiting ? 'selection_unresolved' : 'selection_no_context'}, latestMessage_class=short_selection, kbTitle=n/a`,
      );
      return {
        latestIntent: intent,
        resolvedSelection: null,
        kbChunks: [],
        policyForcedReply: null,
        policyReplyKind: 'none',
        nextPolicyState: { ...state, updatedAt: new Date().toISOString() },
        conversationStateSummary: state.awaiting
          ? `awaiting=${state.awaiting} unresolved_live_generation`
          : 'selection_without_options_live_generation',
        menuSelectionActive: Boolean(state.awaiting),
      };
    }

    if (intent === 'MENU') {
      // KB available → just retrieve and let generation answer; record topic.
      if (kbChunksRanked.length > 0) {
        const next: AisbpPolicyStateV1 = {
          ...state,
          ...clearAwaitingState(state),
          activeTopic: 'menu',
          updatedAt: new Date().toISOString(),
        };
        return {
          latestIntent: intent,
          resolvedSelection: null,
          kbChunks: kbChunksRanked,
          policyForcedReply: null,
          policyReplyKind: 'none',
          nextPolicyState: next,
          conversationStateSummary: 'menu_kb_present',
          menuSelectionActive: false,
        };
      }

      this.logger.log('Policy reply skipped: menu_no_kb_live_generation');
      return {
        latestIntent: intent,
        resolvedSelection: null,
        kbChunks: [],
        policyForcedReply: null,
        policyReplyKind: 'none',
        nextPolicyState: {
          v: 1,
          activeTopic: 'menu',
          awaiting: null,
          options: undefined,
          optionsUpdatedAt: null,
          optionsSource: null,
          optionsDerivedFromChunkIds: null,
          lastAssistantOptions: state.lastAssistantOptions,
          expiresAt: null,
          updatedAt: new Date().toISOString(),
        },
        conversationStateSummary: 'menu_no_kb_live_generation',
        menuSelectionActive: false,
      };
    }

    return {
      latestIntent: intent,
      resolvedSelection: null,
      kbChunks: kbChunksRanked,
      policyForcedReply: null,
      policyReplyKind: 'none',
      nextPolicyState: { ...state, updatedAt: new Date().toISOString() },
      conversationStateSummary: 'passthrough',
      menuSelectionActive: false,
    };
  }

  /** Parse policy blob from conversation row metadata (Supabase JSON). */
  parseState(metadata: Record<string, unknown> | undefined): AisbpPolicyStateV1 {
    return parseAisbpPolicyState(metadata);
  }

  /**
   * After a reply is finalised, capture any A/B/C/D choices the assistant offered so the next
   * inbound message can be resolved by `resolveShortSelection`. Returns the next policy state.
   */
  recordAssistantOptions(
    state: AisbpPolicyStateV1,
    assistantText: string,
    ctx: { tenantId?: string | null; nowIso?: string } = {},
  ): AisbpPolicyStateV1 {
    const opts = parseAssistantOptionLines(assistantText);
    if (Object.keys(opts).length < 2) {
      return state;
    }
    const nowIso = ctx.nowIso ?? new Date().toISOString();
    return {
      ...state,
      v: 1,
      awaiting: state.awaiting ?? 'option_selection',
      options: opts,
      lastAssistantOptions: opts,
      optionsUpdatedAt: nowIso,
      optionsSource: 'assistant_reply',
      optionsDerivedFromChunkIds: state.optionsDerivedFromChunkIds ?? null,
      optionsTenantId: ctx.tenantId ?? state.optionsTenantId ?? null,
      updatedAt: nowIso,
    };
  }

  /**
   * Build A/B/C/D choices from KB section titles and capture them in option memory.
   * Returns `null` when the KB has no usable section headings.
   */
  buildAndRecordOptionsFromKb(
    state: AisbpPolicyStateV1,
    chunks: RetrievalChunk[],
    ctx: { tenantId?: string | null; nowIso?: string } = {},
  ): { reply: string; nextState: AisbpPolicyStateV1 } | null {
    const built = buildOptionsFromKbSectionTitles(chunks);
    if (!built) return null;
    const nowIso = ctx.nowIso ?? new Date().toISOString();
    const next: AisbpPolicyStateV1 = {
      ...state,
      v: 1,
      awaiting: 'option_selection',
      options: built.options,
      lastAssistantOptions: built.options,
      optionsUpdatedAt: nowIso,
      optionsSource: 'policy_engine',
      optionsDerivedFromChunkIds: chunks.map(c => c.chunkId),
      optionsTenantId: ctx.tenantId ?? state.optionsTenantId ?? null,
      updatedAt: nowIso,
    };
    return { reply: built.reply, nextState: next };
  }
}
