-- Booking settings include a staff notification destination/template. Keep the
-- table closed to direct authenticated SELECT and expose only a fixed-shape RPC.
-- Readers receive operational settings with sensitive alert fields redacted;
-- tenant ADMIN and agency OWNER/ADMIN receive the complete settings.

CREATE OR REPLACE FUNCTION public.can_manage_tenant(p_tenant_id TEXT)
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
        AND tu.role = 'ADMIN'
    )
    OR EXISTS (
      SELECT 1
      FROM public.tenants t
      JOIN public.agency_users au ON au.agency_id = t.agency_id
      WHERE t.id = p_tenant_id
        AND au.profile_id = auth.uid()::text
        AND au.role IN ('OWNER', 'ADMIN')
    );
$$;

REVOKE ALL ON FUNCTION public.can_manage_tenant(TEXT) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.can_manage_tenant(TEXT) FROM anon;
GRANT EXECUTE ON FUNCTION public.can_manage_tenant(TEXT) TO authenticated;
GRANT EXECUTE ON FUNCTION public.can_manage_tenant(TEXT) TO service_role;

ALTER TABLE public.tenant_booking_settings ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS tenant_booking_settings_member_select
  ON public.tenant_booking_settings;

CREATE OR REPLACE FUNCTION public.get_tenant_booking_settings(p_tenant_id TEXT)
RETURNS TABLE (
  enabled BOOLEAN,
  booking_mode TEXT,
  default_ghl_calendar_id TEXT,
  default_ghl_calendar_name TEXT,
  core_fields_json JSONB,
  custom_fields_json JSONB,
  service_menu_options JSONB,
  max_bookings_per_slot INTEGER,
  internal_booking_alert_enabled BOOLEAN,
  internal_booking_alert_number TEXT,
  internal_booking_alert_channel TEXT,
  internal_booking_alert_template TEXT,
  can_manage BOOLEAN
)
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = pg_catalog, public
AS $$
  SELECT
    COALESCE(bs.enabled, false),
    COALESCE(bs.booking_mode::text, 'COLLECT_DETAILS_ONLY'),
    bs.default_ghl_calendar_id,
    bs.default_ghl_calendar_name,
    COALESCE(bs.core_fields_json, '{}'::jsonb),
    COALESCE(bs.custom_fields_json, '[]'::jsonb),
    bs.service_menu_options,
    COALESCE(bs.max_bookings_per_slot, 1),
    CASE WHEN access.can_manage THEN COALESCE(bs.internal_booking_alert_enabled, false) ELSE false END,
    CASE WHEN access.can_manage THEN bs.internal_booking_alert_number ELSE NULL END,
    COALESCE(bs.internal_booking_alert_channel, 'GHL_MESSAGE'),
    CASE WHEN access.can_manage THEN bs.internal_booking_alert_template ELSE NULL END,
    access.can_manage
  FROM (
    SELECT public.can_manage_tenant(p_tenant_id) AS can_manage
  ) access
  LEFT JOIN public.tenant_booking_settings bs ON bs.tenant_id = p_tenant_id
  WHERE public.can_read_tenant(p_tenant_id);
$$;

REVOKE ALL ON FUNCTION public.get_tenant_booking_settings(TEXT) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.get_tenant_booking_settings(TEXT) FROM anon;
GRANT EXECUTE ON FUNCTION public.get_tenant_booking_settings(TEXT) TO authenticated;
GRANT EXECUTE ON FUNCTION public.get_tenant_booking_settings(TEXT) TO service_role;
