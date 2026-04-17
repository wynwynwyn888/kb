// Inbound Message Processor
// Processes incoming messages from GHL webhooks
// This is the minimal skeleton — actual AI routing, KB retrieval, formatter, and outbound sending are TODO

import { Processor, WorkerHost, OnWorkerEvent } from '@nestjs/bullmq';
import { Job } from 'bullmq';
import { Injectable, Logger } from '@nestjs/common';
import { getSupabaseService } from '../../../lib/supabase';
import { QUEUES } from '../queue.constants';

export interface InboundMessageJobData {
  locationId: string;
  ghlConversationId: string;
  ghlContactId: string;
  messageContent: string;
  messageType: 'text' | 'image' | 'audio' | 'video' | 'unknown';
  timestamp: string;
  webhookEventId?: string;
}

@Processor(QUEUES.INBOUND_MESSAGE_PROCESSOR)
@Injectable()
export class InboundMessageProcessor extends WorkerHost {
  private readonly logger = new Logger(InboundMessageProcessor.name);
  private readonly supabase = getSupabaseService();

  async process(job: Job<InboundMessageJobData>): Promise<void> {
    const {
      locationId,
      ghlConversationId,
      ghlContactId,
      messageContent,
      messageType,
      timestamp,
      webhookEventId,
    } = job.data;

    this.logger.log(
      `Processing inbound message: conversationId=${ghlConversationId}, type=${messageType}`,
    );

    // Update webhook event status to PROCESSING
    if (webhookEventId) {
      await this.updateWebhookEventStatus(webhookEventId, 'PROCESSING');
    }

    try {
      // Step 1: Load tenant by locationId
      const tenant = await this.findTenantByLocationId(locationId);
      if (!tenant) {
        throw new Error(`Tenant not found for locationId: ${locationId}`);
      }

      // Step 2: Get or create conversation (upsert by ghlConversationId)
      const conversation = await this.getOrCreateConversation(
        tenant.id,
        ghlConversationId,
        ghlContactId,
        timestamp,
      );

      // Step 3: Store inbound message
      await this.addMessage(conversation.id, {
        direction: 'INBOUND',
        sender: 'CONTACT',
        content: messageContent,
        contentType: messageType,
        metadata: {
          ghlMessageId: webhookEventId,
          receivedAt: timestamp,
        },
      });

      // Step 4-11: TODO — future layers handle these:
      // - Check if conversation is in handover → skip AI
      // - Load conversation context (last N turns)
      // - Search KB for relevant info
      // - Build prompt with system prompt + context + KB
      // - Route to AI model
      // - Format response
      // - Enqueue send-bubble job
      // - Deduct quota on successful send

      this.logger.log(
        `Message stored: conversationId=${conversation.id}, messageType=${messageType}`,
      );

      // Mark webhook event as COMPLETED
      if (webhookEventId) {
        await this.updateWebhookEventStatus(webhookEventId, 'COMPLETED');
      }
    } catch (error) {
      const message = error instanceof Error ? error.message : 'unknown';
      this.logger.error(`Failed to process inbound message: ${message}`);

      if (webhookEventId) {
        await this.updateWebhookEventStatus(
          webhookEventId,
          'FAILED',
          message,
        );
      }

      throw error;
    }
  }

  private async findTenantByLocationId(
    locationId: string,
  ): Promise<{ id: string } | null> {
    const { data } = await this.supabase
      .from('tenants')
      .select('id')
      .eq('ghl_location_id', locationId)
      .single();

    return data;
  }

  /**
   * Upsert conversation:
   * - If ghlConversationId is present and non-empty: upsert by (tenantId, ghlConversationId)
   * - If missing: use provisional ID = "prov:{contactId}:{timestamp}" and store in metadata
   */
  private async getOrCreateConversation(
    tenantId: string,
    ghlConversationId: string,
    contactId: string,
    timestamp: string,
  ): Promise<{ id: string }> {
    // Check if conversation already exists by ghlConversationId
    if (ghlConversationId && ghlConversationId.trim() !== '') {
      const { data: existing } = await this.supabase
        .from('conversations')
        .select('id')
        .eq('ghl_conversation_id', ghlConversationId)
        .single();

      if (existing) {
        return existing;
      }

      // Create new conversation with stable ID
      const { data, error } = await this.supabase
        .from('conversations')
        .insert({
          tenant_id: tenantId,
          ghl_conversation_id: ghlConversationId,
          contact_id: contactId,
          channel: 'WHATSAPP', // TODO: infer from payload when GHL sends channel info
          status: 'ACTIVE',
          last_message_at: new Date().toISOString(),
        })
        .select('id')
        .single();

      if (error || !data) {
        throw new Error(`Failed to create conversation: ${error?.message}`);
      }

      return data;
    }

    // Provisional fallback — no stable conversation ID
    const provisionalGhlConversationId = `prov:${contactId}:${timestamp}`;
    const provisionalKey = `prov:${contactId}`;

    this.logger.warn(
      `Conversation created with provisional ID for tenant=${tenantId}, contactId=${contactId}`,
    );

    const { data: existing } = await this.supabase
      .from('conversations')
      .select('id')
      .eq('tenant_id', tenantId)
      .eq('ghl_conversation_id', provisionalGhlConversationId)
      .single();

    if (existing) {
      return existing;
    }

    const { data, error } = await this.supabase
      .from('conversations')
      .insert({
        tenant_id: tenantId,
        ghl_conversation_id: provisionalGhlConversationId,
        contact_id: contactId,
        channel: 'WHATSAPP', // TODO: infer from payload
        status: 'ACTIVE',
        last_message_at: new Date().toISOString(),
        metadata: {
          provisional: true,
          provisionalKey,
          originalTimestamp: timestamp,
        },
      })
      .select('id')
      .single();

    if (error || !data) {
      throw new Error(`Failed to create provisional conversation: ${error?.message}`);
    }

    return data;
  }

  private async addMessage(
    conversationId: string,
    message: {
      direction: string;
      sender: string;
      content: string;
      contentType: string;
      metadata: Record<string, unknown>;
    },
  ): Promise<void> {
    const { error } = await this.supabase.from('messages').insert({
      conversation_id: conversationId,
      direction: message.direction,
      sender: message.sender,
      content: message.content,
      content_type: message.contentType,
      metadata: message.metadata,
    });

    if (error) {
      throw new Error(`Failed to add message: ${error.message}`);
    }
  }

  private async updateWebhookEventStatus(
    eventId: string,
    status: string,
    errorMessage?: string,
  ): Promise<void> {
    const updateData: Record<string, unknown> = {
      processing_status: status,
      processed_at: new Date().toISOString(),
    };

    if (errorMessage) {
      updateData.processing_error = errorMessage;
    }

    await this.supabase
      .from('webhook_events')
      .update(updateData)
      .eq('external_event_id', eventId);
  }

  @OnWorkerEvent('completed')
  onCompleted(job: Job) {
    this.logger.log(`Inbound message job ${job.id} completed`);
  }

  @OnWorkerEvent('failed')
  onFailed(job: Job, error: Error) {
    this.logger.error(
      `Inbound message job ${job.id} failed: ${error.message}`,
    );
  }
}
