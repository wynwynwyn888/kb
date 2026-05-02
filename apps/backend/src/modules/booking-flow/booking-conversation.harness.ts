import type { BookingFlowOrchestrationHookResult } from './conversation-booking-flow.service';
import { ConversationBookingFlowService } from './conversation-booking-flow.service';

/** Fixed params for every simulated turn (matches orchestration hook shape). */
export type BookingConversationHarnessBase = {
  tenantId: string;
  conversationId: string;
  contactId: string;
  channel: string;
  tenantTimeZone?: string;
  tenantDisplayName?: string;
  contactSnapshot?: { displayName?: string; phone?: string; email?: string };
  contactFieldsFromExtendedWebhook?: boolean;
};

/**
 * Message-by-message harness for `ConversationBookingFlowService`.
 * Mirrors production: `combinedInboundText` is the full transcript, `latestInboundText` is the current line.
 */
export class BookingConversationHarness {
  metadata: Record<string, unknown> = {};
  private readonly transcript: string[] = [];

  constructor(
    private readonly flow: ConversationBookingFlowService,
    private readonly base: BookingConversationHarnessBase,
  ) {}

  /** Start over (e.g. “new conversation” with empty metadata). */
  reset(metadata: Record<string, unknown> = {}): void {
    this.metadata = { ...metadata };
    this.transcript.length = 0;
  }

  async say(latestInboundText: string): Promise<BookingFlowOrchestrationHookResult> {
    this.transcript.push(latestInboundText);
    const combinedInboundText = this.transcript.join('\n');
    const r = await this.flow.maybeHandleConversationBookingTurn({
      ...this.base,
      combinedInboundText,
      latestInboundText: latestInboundText,
      metadata: this.metadata,
    });
    if (r.handled) {
      this.metadata = r.persistMetadata as Record<string, unknown>;
    }
    return r;
  }

  /** Parsed `aisbp_booking` object from persisted metadata, if present. */
  bookingState(): Record<string, unknown> | undefined {
    const raw = this.metadata['aisbp_booking'];
    if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return undefined;
    return raw as Record<string, unknown>;
  }
}
