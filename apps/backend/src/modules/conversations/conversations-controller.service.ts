// Conversations controller service - thin service for list/detail/message queries

import { Injectable, Logger } from '@nestjs/common';
import { formatPostgrestError } from '../../lib/format-postgrest-error';
import { getSupabaseService } from '../../lib/supabase';

@Injectable()
export class ConversationsControllerService {
  private readonly logger = new Logger(ConversationsControllerService.name);
  private readonly supabase = getSupabaseService();

  async findAll(
    tenantId: string,
    status?: string,
    page: number = 1,
    pageSize: number = 20,
  ): Promise<{ conversations: unknown[]; total: number }> {
    const from = (page - 1) * pageSize;

    let query = this.supabase
      .from('conversations')
      .select('id, ghl_conversation_id, contact_id, channel, status, last_message_at, metadata, created_at', {
        count: 'exact',
      })
      .eq('tenant_id', tenantId)
      .order('last_message_at', { ascending: false })
      .range(from, from + pageSize - 1);

    if (status) {
      query = query.eq('status', status);
    }

    const { data, error, count } = await query;

    if (error) {
      this.logger.error(`Failed to list conversations: ${error.message}`);
      return { conversations: [], total: 0 };
    }

    return {
      conversations: data ?? [],
      total: count ?? 0,
    };
  }

  async findOne(id: string): Promise<{
    id: string;
    tenantId: string;
    ghlConversationId: string;
    contactId: string;
    channel: string;
    status: string;
    lastMessageAt: string;
    metadata: Record<string, unknown>;
    createdAt: string;
  } | null> {
    const { data, error } = await this.supabase
      .from('conversations')
      .select('*')
      .eq('id', id)
      .single();

    if (error || !data) return null;

    return {
      id: data.id,
      tenantId: data.tenant_id,
      ghlConversationId: data.ghl_conversation_id,
      contactId: data.contact_id,
      channel: data.channel,
      status: data.status,
      lastMessageAt: data.last_message_at,
      metadata: (data.metadata as Record<string, unknown>) ?? {},
      createdAt: data.created_at,
    };
  }

  async getMessages(
    conversationId: string,
    limit: number = 20,
    before?: string,
  ): Promise<unknown[]> {
    let query = this.supabase
      .from('messages')
      .select('id, direction, sender, content, contentType, metadata, created_at')
      .eq('conversation_id', conversationId)
      .order('created_at', { ascending: false })
      .limit(limit);

    if (before) {
      query = query.lt('created_at', before);
    }

    const { data, error } = await query;

    if (error) {
      this.logger.error(`Failed to get messages: ${formatPostgrestError(error)}`);
      return [];
    }

    return data ?? [];
  }
}
