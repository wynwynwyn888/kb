// Handover service - manages AI-to-human handoff

import { Injectable, Logger, NotFoundException } from '@nestjs/common';
import { randomUUID } from 'crypto';
import { getSupabaseService } from '../../lib/supabase';
import { mergeConversationMetadataForPersist } from '../../lib/conversation-metadata-merge';
import {
  formatHandoverChannelLabel,
  formatHandoverContactSummary,
  formatHandoverReasonLabel,
  formatHandoverTypeLabel,
} from '../../lib/handover-display';
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
  triggerMessage: string | null;
  triggerMessageCreatedAt: string | null;
}

@Injectable()
export class HandoverService {
  private readonly logger = new Logger(HandoverService.name);
  private readonly supabase = getSupabaseService();

  constructor(
    private readonly ghlService: GhlService,
  ) {}

  async initiate(
    tenantId: string,
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
        tenant_id: tenantId,
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

  async resume(tenantId: string, conversationId: string): Promise<void> {
    // Find active handover
    const { data: active, error: findError } = await this.supabase
      .from('handover_events')
      .select('id')
      .eq('tenant_id', tenantId)
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
        .eq('tenant_id', tenantId)
        .eq('id', active.id);

      if (updateError) {
        throw new Error(`Failed to update handover event: ${updateError.message}`);
      }
    }

    const { data: convRow, error: convReadErr } = await this.supabase
      .from('conversations')
      .select('metadata')
      .eq('id', conversationId)
      .maybeSingle();

    if (convReadErr) {
      throw new Error(`Failed to read conversation for resume: ${convReadErr.message}`);
    }

    const prevMeta =
      convRow?.metadata && typeof convRow.metadata === 'object' && !Array.isArray(convRow.metadata)
        ? (convRow.metadata as Record<string, unknown>)
        : {};
    const {
      humanEscalationInternalAlertSentAt: _sentAt,
      humanEscalationPendingInternalAlert: _pending,
      ...metaAfterResume
    } = prevMeta;
    const mergedResume = mergeConversationMetadataForPersist(prevMeta, metaAfterResume);

    const { error: convError } = await this.supabase
      .from('conversations')
      .update({
        status: 'ACTIVE',
        metadata: mergedResume,
        updated_at: new Date().toISOString(),
      })
      .eq('id', conversationId);

    if (convError) {
      throw new Error(`Failed to update conversation status: ${convError.message}`);
    }

    this.logger.log(`Handover resumed: conversationId=${conversationId}`);
  }

  async getActiveHandover(tenantId: string, conversationId: string): Promise<{
    id: string;
    type: string;
    initiatedBy: string;
    note: string | null;
    createdAt: string;
  } | null> {
    const { data, error } = await this.supabase
      .from('handover_events')
      .select('id, type, initiated_by, note, created_at')
      .eq('tenant_id', tenantId)
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
      .eq('tenant_id', tenantId)
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
        const [crm, trigger] = await Promise.all([
          this.resolveContactForDisplay(tenantId, row.contactId),
          this.resolveTriggerMessage(tenantId, row.conversationId, row.createdAt),
        ]);
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
          triggerMessage: trigger.content,
          triggerMessageCreatedAt: trigger.createdAt,
        };
      }),
    );
  }

  private async resolveTriggerMessage(
    tenantId: string,
    conversationId: string,
    handoverCreatedAt: string,
  ): Promise<{ content: string | null; createdAt: string | null }> {
    const { data, error } = await this.supabase
      .from('messages')
      .select('content, created_at')
      .eq('tenant_id', tenantId)
      .eq('conversation_id', conversationId)
      .eq('direction', 'INBOUND')
      .eq('sender', 'CONTACT')
      .lte('created_at', handoverCreatedAt)
      .order('created_at', { ascending: false })
      .limit(1)
      .maybeSingle();

    if (error || !data) {
      if (error) {
        this.logger.warn(
          `Failed to resolve handover trigger message: conversationId=${conversationId} error=${error.message}`,
        );
      }
      return { content: null, createdAt: null };
    }

    const content = typeof data.content === 'string' ? data.content.trim() : '';
    return {
      content: content ? content.slice(0, 2000) : null,
      createdAt: typeof data.created_at === 'string' ? data.created_at : null,
    };
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

  async getHandoverHistory(tenantId: string, conversationId: string): Promise<{
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
      .eq('tenant_id', tenantId)
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
