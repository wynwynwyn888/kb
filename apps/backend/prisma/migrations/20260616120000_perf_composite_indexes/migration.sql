-- Composite indexes for hot query paths (messages memory, conversation lists, quota ledgers, handovers)

CREATE INDEX IF NOT EXISTS "messages_conversation_id_created_at_idx"
  ON "messages" ("conversation_id", "created_at" DESC);

CREATE INDEX IF NOT EXISTS "conversations_tenant_id_last_message_at_idx"
  ON "conversations" ("tenant_id", "last_message_at" DESC);

CREATE INDEX IF NOT EXISTS "quota_ledgers_wallet_movement_created_idx"
  ON "quota_ledgers" ("wallet_id", "movement_type", "created_at" DESC);

CREATE INDEX IF NOT EXISTS "handover_events_status_created_at_idx"
  ON "handover_events" ("status", "created_at" DESC);
