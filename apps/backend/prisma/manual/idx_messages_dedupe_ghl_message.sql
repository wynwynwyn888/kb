-- Run this ONCE via Supabase SQL Editor (https://supabase.com/dashboard/project/_/sql)
-- or via a direct (non-pooler) connection.
-- PgBouncer pooler blocks DDL — do NOT run through prisma db execute.
--
-- Rollback: DROP INDEX IF EXISTS idx_messages_dedupe_ghl_message;

CREATE UNIQUE INDEX IF NOT EXISTS idx_messages_dedupe_ghl_message
ON messages (conversation_id, (metadata->>'ghlMessageId'))
WHERE metadata->>'ghlMessageId' IS NOT NULL;
