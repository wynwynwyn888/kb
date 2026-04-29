-- Automation v2: configurable tag rules, booking core/custom fields, follow-up settings

DROP TABLE IF EXISTS "tenant_intent_tag_rules";
DROP TYPE IF EXISTS "IntentTagTriggerMode";

CREATE TYPE "TagMatchMode" AS ENUM ('AI', 'KEYWORD', 'HYBRID');
CREATE TYPE "ConfidenceThreshold" AS ENUM ('LOW', 'NORMAL', 'HIGH');

CREATE TABLE "tenant_tagging_settings" (
    "tenant_id" TEXT NOT NULL,
    "automatic_tagging_enabled" BOOLEAN NOT NULL DEFAULT false,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "tenant_tagging_settings_pkey" PRIMARY KEY ("tenant_id")
);

CREATE TABLE "tenant_tag_rules" (
    "id" TEXT NOT NULL,
    "tenant_id" TEXT NOT NULL,
    "enabled" BOOLEAN NOT NULL DEFAULT true,
    "auto_apply" BOOLEAN NOT NULL DEFAULT false,
    "rule_name" TEXT NOT NULL,
    "rule_description" TEXT NOT NULL,
    "crm_tag_id" TEXT,
    "crm_tag_name" TEXT NOT NULL,
    "match_mode" "TagMatchMode" NOT NULL DEFAULT 'AI',
    "confidence_threshold" "ConfidenceThreshold" NOT NULL DEFAULT 'NORMAL',
    "priority" INTEGER NOT NULL DEFAULT 0,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "tenant_tag_rules_pkey" PRIMARY KEY ("id")
);

CREATE INDEX "tenant_tag_rules_tenant_id_idx" ON "tenant_tag_rules"("tenant_id");

ALTER TABLE "tenant_tagging_settings" ADD CONSTRAINT "tenant_tagging_settings_tenant_id_fkey" FOREIGN KEY ("tenant_id") REFERENCES "tenants"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "tenant_tag_rules" ADD CONSTRAINT "tenant_tag_rules_tenant_id_fkey" FOREIGN KEY ("tenant_id") REFERENCES "tenants"("id") ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "tenant_booking_settings" ADD COLUMN "core_required_fields_json" JSONB NOT NULL DEFAULT '[]';
ALTER TABLE "tenant_booking_settings" ADD COLUMN "custom_fields_json" JSONB NOT NULL DEFAULT '[]';
ALTER TABLE "tenant_booking_settings" ADD COLUMN "max_bookings_per_slot" INTEGER NOT NULL DEFAULT 1;

UPDATE "tenant_booking_settings" SET "core_required_fields_json" = COALESCE("required_fields_json", '[]'::jsonb);

ALTER TABLE "tenant_booking_settings" DROP COLUMN "required_fields_json";

CREATE TABLE "tenant_follow_up_settings" (
    "tenant_id" TEXT NOT NULL,
    "enabled" BOOLEAN NOT NULL DEFAULT false,
    "max_follow_ups" INTEGER NOT NULL DEFAULT 3,
    "stop_on_customer_reply" BOOLEAN NOT NULL DEFAULT true,
    "stop_on_booking_completed" BOOLEAN NOT NULL DEFAULT true,
    "stop_on_escalated" BOOLEAN NOT NULL DEFAULT true,
    "stop_on_opt_out" BOOLEAN NOT NULL DEFAULT true,
    "business_hours_only" BOOLEAN NOT NULL DEFAULT false,
    "steps_json" JSONB NOT NULL DEFAULT '[]',
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "tenant_follow_up_settings_pkey" PRIMARY KEY ("tenant_id")
);

ALTER TABLE "tenant_follow_up_settings" ADD CONSTRAINT "tenant_follow_up_settings_tenant_id_fkey" FOREIGN KEY ("tenant_id") REFERENCES "tenants"("id") ON DELETE CASCADE ON UPDATE CASCADE;
