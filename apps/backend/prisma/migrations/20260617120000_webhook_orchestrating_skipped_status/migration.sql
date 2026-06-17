-- Webhook lifecycle: orchestration in-flight + audit skipped routing
ALTER TYPE "WebhookProcessingStatus" ADD VALUE IF NOT EXISTS 'ORCHESTRATING';
ALTER TYPE "WebhookProcessingStatus" ADD VALUE IF NOT EXISTS 'SKIPPED';
