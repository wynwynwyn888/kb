-- Membership tables have RLS enabled and no authenticated policies, so policy
-- subqueries against them evaluate to no rows. Resolve membership through a
-- narrowly scoped SECURITY DEFINER boolean helper owned by the migration role.

CREATE OR REPLACE FUNCTION public.can_read_tenant(p_tenant_id TEXT)
RETURNS BOOLEAN
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = pg_catalog, public
AS $$
  SELECT
    EXISTS (
      SELECT 1
      FROM public.tenant_users tu
      WHERE tu.tenant_id = p_tenant_id
        AND tu.profile_id = auth.uid()::text
    )
    OR EXISTS (
      SELECT 1
      FROM public.tenants t
      JOIN public.agency_users au ON au.agency_id = t.agency_id
      WHERE t.id = p_tenant_id
        AND au.profile_id = auth.uid()::text
        AND au.role IN ('OWNER', 'ADMIN', 'OPERATOR')
    );
$$;

REVOKE ALL ON FUNCTION public.can_read_tenant(TEXT) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.can_read_tenant(TEXT) FROM anon;
GRANT EXECUTE ON FUNCTION public.can_read_tenant(TEXT) TO authenticated;
GRANT EXECUTE ON FUNCTION public.can_read_tenant(TEXT) TO service_role;

DROP POLICY IF EXISTS messages_member_select ON public.messages;
CREATE POLICY messages_member_select ON public.messages
FOR SELECT TO authenticated
USING (public.can_read_tenant(tenant_id));

DROP POLICY IF EXISTS handover_events_member_select ON public.handover_events;
CREATE POLICY handover_events_member_select ON public.handover_events
FOR SELECT TO authenticated
USING (public.can_read_tenant(tenant_id));

DROP POLICY IF EXISTS profile_vault_links_member_select
  ON public.tenant_bot_profile_knowledge_vaults;
CREATE POLICY profile_vault_links_member_select
ON public.tenant_bot_profile_knowledge_vaults
FOR SELECT TO authenticated
USING (public.can_read_tenant(tenant_id));
