-- Milestone 1: tenant booking settings + intent tag rules (no conversation booking state table)

-- CreateEnum
CREATE TYPE "BookingMode" AS ENUM ('COLLECT_DETAILS_ONLY', 'CHECK_AVAILABILITY', 'BOOK_AFTER_CONFIRMATION');

-- CreateEnum
CREATE TYPE "IntentTagTriggerMode" AS ENUM ('AUTO', 'OFF');

-- CreateTable
CREATE TABLE "tenant_booking_settings" (
    "tenant_id" TEXT NOT NULL,
    "enabled" BOOLEAN NOT NULL DEFAULT false,
    "booking_mode" "BookingMode" NOT NULL DEFAULT 'COLLECT_DETAILS_ONLY',
    "default_ghl_calendar_id" TEXT,
    "default_ghl_calendar_name" TEXT,
    "required_fields_json" JSONB NOT NULL DEFAULT '[]',
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "tenant_booking_settings_pkey" PRIMARY KEY ("tenant_id")
);

-- CreateTable
CREATE TABLE "tenant_intent_tag_rules" (
    "id" TEXT NOT NULL,
    "tenant_id" TEXT NOT NULL,
    "intent_key" TEXT NOT NULL,
    "tag_name" TEXT NOT NULL,
    "enabled" BOOLEAN NOT NULL DEFAULT false,
    "trigger_mode" "IntentTagTriggerMode" NOT NULL DEFAULT 'OFF',
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "tenant_intent_tag_rules_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "tenant_intent_tag_rules_tenant_id_intent_key_key" ON "tenant_intent_tag_rules"("tenant_id", "intent_key");

-- CreateIndex
CREATE INDEX "tenant_intent_tag_rules_tenant_id_idx" ON "tenant_intent_tag_rules"("tenant_id");

-- AddForeignKey
ALTER TABLE "tenant_booking_settings" ADD CONSTRAINT "tenant_booking_settings_tenant_id_fkey" FOREIGN KEY ("tenant_id") REFERENCES "tenants"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "tenant_intent_tag_rules" ADD CONSTRAINT "tenant_intent_tag_rules_tenant_id_fkey" FOREIGN KEY ("tenant_id") REFERENCES "tenants"("id") ON DELETE CASCADE ON UPDATE CASCADE;
