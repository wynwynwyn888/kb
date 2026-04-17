// Handover service - manages AI-to-human handoff

import { Injectable, Logger, NotFoundException } from '@nestjs/common';
import { InjectQueue } from '@nestjs/bullmq';
import { Queue } from 'bullmq';
import { getSupabaseService } from '../../lib/supabase';
import { QUEUES } from '../../queues/queue.constants';

@Injectable()
export class HandoverService {
  private readonly logger = new Logger(HandoverService.name);
  private readonly supabase = getSupabaseService();

  constructor(
    @InjectQueue(QUEUES.HANDOVER_NOTIFY) private readonly handoverQueue: Queue,
  ) {}

  async initiate(
    conversationId: string,
    type: 'REQUEST' | 'TRANSFER',
    initiatedBy: string,
    note?: string,
  ): Promise<string> {
    // Insert handover event
    const { data: event, error: eventError } = await this.supabase
      .from('handover_events')
      .insert({
        conversation_id: conversationId,
        type,
        status: 'ACTIVE',
        initiated_by: initiatedBy,
        note: note ?? null,
      })
      .select('id')
      .single();

    if (eventError || !event) {
      throw new Error(`Failed to create handover event: ${eventError?.message}`);
    }

    // Update conversation status
    const { error: updateError } = await this.supabase
      .from('conversations')
      .update({ status: 'HANDOVER' })
      .eq('id', conversationId);

    if (updateError) {
      this.logger.error(`Failed to update conversation status: ${updateError.message}`);
    }

    this.logger.log(`Handover initiated: conversationId=${conversationId}, type=${type}`);

    return event.id;
  }

  async resume(conversationId: string): Promise<void> {
    // Find active handover
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
        throw new Error(`Failed to update handover event: ${updateError.message}`);
      }
    }

    const { error: convError } = await this.supabase
      .from('conversations')
      .update({ status: 'ACTIVE' })
      .eq('id', conversationId);

    if (convError) {
      throw new Error(`Failed to update conversation status: ${convError.message}`);
    }

    this.logger.log(`Handover resumed: conversationId=${conversationId}`);
  }

  async getActiveHandover(conversationId: string): Promise<{
    id: string;
    type: string;
    initiatedBy: string;
    note: string | null;
    createdAt: string;
  } | null> {
    const { data, error } = await this.supabase
      .from('handover_events')
      .select('id, type, initiated_by, note, created_at')
      .eq('conversation_id', conversationId)
      .eq('status', 'ACTIVE')
      .single();

    if (error && error.code !== 'PGRST116') {
      throw new Error(`Failed to query active handover: ${error.message}`);
    }

    if (!data) return null;

    return {
      id: data.id,
      type: data.type,
      initiatedBy: data.initiated_by,
      note: data.note ?? null,
      createdAt: data.created_at,
    };
  }

  async getActiveHandoverEvents(tenantId: string): Promise<{
    conversationId: string;
    ghlConversationId: string;
    contactId: string;
    channel: string;
    handoverId: string;
    handoverType: string;
    initiatedBy: string;
    note: string | null;
    createdAt: string;
  }[]> {
    const { data, error } = await this.supabase
      .from('handover_events')
      .select(`
        id,
        conversation_id,
        type,
        initiated_by,
        note,
        created_at,
        conversation:conversations!inner(
          id,
          ghl_conversation_id,
          contact_id,
          channel
        )
      `)
      .eq('conversation.tenant_id', tenantId)
      .eq('status', 'ACTIVE')
      .order('created_at', { ascending: false });

    if (error) {
      this.logger.error(`Failed to list active handover events: ${error.message}`);
      return [];
    }

    return (data ?? []).map((row: Record<string, unknown>) => {
      const conv = row['conversation'] as Record<string, unknown>;
      return {
        conversationId: conv['id'] as string,
        ghlConversationId: conv['ghl_conversation_id'] as string,
        contactId: conv['contact_id'] as string,
        channel: conv['channel'] as string,
        handoverId: row['id'] as string,
        handoverType: row['type'] as string,
        initiatedBy: row['initiated_by'] as string,
        note: (row['note'] as string) ?? null,
        createdAt: row['created_at'] as string,
      };
    });
  }

  async getHandoverHistory(conversationId: string): Promise<{
    id: string;
    type: string;
    status: string;
    initiatedBy: string;
    note: string | null;
    createdAt: string;
    resumedAt: string | null;
  }[]> {
    const { data, error } = await this.supabase
      .from('handover_events')
      .select('id, type, status, initiated_by, note, created_at, resumed_at')
      .eq('conversation_id', conversationId)
      .order('created_at', { ascending: false });

    if (error) {
      this.logger.error(`Failed to get handover history: ${error.message}`);
      return [];
    }

    return (data ?? []).map(row => ({
      id: row.id,
      type: row.type,
      status: row.status,
      initiatedBy: row.initiated_by,
      note: row.note ?? null,
      createdAt: row.created_at,
      resumedAt: row.resumed_at ?? null,
    }));
  }
}
