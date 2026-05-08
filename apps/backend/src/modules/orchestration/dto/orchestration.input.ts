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
    /** Suggestive: AI runs but auto-replies to GHL are not sent. */
    botMode: 'off' | 'suggestive' | 'autopilot';
    handoverPaused: boolean;
    ghlLocationId: string;
    /** Optional IANA zone for business-local greetings; defaults to app timezone. */
    timeZone?: string;
  };
  /** Built from active `tenant_bot_profiles` (+ linked reply settings in `tenant_prompt_configs`), or legacy prompt row. */
  promptConfig?: {
    id: string;
    systemPrompt: string;
    /** Assistant profile business notes (additional section); empty when legacy blob only. */
    businessNotes?: string;
    temperature: number;
    modelOverride?: string;
    maxTokens: number | null;
    isActive: boolean;
    /** ISO timestamp of last config save — used to invalidate stale option memory. */
    updatedAt?: string | null;
  } | null;
  /** From `agency_system_policies`; `systemPrompt` is the `content` column. */
  agencyPolicy?: {
    id: string;
    systemPrompt: string;
  } | null;
  conversation?: {
    id: string;
    ghlConversationId: string;
    contactId: string;
    channel: string;
    status: string;
    metadata: Record<string, unknown>;
  };
  /** Recent inbound customer texts (oldest → newest): latest **N** CONTACT messages in this debounced batch. */
  recentInboundBatch?: string[];

  /** Optional timings from inbound worker ingress (milliseconds, numeric only — no payloads). */
  orchestrationIngressTimings?: {
    /**
     * Wall ms from enqueue of the debounced `orchestrate` Bull job (after persist) until this
     * orchestration run starts — approximates debounce + queue wait. Omitted when implausible.
     */
    orchestrateQueueWaitMs?: number | null;
    debounceConfiguredMs?: number | null;
  };
}
