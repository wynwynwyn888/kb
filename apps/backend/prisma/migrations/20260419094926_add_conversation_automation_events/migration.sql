-- CreateEnum
CREATE TYPE "AgencyRole" AS ENUM ('OWNER', 'ADMIN', 'OPERATOR', 'MEMBER');

-- CreateEnum
CREATE TYPE "TenantRole" AS ENUM ('ADMIN', 'AGENT', 'VIEWER');

-- CreateEnum
CREATE TYPE "GhlConnectionStatus" AS ENUM ('DISCONNECTED', 'CONNECTED', 'INVALID', 'ERROR');

-- CreateEnum
CREATE TYPE "AiProvider" AS ENUM ('OPENAI', 'ANTHROPIC', 'GOOGLE', 'AZURE', 'CUSTOM');

-- CreateEnum
CREATE TYPE "DocumentStatus" AS ENUM ('PENDING', 'PROCESSING', 'READY', 'FAILED');

-- CreateEnum
CREATE TYPE "ConversationChannel" AS ENUM ('WHATSAPP', 'SMS', 'CHAT', 'EMAIL');

-- CreateEnum
CREATE TYPE "ConversationStatus" AS ENUM ('ACTIVE', 'HANDOVER', 'CLOSED', 'PENDING', 'PAUSED');

-- CreateEnum
CREATE TYPE "MessageDirection" AS ENUM ('INBOUND', 'OUTBOUND');

-- CreateEnum
CREATE TYPE "MessageSender" AS ENUM ('CONTACT', 'AI', 'AGENT', 'SYSTEM');

-- CreateEnum
CREATE TYPE "ContentType" AS ENUM ('TEXT', 'IMAGE', 'VIDEO', 'DOCUMENT', 'AUDIO');

-- CreateEnum
CREATE TYPE "HandoverType" AS ENUM ('REQUEST', 'TRANSFER');

-- CreateEnum
CREATE TYPE "HandoverStatus" AS ENUM ('ACTIVE', 'RESUMED', 'TIMEOUT');

-- CreateEnum
CREATE TYPE "QuotaTransactionType" AS ENUM ('CREDIT', 'DEBIT');

-- CreateEnum
CREATE TYPE "ActionType" AS ENUM ('TAG_CONTACT', 'UPDATE_CALENDAR', 'SEND_REPLY', 'KB_RETRIEVE', 'AI_GENERATE');

-- CreateEnum
CREATE TYPE "ActionStatus" AS ENUM ('PENDING', 'SUCCESS', 'FAILED');

-- CreateEnum
CREATE TYPE "ActionIntentStatus" AS ENUM ('SUGGESTED', 'ALLOWED', 'DEFERRED', 'BLOCKED', 'EXECUTED', 'FAILED');

-- CreateEnum
CREATE TYPE "NotificationType" AS ENUM ('HANDOVER', 'QUOTA_WARNING', 'KB_INGEST_COMPLETE', 'ERROR');

-- CreateEnum
CREATE TYPE "WebhookProvider" AS ENUM ('GHL');

-- CreateEnum
CREATE TYPE "WebhookProcessingStatus" AS ENUM ('RECEIVED', 'PROCESSING', 'COMPLETED', 'FAILED', 'DUPLICATE');

-- CreateEnum
CREATE TYPE "OrchestrationOutcome" AS ENUM ('PROCEED', 'SKIP_BOT_DISABLED', 'SKIP_GHL_DISCONNECTED', 'SKIP_HANDOVER_ACTIVE', 'SKIP_QUOTA_EXHAUSTED', 'SKIP_UNSUPPORTED_MESSAGE_TYPE', 'SKIP_UNSUPPORTED_CHANNEL', 'SKIP_DUPLICATE', 'ERROR');

-- CreateTable
CREATE TABLE "profiles" (
    "id" TEXT NOT NULL,
    "email" TEXT NOT NULL,
    "full_name" TEXT,
    "avatar_url" TEXT,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "profiles_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "agencies" (
    "id" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "settings" JSONB NOT NULL DEFAULT '{}',
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "agencies_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "agency_users" (
    "id" TEXT NOT NULL,
    "agency_id" TEXT NOT NULL,
    "profile_id" TEXT NOT NULL,
    "role" "AgencyRole" NOT NULL DEFAULT 'MEMBER',
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "agency_users_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "tenants" (
    "id" TEXT NOT NULL,
    "agency_id" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "ghl_location_id" TEXT NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'pending',
    "settings" JSONB NOT NULL DEFAULT '{}',
    "bot_enabled" BOOLEAN NOT NULL DEFAULT true,
    "handover_paused" BOOLEAN NOT NULL DEFAULT false,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "tenants_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "tenant_users" (
    "id" TEXT NOT NULL,
    "tenant_id" TEXT NOT NULL,
    "profile_id" TEXT NOT NULL,
    "role" "TenantRole" NOT NULL DEFAULT 'VIEWER',
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "tenant_users_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "tenant_ghl_connections" (
    "id" TEXT NOT NULL,
    "tenant_id" TEXT NOT NULL,
    "ghl_location_id" TEXT NOT NULL,
    "private_token_encrypted" TEXT NOT NULL,
    "scopes_snapshot" TEXT,
    "token_issued_at" TIMESTAMP(3),
    "token_expires_at" TIMESTAMP(3),
    "status" "GhlConnectionStatus" NOT NULL DEFAULT 'DISCONNECTED',
    "verified_at" TIMESTAMP(3),
    "last_health_check_at" TIMESTAMP(3),
    "last_error" TEXT,
    "metadata" JSONB NOT NULL DEFAULT '{}',
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "tenant_ghl_connections_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "agency_model_providers" (
    "id" TEXT NOT NULL,
    "agency_id" TEXT NOT NULL,
    "provider" "AiProvider" NOT NULL,
    "api_key" TEXT NOT NULL,
    "endpoint" TEXT,
    "settings" JSONB NOT NULL DEFAULT '{}',
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "agency_model_providers_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "agency_system_policies" (
    "id" TEXT NOT NULL,
    "agency_id" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "content" TEXT NOT NULL,
    "priority" INTEGER NOT NULL DEFAULT 0,
    "is_default" BOOLEAN NOT NULL DEFAULT false,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "agency_system_policies_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "tenant_prompt_configs" (
    "id" TEXT NOT NULL,
    "tenant_id" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "system_prompt" TEXT NOT NULL,
    "temperature" DOUBLE PRECISION NOT NULL DEFAULT 0.7,
    "model_override" TEXT,
    "max_tokens" INTEGER,
    "prompt_variables" JSONB NOT NULL DEFAULT '{}',
    "is_active" BOOLEAN NOT NULL DEFAULT true,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "tenant_prompt_configs_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "tenant_model_overrides" (
    "id" TEXT NOT NULL,
    "tenant_id" TEXT NOT NULL,
    "provider" "AiProvider" NOT NULL,
    "model" TEXT NOT NULL,
    "temperature" DOUBLE PRECISION,
    "max_tokens" INTEGER,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "tenant_model_overrides_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "knowledge_documents" (
    "id" TEXT NOT NULL,
    "tenant_id" TEXT NOT NULL,
    "title" TEXT NOT NULL,
    "source" TEXT NOT NULL,
    "mime_type" TEXT NOT NULL,
    "size" INTEGER NOT NULL,
    "status" "DocumentStatus" NOT NULL DEFAULT 'PENDING',
    "metadata" JSONB NOT NULL DEFAULT '{}',
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "knowledge_documents_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "knowledge_chunks" (
    "id" TEXT NOT NULL,
    "document_id" TEXT NOT NULL,
    "content" TEXT NOT NULL,
    "token_count" INTEGER NOT NULL,
    "metadata" JSONB NOT NULL DEFAULT '{}',
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "knowledge_chunks_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "conversations" (
    "id" TEXT NOT NULL,
    "tenant_id" TEXT NOT NULL,
    "ghl_conversation_id" TEXT NOT NULL,
    "contact_id" TEXT NOT NULL,
    "channel" "ConversationChannel" NOT NULL,
    "status" "ConversationStatus" NOT NULL DEFAULT 'PENDING',
    "last_message_at" TIMESTAMP(3) NOT NULL,
    "metadata" JSONB NOT NULL DEFAULT '{}',
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "conversations_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "messages" (
    "id" TEXT NOT NULL,
    "conversation_id" TEXT NOT NULL,
    "direction" "MessageDirection" NOT NULL,
    "sender" "MessageSender" NOT NULL,
    "content" TEXT NOT NULL,
    "contentType" "ContentType" NOT NULL DEFAULT 'TEXT',
    "metadata" JSONB NOT NULL DEFAULT '{}',
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "messages_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "handover_events" (
    "id" TEXT NOT NULL,
    "conversation_id" TEXT NOT NULL,
    "type" "HandoverType" NOT NULL,
    "status" "HandoverStatus" NOT NULL DEFAULT 'ACTIVE',
    "initiated_by" TEXT NOT NULL,
    "note" TEXT,
    "resumed_at" TIMESTAMP(3),
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "handover_events_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "conversation_automation_events" (
    "id" TEXT NOT NULL,
    "conversation_id" TEXT NOT NULL,
    "previous_state" TEXT,
    "new_state" TEXT NOT NULL,
    "actor_id" TEXT,
    "actor_email" TEXT,
    "reason" TEXT,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "conversation_automation_events_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "quota_wallets" (
    "id" TEXT NOT NULL,
    "tenant_id" TEXT NOT NULL,
    "total_quota" INTEGER NOT NULL DEFAULT 0,
    "used_quota" INTEGER NOT NULL DEFAULT 0,
    "period_start" TIMESTAMP(3) NOT NULL,
    "period_end" TIMESTAMP(3) NOT NULL,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "quota_wallets_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "quota_ledgers" (
    "id" TEXT NOT NULL,
    "wallet_id" TEXT NOT NULL,
    "amount" INTEGER NOT NULL,
    "type" "QuotaTransactionType" NOT NULL,
    "description" TEXT NOT NULL,
    "conversation_id" TEXT,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "quota_ledgers_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "action_logs" (
    "id" TEXT NOT NULL,
    "tenant_id" TEXT NOT NULL,
    "conversation_id" TEXT,
    "action_type" "ActionType" NOT NULL,
    "status" "ActionStatus" NOT NULL DEFAULT 'PENDING',
    "details" JSONB NOT NULL DEFAULT '{}',
    "error" TEXT,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "action_logs_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "action_intents" (
    "id" TEXT NOT NULL,
    "tenant_id" TEXT NOT NULL,
    "conversation_id" TEXT,
    "action_type" "ActionType" NOT NULL,
    "source" TEXT NOT NULL DEFAULT 'AI',
    "status" "ActionIntentStatus" NOT NULL DEFAULT 'SUGGESTED',
    "params" JSONB NOT NULL DEFAULT '{}',
    "reason" TEXT,
    "gating_note" TEXT,
    "executed_at" TIMESTAMP(3),
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "action_intents_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "audit_logs" (
    "id" TEXT NOT NULL,
    "agency_id" TEXT NOT NULL,
    "profile_id" TEXT NOT NULL,
    "tenant_id" TEXT,
    "action" TEXT NOT NULL,
    "resource" TEXT NOT NULL,
    "resource_id" TEXT,
    "changes" JSONB NOT NULL DEFAULT '{}',
    "ip_address" TEXT,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "audit_logs_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "webhook_events" (
    "id" TEXT NOT NULL,
    "tenant_id" TEXT NOT NULL,
    "external_event_id" TEXT NOT NULL,
    "dedupe_key" TEXT NOT NULL,
    "provider" "WebhookProvider" NOT NULL DEFAULT 'GHL',
    "event_type" TEXT NOT NULL,
    "raw_payload_json" JSONB NOT NULL,
    "normalized_payload_json" JSONB,
    "processing_status" "WebhookProcessingStatus" NOT NULL DEFAULT 'RECEIVED',
    "processing_error" TEXT,
    "received_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "processed_at" TIMESTAMP(3),
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "webhook_events_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "orchestration_logs" (
    "id" TEXT NOT NULL,
    "tenant_id" TEXT NOT NULL,
    "conversation_id" TEXT NOT NULL,
    "webhook_event_id" TEXT,
    "outcome" "OrchestrationOutcome" NOT NULL DEFAULT 'ERROR',
    "guard_reason" TEXT,
    "model_chosen" TEXT,
    "response_mode" TEXT,
    "draft_reply" TEXT,
    "handover_recommended" BOOLEAN NOT NULL DEFAULT false,
    "confidence" DOUBLE PRECISION,
    "metadata" JSONB NOT NULL DEFAULT '{}',
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "orchestration_logs_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "notifications" (
    "id" TEXT NOT NULL,
    "profile_id" TEXT NOT NULL,
    "type" "NotificationType" NOT NULL,
    "title" TEXT NOT NULL,
    "message" TEXT NOT NULL,
    "read" BOOLEAN NOT NULL DEFAULT false,
    "data" JSONB NOT NULL DEFAULT '{}',
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "notifications_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "profiles_email_key" ON "profiles"("email");

-- CreateIndex
CREATE INDEX "agency_users_profile_id_idx" ON "agency_users"("profile_id");

-- CreateIndex
CREATE UNIQUE INDEX "agency_users_agency_id_profile_id_key" ON "agency_users"("agency_id", "profile_id");

-- CreateIndex
CREATE INDEX "tenants_agency_id_idx" ON "tenants"("agency_id");

-- CreateIndex
CREATE UNIQUE INDEX "tenants_ghl_location_id_key" ON "tenants"("ghl_location_id");

-- CreateIndex
CREATE INDEX "tenant_users_profile_id_idx" ON "tenant_users"("profile_id");

-- CreateIndex
CREATE UNIQUE INDEX "tenant_users_tenant_id_profile_id_key" ON "tenant_users"("tenant_id", "profile_id");

-- CreateIndex
CREATE UNIQUE INDEX "tenant_ghl_connections_tenant_id_key" ON "tenant_ghl_connections"("tenant_id");

-- CreateIndex
CREATE UNIQUE INDEX "agency_model_providers_agency_id_provider_key" ON "agency_model_providers"("agency_id", "provider");

-- CreateIndex
CREATE INDEX "agency_system_policies_agency_id_idx" ON "agency_system_policies"("agency_id");

-- CreateIndex
CREATE INDEX "tenant_prompt_configs_tenant_id_idx" ON "tenant_prompt_configs"("tenant_id");

-- CreateIndex
CREATE UNIQUE INDEX "tenant_model_overrides_tenant_id_provider_key" ON "tenant_model_overrides"("tenant_id", "provider");

-- CreateIndex
CREATE INDEX "knowledge_documents_tenant_id_idx" ON "knowledge_documents"("tenant_id");

-- CreateIndex
CREATE INDEX "knowledge_chunks_document_id_idx" ON "knowledge_chunks"("document_id");

-- CreateIndex
CREATE INDEX "conversations_tenant_id_idx" ON "conversations"("tenant_id");

-- CreateIndex
CREATE UNIQUE INDEX "conversations_ghl_conversation_id_key" ON "conversations"("ghl_conversation_id");

-- CreateIndex
CREATE INDEX "messages_conversation_id_idx" ON "messages"("conversation_id");

-- CreateIndex
CREATE INDEX "handover_events_conversation_id_idx" ON "handover_events"("conversation_id");

-- CreateIndex
CREATE INDEX "conversation_automation_events_conversation_id_idx" ON "conversation_automation_events"("conversation_id");

-- CreateIndex
CREATE UNIQUE INDEX "quota_wallets_tenant_id_key" ON "quota_wallets"("tenant_id");

-- CreateIndex
CREATE INDEX "quota_ledgers_wallet_id_idx" ON "quota_ledgers"("wallet_id");

-- CreateIndex
CREATE INDEX "action_logs_tenant_id_idx" ON "action_logs"("tenant_id");

-- CreateIndex
CREATE INDEX "action_intents_tenant_id_idx" ON "action_intents"("tenant_id");

-- CreateIndex
CREATE INDEX "action_intents_conversation_id_idx" ON "action_intents"("conversation_id");

-- CreateIndex
CREATE INDEX "action_intents_status_idx" ON "action_intents"("status");

-- CreateIndex
CREATE UNIQUE INDEX "action_intents_tenant_id_conversation_id_action_type_source_key" ON "action_intents"("tenant_id", "conversation_id", "action_type", "source");

-- CreateIndex
CREATE INDEX "audit_logs_agency_id_idx" ON "audit_logs"("agency_id");

-- CreateIndex
CREATE INDEX "audit_logs_profile_id_idx" ON "audit_logs"("profile_id");

-- CreateIndex
CREATE INDEX "webhook_events_tenant_id_idx" ON "webhook_events"("tenant_id");

-- CreateIndex
CREATE INDEX "webhook_events_processing_status_idx" ON "webhook_events"("processing_status");

-- CreateIndex
CREATE UNIQUE INDEX "webhook_events_tenant_id_external_event_id_key" ON "webhook_events"("tenant_id", "external_event_id");

-- CreateIndex
CREATE INDEX "orchestration_logs_tenant_id_idx" ON "orchestration_logs"("tenant_id");

-- CreateIndex
CREATE INDEX "orchestration_logs_conversation_id_idx" ON "orchestration_logs"("conversation_id");

-- CreateIndex
CREATE INDEX "notifications_profile_id_idx" ON "notifications"("profile_id");

-- AddForeignKey
ALTER TABLE "agency_users" ADD CONSTRAINT "agency_users_agency_id_fkey" FOREIGN KEY ("agency_id") REFERENCES "agencies"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "agency_users" ADD CONSTRAINT "agency_users_profile_id_fkey" FOREIGN KEY ("profile_id") REFERENCES "profiles"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "tenants" ADD CONSTRAINT "tenants_agency_id_fkey" FOREIGN KEY ("agency_id") REFERENCES "agencies"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "tenant_users" ADD CONSTRAINT "tenant_users_tenant_id_fkey" FOREIGN KEY ("tenant_id") REFERENCES "tenants"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "tenant_users" ADD CONSTRAINT "tenant_users_profile_id_fkey" FOREIGN KEY ("profile_id") REFERENCES "profiles"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "tenant_ghl_connections" ADD CONSTRAINT "tenant_ghl_connections_tenant_id_fkey" FOREIGN KEY ("tenant_id") REFERENCES "tenants"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "agency_model_providers" ADD CONSTRAINT "agency_model_providers_agency_id_fkey" FOREIGN KEY ("agency_id") REFERENCES "agencies"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "agency_system_policies" ADD CONSTRAINT "agency_system_policies_agency_id_fkey" FOREIGN KEY ("agency_id") REFERENCES "agencies"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "tenant_prompt_configs" ADD CONSTRAINT "tenant_prompt_configs_tenant_id_fkey" FOREIGN KEY ("tenant_id") REFERENCES "tenants"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "tenant_model_overrides" ADD CONSTRAINT "tenant_model_overrides_tenant_id_fkey" FOREIGN KEY ("tenant_id") REFERENCES "tenants"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "knowledge_documents" ADD CONSTRAINT "knowledge_documents_tenant_id_fkey" FOREIGN KEY ("tenant_id") REFERENCES "tenants"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "knowledge_chunks" ADD CONSTRAINT "knowledge_chunks_document_id_fkey" FOREIGN KEY ("document_id") REFERENCES "knowledge_documents"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "conversations" ADD CONSTRAINT "conversations_tenant_id_fkey" FOREIGN KEY ("tenant_id") REFERENCES "tenants"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "messages" ADD CONSTRAINT "messages_conversation_id_fkey" FOREIGN KEY ("conversation_id") REFERENCES "conversations"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "handover_events" ADD CONSTRAINT "handover_events_conversation_id_fkey" FOREIGN KEY ("conversation_id") REFERENCES "conversations"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "conversation_automation_events" ADD CONSTRAINT "conversation_automation_events_conversation_id_fkey" FOREIGN KEY ("conversation_id") REFERENCES "conversations"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "quota_wallets" ADD CONSTRAINT "quota_wallets_tenant_id_fkey" FOREIGN KEY ("tenant_id") REFERENCES "tenants"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "quota_ledgers" ADD CONSTRAINT "quota_ledgers_wallet_id_fkey" FOREIGN KEY ("wallet_id") REFERENCES "quota_wallets"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "action_logs" ADD CONSTRAINT "action_logs_tenant_id_fkey" FOREIGN KEY ("tenant_id") REFERENCES "tenants"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "action_logs" ADD CONSTRAINT "action_logs_conversation_id_fkey" FOREIGN KEY ("conversation_id") REFERENCES "conversations"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "action_intents" ADD CONSTRAINT "action_intents_tenant_id_fkey" FOREIGN KEY ("tenant_id") REFERENCES "tenants"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "action_intents" ADD CONSTRAINT "action_intents_conversation_id_fkey" FOREIGN KEY ("conversation_id") REFERENCES "conversations"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "audit_logs" ADD CONSTRAINT "audit_logs_agency_id_fkey" FOREIGN KEY ("agency_id") REFERENCES "agencies"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "audit_logs" ADD CONSTRAINT "audit_logs_tenant_id_fkey" FOREIGN KEY ("tenant_id") REFERENCES "tenants"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "webhook_events" ADD CONSTRAINT "webhook_events_tenant_id_fkey" FOREIGN KEY ("tenant_id") REFERENCES "tenants"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "orchestration_logs" ADD CONSTRAINT "orchestration_logs_tenant_id_fkey" FOREIGN KEY ("tenant_id") REFERENCES "tenants"("id") ON DELETE CASCADE ON UPDATE CASCADE;
