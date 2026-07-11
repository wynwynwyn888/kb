-- Tenant-own Assistant Profile ↔ Knowledge Vault links so prompt/KB access
-- control cannot cross workspace boundaries, even through service-role writes.

ALTER TABLE public.tenant_bot_profile_knowledge_vaults
  ADD COLUMN IF NOT EXISTS tenant_id TEXT;

UPDATE public.tenant_bot_profile_knowledge_vaults AS link
SET tenant_id = profile.tenant_id
FROM public.tenant_bot_profiles AS profile
WHERE profile.id = link.profile_id
  AND link.tenant_id IS DISTINCT FROM profile.tenant_id;

DO $$
BEGIN
  IF EXISTS (
    SELECT 1
    FROM public.tenant_bot_profile_knowledge_vaults link
    JOIN public.tenant_bot_profiles profile ON profile.id = link.profile_id
    JOIN public.knowledge_vaults vault ON vault.id = link.vault_id
    WHERE profile.tenant_id IS DISTINCT FROM vault.tenant_id
  ) THEN
    RAISE EXCEPTION 'existing cross-tenant profile vault links require manual remediation'
      USING ERRCODE = '23514';
  END IF;
END $$;

CREATE INDEX IF NOT EXISTS bot_profile_vault_links_tenant_profile_idx
  ON public.tenant_bot_profile_knowledge_vaults (tenant_id, profile_id);

CREATE OR REPLACE FUNCTION public.enforce_profile_vault_link_tenant()
RETURNS trigger
LANGUAGE plpgsql
SECURITY INVOKER
SET search_path = pg_catalog, public
AS $$
DECLARE
  profile_tenant_id TEXT;
  vault_tenant_id TEXT;
BEGIN
  SELECT p.tenant_id INTO profile_tenant_id
  FROM public.tenant_bot_profiles p
  WHERE p.id = NEW.profile_id;

  SELECT v.tenant_id INTO vault_tenant_id
  FROM public.knowledge_vaults v
  WHERE v.id = NEW.vault_id;

  IF profile_tenant_id IS NULL OR vault_tenant_id IS NULL THEN
    RAISE EXCEPTION 'profile or vault does not exist' USING ERRCODE = '23503';
  END IF;
  IF profile_tenant_id IS DISTINCT FROM vault_tenant_id THEN
    RAISE EXCEPTION 'profile and vault belong to different tenants' USING ERRCODE = '23514';
  END IF;
  IF NEW.tenant_id IS NULL THEN
    NEW.tenant_id := profile_tenant_id;
  ELSIF NEW.tenant_id IS DISTINCT FROM profile_tenant_id THEN
    RAISE EXCEPTION 'profile vault link tenant mismatch' USING ERRCODE = '23514';
  END IF;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS profile_vault_links_enforce_tenant
  ON public.tenant_bot_profile_knowledge_vaults;
CREATE TRIGGER profile_vault_links_enforce_tenant
BEFORE INSERT OR UPDATE OF tenant_id, profile_id, vault_id
ON public.tenant_bot_profile_knowledge_vaults
FOR EACH ROW EXECUTE FUNCTION public.enforce_profile_vault_link_tenant();

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
    WHERE conname = 'tenant_bot_profile_knowledge_vaults_tenant_id_fkey'
  ) THEN
    ALTER TABLE public.tenant_bot_profile_knowledge_vaults
      ADD CONSTRAINT tenant_bot_profile_knowledge_vaults_tenant_id_fkey
      FOREIGN KEY (tenant_id) REFERENCES public.tenants(id) ON DELETE CASCADE NOT VALID;
  END IF;
END $$;

ALTER TABLE public.tenant_bot_profile_knowledge_vaults ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS profile_vault_links_member_select
  ON public.tenant_bot_profile_knowledge_vaults;
CREATE POLICY profile_vault_links_member_select
ON public.tenant_bot_profile_knowledge_vaults
FOR SELECT TO authenticated
USING (
  EXISTS (
    SELECT 1 FROM public.tenant_users tu
    WHERE tu.tenant_id = tenant_bot_profile_knowledge_vaults.tenant_id
      AND tu.profile_id = auth.uid()::text
  ) OR EXISTS (
    SELECT 1
    FROM public.tenants t
    JOIN public.agency_users au ON au.agency_id = t.agency_id
    WHERE t.id = tenant_bot_profile_knowledge_vaults.tenant_id
      AND au.profile_id = auth.uid()::text
      AND au.role IN ('OWNER', 'ADMIN', 'OPERATOR')
  )
);

REVOKE ALL ON FUNCTION public.enforce_profile_vault_link_tenant() FROM PUBLIC;
