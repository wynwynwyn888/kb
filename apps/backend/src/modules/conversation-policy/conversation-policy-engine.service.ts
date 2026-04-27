import { Injectable, Logger } from '@nestjs/common';
import type { MemoryEntry } from '../orchestration/dto';
import type { RetrievalChunk } from '../kb/dto/retrieval.dto';
import type { ConversationIntent } from './conversation-intent';
import {
  clearAwaitingState,
  emptyPolicyState,
  parseAisbpPolicyState,
  policyStateExpired,
  type AisbpPolicyStateV1,
} from './conversation-policy-state';
import { resolveShortSelection } from './option-resolver';
import { MENU_CATEGORY_PROMPT, menuCategorySelectedNoKbReply, SELECTION_UNCLEAR_REPLY } from './policy-menu-copy';
import type { SelectionResolution } from './option-resolver';
import {
  assessRestaurantBookingMessage,
  bookingAskPreferredDateTimeReply,
  extractGuestCountHint,
  extractOutOfDomainServicePhrase,
  outOfDomainBookingClarificationReply,
} from '../../lib/booking-domain';

export type PolicyReplyKind =
  | 'none'
  | 'menu_category_prompt'
  | 'menu_category_selected_no_kb'
  | 'selection_clarification'
  | 'booking_out_of_domain'
  | 'booking_ask_preference';

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

  evaluate(params: {
    intent: ConversationIntent;
    incomingRaw: string;
    memory: MemoryEntry[];
    policyState: AisbpPolicyStateV1;
    kbChunksRanked: RetrievalChunk[];
    /** Tenant / subaccount display name for booking copy */
    tenantDisplayName?: string;
  }): ConversationPolicyOutcome {
    const { intent, incomingRaw, memory, kbChunksRanked, tenantDisplayName } = params;
    const now = Date.now();
    let state: AisbpPolicyStateV1 = { ...params.policyState, v: 1 };
    const hadMenuAwaiting = state.awaiting === 'menu_category_selection';

    if (policyStateExpired(state, now)) {
      this.logger.log(`Policy state replaced: reason=expired`);
      state = emptyPolicyState();
    } else if (hadMenuAwaiting && !state.expiresAt) {
      this.logger.log(`Policy state kept: reason=no_expiry`);
    }

    this.logger.log(
      `Conversation policy: latestIntent=${intent}, activeTopic=${state.activeTopic ?? 'none'}, awaiting=${state.awaiting ?? 'none'}`,
    );

    const tenantName = (tenantDisplayName ?? '').trim() || 'our restaurant';

    const replaceTopicIfNeeded = (
      base: AisbpPolicyStateV1,
      topicKey: string,
    ): { next: AisbpPolicyStateV1; clearedMenu: boolean } => {
      const clearedMenu = base.awaiting === 'menu_category_selection';
      const next: AisbpPolicyStateV1 = {
        ...base,
        ...clearAwaitingState(base),
        activeTopic: topicKey,
        updatedAt: new Date().toISOString(),
      };
      if (clearedMenu) {
        this.logger.log(`Policy state replaced: reason=new_topic intent=${intent}`);
      }
      return { next, clearedMenu };
    };

    if (intent === 'HUMAN_HANDOVER' || intent === 'COMPLAINT') {
      if (hadMenuAwaiting) {
        this.logger.log(`Policy state replaced: reason=new_topic intent=${intent}`);
      }
      state = {
        v: 1,
        activeTopic: intent === 'COMPLAINT' ? 'complaint' : 'handover',
        awaiting: null,
        options: undefined,
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
      const booking = assessRestaurantBookingMessage(incomingRaw);
      if (!booking.inDomain) {
        this.logger.log(`Policy booking rejected: out_of_domain_service`);
        const phrase = extractOutOfDomainServicePhrase(incomingRaw);
        const { next } = replaceTopicIfNeeded(state, 'booking');
        return {
          latestIntent: intent,
          resolvedSelection: null,
          kbChunks: [],
          policyForcedReply: outOfDomainBookingClarificationReply(tenantName, phrase),
          policyReplyKind: 'booking_out_of_domain',
          nextPolicyState: next,
          conversationStateSummary: 'booking_out_of_domain',
          menuSelectionActive: false,
        };
      }
      const guests = extractGuestCountHint(incomingRaw);
      const { next } = replaceTopicIfNeeded(state, 'booking');
      this.logger.log(`Policy reply chosen: booking_ask_preference`);
      return {
        latestIntent: intent,
        resolvedSelection: null,
        kbChunks: kbChunksRanked,
        policyForcedReply: bookingAskPreferredDateTimeReply(guests),
        policyReplyKind: 'booking_ask_preference',
        nextPolicyState: next,
        conversationStateSummary: guests != null ? `booking_guests=${guests}` : 'booking_ask_datetime',
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
      if (sel) {
        const labelShort =
          sel.selectedText.length > 48 ? `${sel.selectedText.slice(0, 45)}...` : sel.selectedText;
        this.logger.log(
          `Selection resolved: raw=${sel.raw}, selectedText=${labelShort}, source=${sel.source}`,
        );
      }

      if (state.awaiting === 'menu_category_selection') {
        if (!sel) {
          this.logger.log(
            `KB rejected: reason=selection_unresolved, latestMessage_class=short_selection, kbTitle=n/a`,
          );
          return {
            latestIntent: intent,
            resolvedSelection: null,
            kbChunks: [],
            policyForcedReply: SELECTION_UNCLEAR_REPLY,
            policyReplyKind: 'selection_clarification',
            nextPolicyState: { ...state, updatedAt: new Date().toISOString() },
            conversationStateSummary: 'awaiting=menu_category_selection unresolved',
            menuSelectionActive: true,
          };
        }
        if (kbChunksRanked.length > 0) {
          this.logger.log(
            `Policy menu KB present: selectedText=${sel.selectedText}, chunks=${kbChunksRanked.length}`,
          );
          return {
            latestIntent: intent,
            resolvedSelection: sel,
            kbChunks: kbChunksRanked,
            policyForcedReply: null,
            policyReplyKind: 'none',
            nextPolicyState: {
              ...clearAwaitingState(state),
              activeTopic: 'menu',
              updatedAt: new Date().toISOString(),
            },
            conversationStateSummary: `menu_pick=${sel.selectedLabel}`,
            menuSelectionActive: true,
          };
        }
        this.logger.log(`Policy menu no supported KB: selectedText=${sel.selectedText}`);
        const reply = menuCategorySelectedNoKbReply(sel.selectedText);
        this.logger.log(`Policy reply chosen: menu_category_selected_no_kb`);
        return {
          latestIntent: intent,
          resolvedSelection: sel,
          kbChunks: [],
          policyForcedReply: reply,
          policyReplyKind: 'menu_category_selected_no_kb',
          nextPolicyState: {
            ...clearAwaitingState(state),
            activeTopic: 'menu',
            updatedAt: new Date().toISOString(),
          },
          conversationStateSummary: `menu_pick=${sel.selectedLabel}`,
          menuSelectionActive: true,
        };
      }

      if (!sel) {
        this.logger.log(
          `KB rejected: reason=selection_no_context, latestMessage_class=short_selection, kbTitle=n/a`,
        );
        return {
          latestIntent: intent,
          resolvedSelection: null,
          kbChunks: kbChunksRanked,
          policyForcedReply: SELECTION_UNCLEAR_REPLY,
          policyReplyKind: 'selection_clarification',
          nextPolicyState: { ...state, updatedAt: new Date().toISOString() },
          conversationStateSummary: 'selection_without_options',
          menuSelectionActive: true,
        };
      }

      return {
        latestIntent: intent,
        resolvedSelection: sel,
        kbChunks: kbChunksRanked,
        policyForcedReply: null,
        policyReplyKind: 'none',
        nextPolicyState: { ...state, updatedAt: new Date().toISOString() },
        conversationStateSummary: `pick=${sel.selectedLabel}`,
        menuSelectionActive: true,
      };
    }

    if (intent === 'MENU') {
      if (kbChunksRanked.length > 0) {
        this.logger.log(`Policy reply chosen: generation_with_menu_kb chunks=${kbChunksRanked.length}`);
        const next = {
          ...state,
          awaiting: null,
          options: undefined,
          expiresAt: null,
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

      const options: Record<string, string> = {
        A: 'Starters',
        B: 'Mains',
        C: 'Desserts',
        D: 'Vegan options',
      };
      this.logger.log(`Policy reply chosen: menu_category_prompt`);
      return {
        latestIntent: intent,
        resolvedSelection: null,
        kbChunks: [],
        policyForcedReply: MENU_CATEGORY_PROMPT,
        policyReplyKind: 'menu_category_prompt',
        nextPolicyState: {
          v: 1,
          activeTopic: 'menu',
          awaiting: 'menu_category_selection',
          options,
          lastAssistantOptions: options,
          expiresAt: null,
          updatedAt: new Date().toISOString(),
        },
        conversationStateSummary: 'awaiting=menu_category_selection',
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
}
