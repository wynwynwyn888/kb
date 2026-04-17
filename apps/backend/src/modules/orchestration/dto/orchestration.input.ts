// Orchestration input — the shape passed into the orchestration pipeline
// from the inbound-message processor after message persistence.

import type { NormalizedWebhookPayload } from '../../webhooks/dto/ghl-webhook.payload';

export interface OrchestrationInput {
  tenantId: string;
  conversationId: string;
  webhookEventId?: string;
  incomingMessage: NormalizedWebhookPayload;
  // Populated after orchestration loads context:
  tenant?: {
    id: string;
    name: string;
    botEnabled: boolean;
    handoverPaused: boolean;
    ghlLocationId: string;
  };
  promptConfig?: {
    id: string;
    systemPrompt: string;
    temperature: number;
    modelOverride?: string;
    isActive: boolean;
  } | null;
  agencyPolicy?: {
    id: string;
    systemPrompt: string;
    defaultModel?: string;
    fallbackModel?: string;
  } | null;
  conversation?: {
    id: string;
    ghlConversationId: string;
    contactId: string;
    channel: string;
    status: string;
    metadata: Record<string, unknown>;
  };
}
