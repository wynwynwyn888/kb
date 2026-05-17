// Handover service - manages AI-to-human handoff

import { Injectable, Logger, NotFoundException } from '@nestjs/common';
import { InjectQueue } from '@nestjs/bullmq';
import { Queue } from 'bullmq';
import { randomUUID } from 'crypto';
import { getSupabaseService } from '../../lib/supabase';
import {
  formatHandoverChannelLabel,
  formatHandoverContactSummary,
  formatHandoverReasonLabel,
  formatHandoverTypeLabel,
} from '../../lib/handover-display';
import { QUEUES } from '../../queues/queue.constants';
import { GhlService } from '../ghl/ghl.service';

export interface ActiveHandoverListItem {
  conversationId: string;
  ghlConversationId: string;
  contactId: string;
  channel: string;
  handoverId: string;
  handoverType: string;
  initiatedBy: string;
  note: string | null;
  createdAt: string;
  contactDisplayName: string;
  contactPhone: string | null;
  contactSummary: string;
  channelLabel: string;
  handoverTypeLabel: string;
  reasonLabel: string;
}

@Injectable()
export class HandoverService {
  private readonly logger = new Logger(HandoverService.name);
  private readonly supabase = getSupabaseService();

  constructor(
    @InjectQueue(QUEUES.HANDOVER_NOTIFY) private readonly handoverQueue: Queue,
    private readonly ghlService: GhlService,
  ) {}

  async initiate(
    conversationId: string,
    type: 'REQUEST' | 'TRANSFER',
    initiatedBy: string,
    note?: string,
  ): Promise<string> {
    const now = new Date().toISOString();
    // Insert handover event
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

  async getActiveHandoverEvents(tenantId: string): Promise<ActiveHandoverListItem[]> {
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
          channel,
          metadata
        )
      `)
      .eq('conversation.tenant_id', tenantId)
      .eq('status', 'ACTIVE')
      .order('created_at', { ascending: false });

    if (error) {
      this.logger.error(`Failed to list active handover events: ${error.message}`);
      return [];
    }

    const rows = (data ?? []).map((row: Record<string, unknown>) => {
      const conv = row['conversation'] as Record<string, unknown>;
      const metadata =
        conv['metadata'] && typeof conv['metadata'] === 'object' && !Array.isArray(conv['metadata'])
          ? (conv['metadata'] as Record<string, unknown>)
          : null;
      return {
        conversationId: conv['id'] as string,
        ghlConversationId: conv['ghl_conversation_id'] as string,
        contactId: conv['contact_id'] as string,
        channel: conv['channel'] as string,
        metadata,
        handoverId: row['id'] as string,
        handoverType: row['type'] as string,
        initiatedBy: row['initiated_by'] as string,
        note: (row['note'] as string) ?? null,
        createdAt: row['created_at'] as string,
      };
    });

    return Promise.all(
      rows.map(async row => {
        const crm = await this.resolveContactForDisplay(tenantId, row.contactId);
        const channelLabel = formatHandoverChannelLabel({
          dbChannel: row.channel,
          metadata: row.metadata,
          ghlConversationId: row.ghlConversationId,
          contact: crm.contact,
        });
        const contactSummary = formatHandoverContactSummary({
          displayName: crm.displayName,
          phone: crm.phone,
          channelLabel,
        });
        return {
          conversationId: row.conversationId,
          ghlConversationId: row.ghlConversationId,
          contactId: row.contactId,
          channel: row.channel,
          handoverId: row.handoverId,
          handoverType: row.handoverType,
          initiatedBy: row.initiatedBy,
          note: row.note,
          createdAt: row.createdAt,
          contactDisplayName: crm.displayName ?? 'Unknown contact',
          contactPhone: crm.phone,
          contactSummary,
          channelLabel,
          handoverTypeLabel: formatHandoverTypeLabel(row.handoverType),
          reasonLabel: formatHandoverReasonLabel(row.note),
        };
      }),
    );
  }

  private async resolveContactForDisplay(
    tenantId: string,
    contactId: string,
  ): Promise<{
    displayName: string | null;
    phone: string | null;
    contact: Record<string, unknown> | null;
  }> {
    const cid = contactId?.trim();
    if (!cid) return { displayName: null, phone: null, contact: null };
    try {
      const { client } = await this.ghlService.createGhlClientForConnectedTenantWorkerOrThrow(tenantId);
      const gc = await client.getContact(cid);
      if (!gc.success || !gc.contact) return { displayName: null, phone: null, contact: null };
      return {
        displayName: this.pickContactDisplayName(gc.contact),
        phone: this.pickContactPhone(gc.contact),
        contact: gc.contact,
      };
    } catch {
      return { displayName: null, phone: null, contact: null };
    }
  }

  private pickContactDisplayName(contact: Record<string, unknown>): string | null {
    const fn = typeof contact['firstName'] === 'string' ? contact['firstName'].trim() : '';
    const ln = typeof contact['lastName'] === 'string' ? contact['lastName'].trim() : '';
    const combined = [fn, ln].filter(Boolean).join(' ').trim();
    if (combined) return combined;
    const name = typeof contact['name'] === 'string' ? contact['name'].trim() : '';
    return name || null;
  }

  private pickContactPhone(contact: Record<string, unknown>): string | null {
    for (const k of ['phone', 'phoneNumber', 'primaryPhone', 'mobile']) {
      const v = contact[k];
      if (typeof v === 'string' && v.trim()) return v.trim();
    }
    return null;
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
