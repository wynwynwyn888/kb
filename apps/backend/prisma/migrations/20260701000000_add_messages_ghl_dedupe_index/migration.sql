-- Partial unique index for dedupe by GHL message ID within a conversation.
-- Only rows where ghlMessageId is present are constrained — fallback
-- rows (null ghlMessageId, contentFingerprint-only) are not affected.
CREATE UNIQUE INDEX CONCURRENTLY IF NOT EXISTS idx_messages_dedupe_ghl_message
ON messages (conversation_id, (metadata->>'ghlMessageId'))
WHERE metadata->>'ghlMessageId' IS NOT NULL;
