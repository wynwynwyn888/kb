-- Tenant roster read boundary. Direct tenant_users reads expose membership fields
-- only. Profile email/name are returned solely through a tenant-authorized RPC so
-- the global profiles table never receives a broad authenticated SELECT policy.

ALTER TABLE public.tenant_users ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS tenant_users_member_select ON public.tenant_users;
CREATE POLICY tenant_users_member_select
ON public.tenant_users
FOR SELECT TO authenticated
USING (public.can_read_tenant(tenant_id));

CREATE OR REPLACE FUNCTION public.list_tenant_members(p_tenant_id TEXT)
RETURNS TABLE (
  id TEXT,
  tenant_id TEXT,
  profile_id TEXT,
  role TEXT,
  email TEXT,
  full_name TEXT,
  created_at TIMESTAMPTZ,
  updated_at TIMESTAMPTZ
)
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = pg_catalog, public
AS $$
  SELECT
    tu.id,
    tu.tenant_id,
    tu.profile_id,
    tu.role::TEXT,
    p.email,
    p.full_name,
    tu.created_at,
    tu.updated_at
  FROM public.tenant_users tu
  JOIN public.profiles p ON p.id = tu.profile_id
  WHERE tu.tenant_id = p_tenant_id
    AND public.can_read_tenant(p_tenant_id)
  ORDER BY tu.created_at ASC;
$$;

REVOKE ALL ON FUNCTION public.list_tenant_members(TEXT) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.list_tenant_members(TEXT) FROM anon;
GRANT EXECUTE ON FUNCTION public.list_tenant_members(TEXT) TO authenticated;
GRANT EXECUTE ON FUNCTION public.list_tenant_members(TEXT) TO service_role;
