-- Add critical_facts column to tenant_bot_profiles.
-- Stores concise critical business facts (pricing, guarantees, CTA, etc.)
-- that must be preserved in AI generation context.
-- Rollback: ALTER TABLE tenant_bot_profiles DROP COLUMN IF EXISTS critical_facts;
ALTER TABLE tenant_bot_profiles ADD COLUMN IF NOT EXISTS critical_facts TEXT NOT NULL DEFAULT '';
