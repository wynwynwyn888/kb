-- Workspace credit lifecycle + agency system workspace + low-credit warning automation.
-- Adds tenant flags, client profile fields, agency warning settings (defaults), and a tracking
-- table for sent / skipped / failed low-credit warnings. Existing wallet billing-period columns
-- (`quota_wallets.period_start` / `period_end`) are reused as the workspace annual reset date.

------------------------------------------------------------------------------------------
-- TENANTS: agency system workspace flag, unlimited-credit flag, client contact profile
------------------------------------------------------------------------------------------
ALTER TABLE "tenants"
  ADD COLUMN IF NOT EXISTS "is_agency_workspace" BOOLEAN NOT NULL DEFAULT FALSE,
  ADD COLUMN IF NOT EXISTS "credits_unlimited"   BOOLEAN NOT NULL DEFAULT FALSE,
  ADD COLUMN IF NOT EXISTS "client_contact_name"  TEXT,
  ADD COLUMN IF NOT EXISTS "client_contact_phone" TEXT,
  ADD COLUMN IF NOT EXISTS "client_contact_email" TEXT;

-- Exactly one agency system workspace per agency.
CREATE UNIQUE INDEX IF NOT EXISTS "tenants_one_agency_workspace_per_agency"
  ON "tenants" ("agency_id")
  WHERE "is_agency_workspace" = TRUE;

------------------------------------------------------------------------------------------
-- AGENCIES: low-credit warning automation defaults
-- Reuses existing single-threshold legacy columns; adds a JSON array of enabled thresholds
-- plus the agency-customizable warning message template and the "send via agency workspace"
-- toggle. Defaults are applied at the application layer (see DEFAULT_LOW_CREDIT_WARNING_MESSAGE
-- in apps/backend/src/modules/credit-warnings) so the schema-side defaults stay simple.
------------------------------------------------------------------------------------------
ALTER TABLE "agencies"
  ADD COLUMN IF NOT EXISTS "low_credit_warning_thresholds_json" JSONB NOT NULL DEFAULT '[2000, 1000, 500, 200]'::jsonb,
  ADD COLUMN IF NOT EXISTS "low_credit_warning_message_template" TEXT NOT NULL DEFAULT '',
  ADD COLUMN IF NOT EXISTS "low_credit_warning_send_via_agency_workspace" BOOLEAN NOT NULL DEFAULT TRUE;

------------------------------------------------------------------------------------------
-- WORKSPACE CREDIT WARNING EVENTS: idempotent log of warning send attempts.
-- One SENT row per (tenant_id, threshold, billing_period_end) is enforced to prevent
-- duplicate spam within the same plan period. SKIPPED / FAILED rows are not part of the
-- uniqueness constraint so we can retry on the next debit if conditions improve.
------------------------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS "workspace_credit_warning_events" (
  "id"                     TEXT PRIMARY KEY,
  "agency_id"              TEXT NOT NULL,
  "tenant_id"              TEXT NOT NULL,
  "threshold"              INTEGER NOT NULL,
  "balance_at_send"        INTEGER NOT NULL,
  "status"                 TEXT NOT NULL,
  "reason"                 TEXT,
  "message_preview"        TEXT,
  "billing_period_start"   TIMESTAMPTZ,
  "billing_period_end"     TIMESTAMPTZ,
  "created_at"             TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  CONSTRAINT "workspace_credit_warning_events_status_chk"
    CHECK ("status" IN ('SENT', 'SKIPPED', 'FAILED')),
  CONSTRAINT "workspace_credit_warning_events_agency_fk"
    FOREIGN KEY ("agency_id") REFERENCES "agencies" ("id") ON DELETE CASCADE,
  CONSTRAINT "workspace_credit_warning_events_tenant_fk"
    FOREIGN KEY ("tenant_id") REFERENCES "tenants" ("id") ON DELETE CASCADE
);

CREATE INDEX IF NOT EXISTS "workspace_credit_warning_events_agency_created_idx"
  ON "workspace_credit_warning_events" ("agency_id", "created_at" DESC);

CREATE INDEX IF NOT EXISTS "workspace_credit_warning_events_tenant_created_idx"
  ON "workspace_credit_warning_events" ("tenant_id", "created_at" DESC);

-- One SENT row per workspace + threshold + billing period (period_end is the canonical
-- annual reset boundary; COALESCE handles older wallets that may not yet have a value).
CREATE UNIQUE INDEX IF NOT EXISTS "workspace_credit_warning_events_sent_unique"
  ON "workspace_credit_warning_events" (
    "tenant_id",
    "threshold",
    COALESCE("billing_period_end", '1970-01-01T00:00:00Z'::timestamptz)
  )
  WHERE "status" = 'SENT';
