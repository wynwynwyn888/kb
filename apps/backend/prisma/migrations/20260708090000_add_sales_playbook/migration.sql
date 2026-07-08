-- Sales Playbook: reusable AI Agent selling guidance stored on each tenant profile.
ALTER TABLE "tenant_bot_profiles"
  ADD COLUMN IF NOT EXISTS "sales_playbook" TEXT NOT NULL DEFAULT '';
