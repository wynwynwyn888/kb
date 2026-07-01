-- Partial unique index for dedupe by GHL message ID within a conversation.
-- Only rows where ghlMessageId is present are constrained — fallback
-- rows (null ghlMessageId, contentFingerprint-only) are not affected.
--
-- CREATE INDEX CONCURRENTLY must run outside a transaction block.
-- Prisma migrations may wrap SQL in a transaction; COMMIT+ROLLBACK
-- ensures the index creation runs in its own transaction.

-- Close any implicit transaction
COMMIT;

CREATE UNIQUE INDEX CONCURRENTLY IF NOT EXISTS idx_messages_dedupe_ghl_message
ON messages (conversation_id, (metadata->>'ghlMessageId'))
WHERE metadata->>'ghlMessageId' IS NOT NULL;

-- Re-open transaction for any subsequent migration steps
BEGIN;
