-- Metrics events table for ops dashboard observability.
-- Additive, idempotent; standalone table with no FK dependencies.
-- No backfill required.
CREATE TABLE IF NOT EXISTS "metrics_events" (
  "id"              TEXT NOT NULL PRIMARY KEY,
  "tenant_id"       TEXT,
  "conversation_id" TEXT,
  "event_type"      TEXT NOT NULL,
  "event_source"    TEXT NOT NULL,
  "severity"        TEXT NOT NULL DEFAULT 'info',
  "metadata"        JSONB,
  "created_at"      TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE INDEX IF NOT EXISTS "metrics_events_tenant_id_created_at_idx"
  ON "metrics_events" ("tenant_id", "created_at" DESC);

CREATE INDEX IF NOT EXISTS "metrics_events_event_type_created_at_idx"
  ON "metrics_events" ("event_type", "created_at" DESC);

CREATE INDEX IF NOT EXISTS "metrics_events_conversation_id_created_at_idx"
  ON "metrics_events" ("conversation_id", "created_at" DESC);

CREATE INDEX IF NOT EXISTS "metrics_events_severity_created_at_idx"
  ON "metrics_events" ("severity", "created_at" DESC);
