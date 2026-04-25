-- MINIMAX provider, agency active provider + default quota, nullable GHL location, KB document_kind, quota audit
--
-- quota_audit_logs IDs must be TEXT to match agencies.id / tenants.id / profiles.id (Prisma String @id).
-- If a previous attempt created this table with UUID columns, DROP + recreate clears it (table was new / empty).

DO $$ BEGIN
  ALTER TYPE "AiProvider" ADD VALUE 'MINIMAX';
EXCEPTION
  WHEN duplicate_object THEN NULL;
END $$;

ALTER TABLE "agencies" ADD COLUMN IF NOT EXISTS "active_ai_provider" "AiProvider" NOT NULL DEFAULT 'OPENAI';
ALTER TABLE "agencies" ADD COLUMN IF NOT EXISTS "default_subaccount_quota" INTEGER NOT NULL DEFAULT 10000;

DROP TABLE IF EXISTS "quota_audit_logs" CASCADE;

CREATE TABLE "quota_audit_logs" (
  "id" TEXT NOT NULL DEFAULT (gen_random_uuid())::text,
  "agency_id" TEXT NOT NULL,
  "profile_id" TEXT NOT NULL,
  "tenant_id" TEXT,
  "action" TEXT NOT NULL,
  "delta" INTEGER NOT NULL DEFAULT 0,
  "previous_total" INTEGER,
  "new_total" INTEGER,
  "metadata" JSONB NOT NULL DEFAULT '{}',
  "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "quota_audit_logs_pkey" PRIMARY KEY ("id")
);

CREATE INDEX IF NOT EXISTS "quota_audit_logs_agency_id_idx" ON "quota_audit_logs"("agency_id");
CREATE INDEX IF NOT EXISTS "quota_audit_logs_tenant_id_idx" ON "quota_audit_logs"("tenant_id");
CREATE INDEX IF NOT EXISTS "quota_audit_logs_created_at_idx" ON "quota_audit_logs"("created_at");

DO $$ BEGIN
  ALTER TABLE "quota_audit_logs" ADD CONSTRAINT "quota_audit_logs_agency_id_fkey" FOREIGN KEY ("agency_id") REFERENCES "agencies"("id") ON DELETE CASCADE ON UPDATE CASCADE;
EXCEPTION
  WHEN duplicate_object THEN NULL;
END $$;

DO $$ BEGIN
  ALTER TABLE "quota_audit_logs" ADD CONSTRAINT "quota_audit_logs_tenant_id_fkey" FOREIGN KEY ("tenant_id") REFERENCES "tenants"("id") ON DELETE SET NULL ON UPDATE CASCADE;
EXCEPTION
  WHEN duplicate_object THEN NULL;
END $$;

-- Allow tenants without a GHL location id until integration is wired
ALTER TABLE "tenants" ALTER COLUMN "ghl_location_id" DROP NOT NULL;
ALTER TABLE "knowledge_documents" ADD COLUMN IF NOT EXISTS "document_kind" TEXT NOT NULL DEFAULT 'manual';
