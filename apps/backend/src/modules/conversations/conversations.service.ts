// Conversations service - manages conversation state and messages

import { Injectable, Logger } from '@nestjs/common';
import { randomUUID } from 'crypto';
import { getSupabaseService } from '../../lib/supabase';

@Injectable()
export class ConversationsService {
  private readonly logger = new Logger(ConversationsService.name);
  private readonly supabase = getSupabaseService();

  /**
   * Pause a conversation for human handover.
   * Creates a HandoverEvent (status=ACTIVE) and updates Conversation.status = HANDOVER.
   */
  async pauseForHandover(
    conversationId: string,
    type: 'REQUEST' | 'TRANSFER',
    initiatedBy: string,
    note?: string,
  ): Promise<string> {
    // Insert handover event
    const now = new Date().toISOString();
    const { data: event, error: eventError } = await this.supabase
      .from('handover_events')
      .insert({
        id: randomUUID(),
        conversation_id: conversationId,
        type,
        status: 'ACTIVE',
        initiated_by: initiatedBy,
        note: note ?? null,
        updated_at: now,
      })
      .select('id')
      .single();

    if (eventError || !event) {
      throw new Error(`Failed to create handover event: ${eventError?.message}`);
    }

    // Update conversation status
    await this.updateConversationStatus(conversationId, 'HANDOVER');

    this.logger.log(
      `Handover created: handoverEventId=${event.id}, conversationId=${conversationId}, ` +
      `type=${type}, initiatedBy=${initiatedBy}`,
    );

    return event.id;
  }

  /**
   * Resume a conversation from handover.
   * Updates HandoverEvent to RESUMED + sets resumedAt; restores Conversation.status = ACTIVE.
   */
  async resumeFromHandover(conversationId: string): Promise<void> {
    // Find active handover event
    const { data: active, error: findError } = await this.supabase
      .from('handover_events')
      .select('id')
      .eq('conversation_id', conversationId)
      .eq('status', 'ACTIVE')
      .single();

    if (findError && findError.code !== 'PGRST116') {
      throw new Error(`Failed to find active handover: ${findError.message}`);
    }

    if (active) {
      const { error: updateError } = await this.supabase
        .from('handover_events')
        .update({ status: 'RESUMED', resumed_at: new Date().toISOString() })
        .eq('id', active.id);

      if (updateError) {
        throw new Error(`Failed to resume handover: ${updateError.message}`);
      }
    }

    await this.updateConversationStatus(conversationId, 'ACTIVE');

    this.logger.log(`Handover resumed: conversationId=${conversationId}`);
  }

  /**
   * Get the active handover event for a conversation, if any.
   */
  async getActiveHandover(conversationId: string): Promise<{ id: string } | null> {
    const { data, error } = await this.supabase
      .from('handover_events')
      .select('id')
      .eq('conversation_id', conversationId)
      .eq('status', 'ACTIVE')
      .single();

    if (error && error.code !== 'PGRST116') {
      throw new Error(`Failed to query active handover: ${error.message}`);
    }

    return data ?? null;
  }

  /**
   * Returns true if the conversation has an active handover.
   */
  async isInHandover(conversationId: string): Promise<boolean> {
    const active = await this.getActiveHandover(conversationId);
    return active !== null;
  }

  /**
   * Get the contactId for a conversation.
   */
  async getContactId(conversationId: string): Promise<string | null> {
    const { data, error } = await this.supabase
      .from('conversations')
      .select('contact_id')
      .eq('id', conversationId)
      .single();

    if (error || !data) {
      return null;
    }
    return data['contact_id'] ?? null;
  }

  /**
   * Update a conversation's status.
   */
  async updateConversationStatus(
    conversationId: string,
    status: 'ACTIVE' | 'HANDOVER' | 'CLOSED' | 'PENDING',
  ): Promise<void> {
    const { error } = await this.supabase
      .from('conversations')
      .update({ status })
      .eq('id', conversationId);

    if (error) {
      throw new Error(`Failed to update conversation status: ${error.message}`);
    }
  }

  /**
   * After an allowed `/new`-style or dashboard reset, resume AI for this conversation by
   * resolving ACTIVE handover events and restoring conversation status to ACTIVE.
   */
  async resolveActiveHandoversForAllowedChatReset(
    conversationId: string,
    tenantId: string,
  ): Promise<{
    activeHandoverFound: boolean;
    handoverEventsResolved: number;
    handoverPausedBefore: boolean;
    handoverPausedAfter: boolean;
  }> {
    const { data: t0, error: te0 } = await this.supabase
      .from('tenants')
      .select('handover_paused')
      .eq('id', tenantId)
      .single();
    if (te0) {
      throw new Error(`Failed to read tenant: ${te0.message}`);
    }
    const handoverPausedBefore = Boolean(t0?.['handover_paused']);

    const { data: activeRows, error: heErr } = await this.supabase
      .from('handover_events')
      .select('id')
      .eq('conversation_id', conversationId)
      .eq('status', 'ACTIVE');

    if (heErr) {
      throw new Error(`Failed to list handover events: ${heErr.message}`);
    }

    const ids = (activeRows ?? []).map((r: { id: string }) => r.id).filter(Boolean);
    const now = new Date().toISOString();

    if (ids.length > 0) {
      const { error: upErr } = await this.supabase
        .from('handover_events')
        .update({ status: 'RESUMED', resumed_at: now })
        .in('id', ids);
      if (upErr) {
        throw new Error(`Failed to resolve handover events: ${upErr.message}`);
      }
    }

    await this.updateConversationStatus(conversationId, 'ACTIVE');

    const { data: t1, error: te1 } = await this.supabase
      .from('tenants')
      .select('handover_paused')
      .eq('id', tenantId)
      .single();
    if (te1) {
      throw new Error(`Failed to read tenant after reset: ${te1.message}`);
    }
    const handoverPausedAfter = Boolean(t1?.['handover_paused']);

    return {
      activeHandoverFound: ids.length > 0,
      handoverEventsResolved: ids.length,
      handoverPausedBefore,
      handoverPausedAfter,
    };
  }
}
