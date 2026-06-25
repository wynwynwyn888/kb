-- Outbound send idempotency ledger.
-- Additive, idempotent; standalone table with no FK dependencies.
-- No backfill required.
CREATE TABLE IF NOT EXISTS "outbound_sends" (
  "id"                    TEXT NOT NULL PRIMARY KEY,
  "tenant_id"             TEXT NOT NULL,
  "conversation_id"       TEXT NOT NULL,
  "reply_id"              TEXT NOT NULL,
  "bubble_sequence"       INTEGER NOT NULL,
  "ghl_location_id"       TEXT NOT NULL,
  "content_hash"          TEXT NOT NULL,
  "status"                TEXT NOT NULL DEFAULT 'pending',
  "provider_message_id"   TEXT,
  "attempt"               INTEGER NOT NULL DEFAULT 0,
  "last_error_code"       TEXT,
  "last_error_message"    TEXT,
  "created_at"            TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updated_at"            TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "sent_at"               TIMESTAMP(3)
);

CREATE UNIQUE INDEX IF NOT EXISTS "outbound_sends_tenant_id_conversation_id_reply_id_bubble_sequence_key"
  ON "outbound_sends" ("tenant_id", "conversation_id", "reply_id", "bubble_sequence");

CREATE INDEX IF NOT EXISTS "outbound_sends_tenant_id_created_at_idx"
  ON "outbound_sends" ("tenant_id", "created_at" DESC);

CREATE INDEX IF NOT EXISTS "outbound_sends_conversation_id_reply_id_bubble_sequence_idx"
  ON "outbound_sends" ("conversation_id", "reply_id", "bubble_sequence");
