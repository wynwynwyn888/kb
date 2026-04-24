-- Prisma expects `document_kind` on knowledge_documents; some DBs were created before this column existed.
ALTER TABLE "knowledge_documents" ADD COLUMN IF NOT EXISTS "document_kind" TEXT NOT NULL DEFAULT 'manual';

-- Hint PostgREST to reload the schema cache (Supabase / hosted PostgREST).
NOTIFY pgrst, 'reload schema';
