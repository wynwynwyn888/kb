-- Credits MVP: extend existing quota_* tables (wallet policy + ledger idempotency + movement metadata)

ALTER TABLE "quota_wallets"
  ADD COLUMN IF NOT EXISTS "allow_negative_credits" BOOLEAN NOT NULL DEFAULT false,
  ADD COLUMN IF NOT EXISTS "negative_credit_limit" INTEGER NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS "low_credit_threshold" INTEGER NOT NULL DEFAULT 0;

ALTER TABLE "quota_ledgers"
  ADD COLUMN IF NOT EXISTS "movement_type" TEXT,
  ADD COLUMN IF NOT EXISTS "balance_after" INTEGER,
  ADD COLUMN IF NOT EXISTS "idempotency_key" TEXT,
  ADD COLUMN IF NOT EXISTS "metadata" JSONB,
  ADD COLUMN IF NOT EXISTS "created_by_user_id" TEXT;

-- Enforce idempotency only when key present.
CREATE UNIQUE INDEX IF NOT EXISTS "quota_ledgers_idempotency_key_unique"
  ON "quota_ledgers" ("idempotency_key")
  WHERE "idempotency_key" IS NOT NULL;

