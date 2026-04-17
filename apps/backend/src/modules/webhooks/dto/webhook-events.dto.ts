import { WebhookProcessingStatus } from '@prisma/client';

export interface CreateWebhookEventDto {
  tenantId: string;
  externalEventId: string;
  dedupeKey: string;
  eventType: string;
  rawPayloadJson: Record<string, unknown>;
  normalizedPayloadJson?: Record<string, unknown>;
  processingStatus: WebhookProcessingStatus;
}

export interface WebhookEventResponse {
  id: string;
  tenantId: string;
  externalEventId: string;
  processingStatus: WebhookProcessingStatus;
  receivedAt: Date;
  processedAt: Date | null;
}
