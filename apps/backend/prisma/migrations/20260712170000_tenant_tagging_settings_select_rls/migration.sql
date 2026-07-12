-- First caller-scoped route cutover: read-only tagging settings.
-- Writes and internal automation continue through explicitly tenant-scoped
-- service-role paths until separate mutation policies are specified and tested.

ALTER TABLE public.tenant_tagging_settings ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS tenant_tagging_settings_member_select
  ON public.tenant_tagging_settings;

CREATE POLICY tenant_tagging_settings_member_select
ON public.tenant_tagging_settings
FOR SELECT TO authenticated
USING (public.can_read_tenant(tenant_id));
