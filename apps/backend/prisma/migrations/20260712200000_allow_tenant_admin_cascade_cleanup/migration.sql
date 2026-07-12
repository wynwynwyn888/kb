-- Preserve the last-admin guard for live tenants while allowing intentional
-- tenant deletion to cascade through all of its memberships.

CREATE OR REPLACE FUNCTION public.prevent_last_tenant_admin_removal()
RETURNS trigger
LANGUAGE plpgsql
SECURITY INVOKER
SET search_path = pg_catalog, public
AS $$
DECLARE
  remaining_admins INTEGER;
BEGIN
  IF OLD.role <> 'ADMIN' THEN
    IF TG_OP = 'DELETE' THEN RETURN OLD; END IF;
    RETURN NEW;
  END IF;

  IF TG_OP = 'DELETE' AND NOT EXISTS (
    SELECT 1 FROM public.tenants t WHERE t.id = OLD.tenant_id
  ) THEN
    RETURN OLD;
  END IF;

  IF TG_OP = 'UPDATE'
     AND NEW.role = 'ADMIN'
     AND NEW.tenant_id = OLD.tenant_id THEN
    RETURN NEW;
  END IF;

  PERFORM pg_catalog.pg_advisory_xact_lock(
    pg_catalog.hashtextextended('tenant-admin:' || OLD.tenant_id, 0)
  );

  SELECT count(*)
  INTO remaining_admins
  FROM public.tenant_users tu
  WHERE tu.tenant_id = OLD.tenant_id
    AND tu.role = 'ADMIN'
    AND tu.id <> OLD.id;

  IF remaining_admins < 1 THEN
    RAISE EXCEPTION 'cannot remove or demote the last tenant admin'
      USING ERRCODE = '23514';
  END IF;

  IF TG_OP = 'DELETE' THEN RETURN OLD; END IF;
  RETURN NEW;
END;
$$;

REVOKE ALL ON FUNCTION public.prevent_last_tenant_admin_removal() FROM PUBLIC;
