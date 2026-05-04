-- Bot profiles (assistant profiles) per workspace; optional link from tenant_prompt_configs for reply settings.

CREATE TABLE "tenant_bot_profiles" (
    "id" TEXT NOT NULL,
    "tenant_id" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "description" TEXT NOT NULL DEFAULT '',
    "persona" TEXT NOT NULL DEFAULT '',
    "conversation_goals" TEXT NOT NULL DEFAULT '',
    "business_notes" TEXT NOT NULL DEFAULT '',
    "tone_rules" TEXT NOT NULL DEFAULT '',
    "booking_behavior_notes" TEXT NOT NULL DEFAULT '',
    "escalation_behavior_notes" TEXT NOT NULL DEFAULT '',
    "knowledge_scope_notes" TEXT NOT NULL DEFAULT '',
    "is_active" BOOLEAN NOT NULL DEFAULT false,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "tenant_bot_profiles_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "tenant_bot_profiles_tenant_id_name_key" ON "tenant_bot_profiles"("tenant_id", "name");

CREATE UNIQUE INDEX "tenant_bot_profiles_one_active_per_tenant" ON "tenant_bot_profiles"("tenant_id") WHERE "is_active" = true;

CREATE INDEX "tenant_bot_profiles_tenant_id_idx" ON "tenant_bot_profiles"("tenant_id");

ALTER TABLE "tenant_bot_profiles" ADD CONSTRAINT "tenant_bot_profiles_tenant_id_fkey" FOREIGN KEY ("tenant_id") REFERENCES "tenants"("id") ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "tenant_prompt_configs" ADD COLUMN "bot_profile_id" TEXT;

CREATE UNIQUE INDEX "tenant_prompt_configs_bot_profile_id_key" ON "tenant_prompt_configs"("bot_profile_id") WHERE "bot_profile_id" IS NOT NULL;

ALTER TABLE "tenant_prompt_configs" ADD CONSTRAINT "tenant_prompt_configs_bot_profile_id_fkey" FOREIGN KEY ("bot_profile_id") REFERENCES "tenant_bot_profiles"("id") ON DELETE CASCADE ON UPDATE CASCADE;
