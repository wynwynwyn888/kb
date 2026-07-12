-- Finalize direct tenant ownership after the additive backfill migrations.
-- Production invariants were verified before this migration was authored:
-- zero null tenant ids, zero orphans, and zero parent/child mismatches.

SET lock_timeout = '5s';

-- Validate the existing tenant foreign keys before making ownership mandatory.
ALTER TABLE public.messages
  VALIDATE CONSTRAINT messages_tenant_id_fkey;

ALTER TABLE public.handover_events
  VALIDATE CONSTRAINT handover_events_tenant_id_fkey;

ALTER TABLE public.tenant_bot_profile_knowledge_vaults
  VALIDATE CONSTRAINT tenant_bot_profile_knowledge_vaults_tenant_id_fkey;

-- Validated checks let PostgreSQL prove NOT NULL without a second full table
-- scan while the stronger column property is installed.
ALTER TABLE public.messages
  ADD CONSTRAINT messages_tenant_id_not_null
  CHECK (tenant_id IS NOT NULL) NOT VALID;
ALTER TABLE public.messages
  VALIDATE CONSTRAINT messages_tenant_id_not_null;

ALTER TABLE public.handover_events
  ADD CONSTRAINT handover_events_tenant_id_not_null
  CHECK (tenant_id IS NOT NULL) NOT VALID;
ALTER TABLE public.handover_events
  VALIDATE CONSTRAINT handover_events_tenant_id_not_null;

ALTER TABLE public.tenant_bot_profile_knowledge_vaults
  ADD CONSTRAINT profile_vault_links_tenant_id_not_null
  CHECK (tenant_id IS NOT NULL) NOT VALID;
ALTER TABLE public.tenant_bot_profile_knowledge_vaults
  VALIDATE CONSTRAINT profile_vault_links_tenant_id_not_null;

ALTER TABLE public.messages
  ALTER COLUMN tenant_id SET NOT NULL;

ALTER TABLE public.handover_events
  ALTER COLUMN tenant_id SET NOT NULL;

ALTER TABLE public.tenant_bot_profile_knowledge_vaults
  ALTER COLUMN tenant_id SET NOT NULL;

-- The column-level NOT NULL property is the final invariant; remove temporary
-- proof constraints so schema introspection remains straightforward.
ALTER TABLE public.messages
  DROP CONSTRAINT messages_tenant_id_not_null;

ALTER TABLE public.handover_events
  DROP CONSTRAINT handover_events_tenant_id_not_null;

ALTER TABLE public.tenant_bot_profile_knowledge_vaults
  DROP CONSTRAINT profile_vault_links_tenant_id_not_null;
