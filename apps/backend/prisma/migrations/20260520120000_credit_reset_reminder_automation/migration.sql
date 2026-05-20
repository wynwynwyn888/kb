-- Agency credit reset / expiry reminder automation (days before period_end).

ALTER TABLE "agencies"
  ADD COLUMN IF NOT EXISTS "credit_reset_reminder_enabled" BOOLEAN NOT NULL DEFAULT FALSE,
  ADD COLUMN IF NOT EXISTS "credit_reset_reminder_days_json" JSONB NOT NULL DEFAULT '[30, 14, 7, 3, 1]'::jsonb,
  ADD COLUMN IF NOT EXISTS "credit_reset_reminder_message_template" TEXT NOT NULL DEFAULT '',
  ADD COLUMN IF NOT EXISTS "credit_reset_reminder_send_via_agency_workspace" BOOLEAN NOT NULL DEFAULT TRUE;

CREATE TABLE IF NOT EXISTS "workspace_credit_reset_reminder_events" (
  "id"                   TEXT PRIMARY KEY,
  "agency_id"            TEXT NOT NULL,
  "tenant_id"            TEXT NOT NULL,
  "days_before_reset"    INTEGER NOT NULL,
  "balance_at_send"      INTEGER NOT NULL,
  "status"               TEXT NOT NULL,
  "reason"               TEXT,
  "message_preview"      TEXT,
  "billing_period_start" TIMESTAMPTZ,
  "billing_period_end"   TIMESTAMPTZ,
  "created_at"           TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  CONSTRAINT "workspace_credit_reset_reminder_events_status_chk"
    CHECK ("status" IN ('SENT', 'SKIPPED', 'FAILED')),
  CONSTRAINT "workspace_credit_reset_reminder_events_agency_fk"
    FOREIGN KEY ("agency_id") REFERENCES "agencies" ("id") ON DELETE CASCADE,
  CONSTRAINT "workspace_credit_reset_reminder_events_tenant_fk"
    FOREIGN KEY ("tenant_id") REFERENCES "tenants" ("id") ON DELETE CASCADE
);

CREATE INDEX IF NOT EXISTS "workspace_credit_reset_reminder_events_agency_created_idx"
  ON "workspace_credit_reset_reminder_events" ("agency_id", "created_at" DESC);

CREATE INDEX IF NOT EXISTS "workspace_credit_reset_reminder_events_tenant_created_idx"
  ON "workspace_credit_reset_reminder_events" ("tenant_id", "created_at" DESC);

CREATE UNIQUE INDEX IF NOT EXISTS "workspace_credit_reset_reminder_events_sent_unique"
  ON "workspace_credit_reset_reminder_events" (
    "tenant_id",
    "days_before_reset",
    COALESCE("billing_period_end", '1970-01-01T00:00:00Z'::timestamptz)
  )
  WHERE "status" = 'SENT';
