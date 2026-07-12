\set ON_ERROR_STOP on

BEGIN;
SET LOCAL statement_timeout = '15s';
SET LOCAL lock_timeout = '2s';

INSERT INTO public.profiles (id, email, full_name, updated_at)
VALUES
  ('00000000-0000-4000-8000-0000000000a1', 'last-admin-a@example.invalid', 'Last Admin A', now()),
  ('00000000-0000-4000-8000-0000000000a2', 'last-admin-b@example.invalid', 'Last Admin B', now());

INSERT INTO public.agencies (id, name, updated_at)
VALUES ('last-admin-agency-fixture', 'Last admin staging fixture', now());

INSERT INTO public.tenants (id, agency_id, name, status, updated_at)
VALUES ('last-admin-tenant-fixture', 'last-admin-agency-fixture', 'Last admin staging fixture', 'active', now());

INSERT INTO public.tenant_users (id, tenant_id, profile_id, role, updated_at)
VALUES
  ('last-admin-membership-a', 'last-admin-tenant-fixture', '00000000-0000-4000-8000-0000000000a1', 'ADMIN', now()),
  ('last-admin-membership-b', 'last-admin-tenant-fixture', '00000000-0000-4000-8000-0000000000a2', 'ADMIN', now());

DELETE FROM public.tenant_users WHERE id = 'last-admin-membership-b';

DO $$
BEGIN
  BEGIN
    DELETE FROM public.tenant_users WHERE id = 'last-admin-membership-a';
    RAISE EXCEPTION 'last admin delete unexpectedly succeeded';
  EXCEPTION WHEN check_violation THEN
    IF SQLERRM <> 'cannot remove or demote the last tenant admin' THEN RAISE; END IF;
  END;

  BEGIN
    UPDATE public.tenant_users SET role = 'AGENT' WHERE id = 'last-admin-membership-a';
    RAISE EXCEPTION 'last admin demotion unexpectedly succeeded';
  EXCEPTION WHEN check_violation THEN
    IF SQLERRM <> 'cannot remove or demote the last tenant admin' THEN RAISE; END IF;
  END;
END $$;

SELECT count(*) AS remaining_admins
FROM public.tenant_users
WHERE tenant_id = 'last-admin-tenant-fixture' AND role = 'ADMIN';

DELETE FROM public.tenants WHERE id = 'last-admin-tenant-fixture';

SELECT count(*) AS memberships_after_tenant_delete
FROM public.tenant_users
WHERE tenant_id = 'last-admin-tenant-fixture';

ROLLBACK;
