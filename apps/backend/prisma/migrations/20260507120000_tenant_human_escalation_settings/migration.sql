-- Human escalation automation (tenant-scoped)
CREATE TABLE IF NOT EXISTS "tenant_human_escalation_settings" (
    "tenant_id" TEXT NOT NULL,
    "enabled" BOOLEAN NOT NULL DEFAULT false,
    "team_notification_number" TEXT,
    "optional_message_prefix" TEXT,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "tenant_human_escalation_settings_pkey" PRIMARY KEY ("tenant_id")
);

ALTER TABLE "tenant_human_escalation_settings"
  ADD CONSTRAINT "tenant_human_escalation_settings_tenant_id_fkey"
  FOREIGN KEY ("tenant_id") REFERENCES "tenants"("id") ON DELETE CASCADE ON UPDATE CASCADE;
