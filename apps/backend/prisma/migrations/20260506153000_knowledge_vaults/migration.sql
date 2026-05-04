-- Knowledge Vaults: group KB documents; assistant profiles can use all vaults or selected vaults.

CREATE TABLE "knowledge_vaults" (
    "id" TEXT NOT NULL,
    "tenant_id" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "description" TEXT,
    "is_default" BOOLEAN NOT NULL DEFAULT false,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "knowledge_vaults_pkey" PRIMARY KEY ("id")
);

CREATE INDEX "knowledge_vaults_tenant_id_idx" ON "knowledge_vaults"("tenant_id");

CREATE UNIQUE INDEX "knowledge_vaults_tenant_id_name_key" ON "knowledge_vaults"("tenant_id", "name");

ALTER TABLE "knowledge_vaults" ADD CONSTRAINT "knowledge_vaults_tenant_id_fkey" FOREIGN KEY ("tenant_id") REFERENCES "tenants"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- Documents reference a vault (nullable until backfill)
ALTER TABLE "knowledge_documents" ADD COLUMN "vault_id" TEXT;

-- One default vault per tenant that already has documents
INSERT INTO "knowledge_vaults" ("id", "tenant_id", "name", "description", "is_default", "created_at", "updated_at")
SELECT (gen_random_uuid())::text, d."tenant_id", 'General Knowledge', NULL, true, CURRENT_TIMESTAMP, CURRENT_TIMESTAMP
FROM (SELECT DISTINCT "tenant_id" FROM "knowledge_documents") d;

UPDATE "knowledge_documents" AS kd
SET "vault_id" = kv."id"
FROM "knowledge_vaults" AS kv
WHERE kd."tenant_id" = kv."tenant_id"
  AND kv."name" = 'General Knowledge'
  AND kv."is_default" = true
  AND kd."vault_id" IS NULL;

ALTER TABLE "knowledge_documents" ALTER COLUMN "vault_id" SET NOT NULL;

ALTER TABLE "knowledge_documents" ADD CONSTRAINT "knowledge_documents_vault_id_fkey" FOREIGN KEY ("vault_id") REFERENCES "knowledge_vaults"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

CREATE INDEX "knowledge_documents_vault_id_idx" ON "knowledge_documents"("vault_id");

-- Assistant profile ↔ vault (when knowledge_access_mode = selected_vaults)
CREATE TABLE "tenant_bot_profile_knowledge_vaults" (
    "profile_id" TEXT NOT NULL,
    "vault_id" TEXT NOT NULL,

    CONSTRAINT "tenant_bot_profile_knowledge_vaults_pkey" PRIMARY KEY ("profile_id", "vault_id"),
    CONSTRAINT "tb_pk_vault_profile_fkey" FOREIGN KEY ("profile_id") REFERENCES "tenant_bot_profiles"("id") ON DELETE CASCADE ON UPDATE CASCADE,
    CONSTRAINT "tb_pk_vault_vault_fkey" FOREIGN KEY ("vault_id") REFERENCES "knowledge_vaults"("id") ON DELETE CASCADE ON UPDATE CASCADE
);

CREATE INDEX "tenant_bot_profile_knowledge_vaults_vault_id_idx" ON "tenant_bot_profile_knowledge_vaults"("vault_id");

-- New access mode (replaces knowledge_scope_mode for retrieval; legacy column kept)
ALTER TABLE "tenant_bot_profiles" ADD COLUMN "knowledge_access_mode" TEXT NOT NULL DEFAULT 'all_vaults';

UPDATE "tenant_bot_profiles"
SET "knowledge_access_mode" = 'selected_vaults'
WHERE "knowledge_scope_mode" = 'selected_collections';
