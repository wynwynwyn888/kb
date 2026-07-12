# Tenant Roster RLS Cutover

Status: **COMPLETED — PRODUCTION EVIDENCE AND ROLLBACK RECORD**

Date: 2026-07-12  
Baseline: `481df7760e66f5519c4439a7eb4e23907dd637fc`

## Outcome

`GET /api/v1/tenant-users?tenantId=...` retains its application authorization check and reads the roster through the caller's JWT. `tenant_users` has an authenticated `SELECT` policy using `can_read_tenant(tenant_id)`. Inserts, updates and deletes remain unavailable through the caller client and continue through guarded internal services.

The global `profiles` table receives no authenticated policy. The `list_tenant_members(p_tenant_id)` security-definer RPC returns only membership ID, tenant ID, profile ID, role, email, full name and timestamps after `can_read_tenant(p_tenant_id)` succeeds. Execute is revoked from `PUBLIC` and `anon` and granted to `authenticated` and `service_role`.

## Profile privacy

Customers cannot query or search the global profile directory. The RPC does not accept an email, profile ID, filter or arbitrary SQL input. It returns only profiles already joined to the authorized tenant roster. An unauthorized tenant ID returns zero rows, while the application layer first returns its existing non-enumerating tenant-not-found response.

## Last-admin correction

The previously deployed last-admin trigger correctly blocks direct deletion/demotion of the final admin. A follow-up migration allows an intentional tenant deletion to cascade through its memberships after the parent tenant is no longer visible. Staging proved both behaviors in a rollback transaction.

## Staging evidence

Twelve real anon-key/JWT assertions passed:

- founder access to both temporary customer rosters;
- Tenant A admin, agent and viewer confinement;
- Tenant B admin confinement;
- unaffiliated authenticated denial;
- authorized profile detail visibility only;
- global profile table denial;
- direct `tenant_users` SELECT scoping;
- anonymous RPC denial;
- caller mutation denial;
- concurrent Customer A/B token isolation.

All temporary agencies, tenants, profiles, auth users and memberships were removed. Residue counts were zero.

## Deployment order

The production container runs `prisma migrate deploy` before starting Nest. It will first install the cascade correction and then the roster policy/RPC before exposing caller-scoped roster reads.

## Rollback

Fast rollback is to revert the controller/service caller-read commit and redeploy. The SELECT policy and RPC may remain without affecting the legacy service-role read. If database rollback is necessary after the code rollback:

```sql
DROP POLICY IF EXISTS tenant_users_member_select ON public.tenant_users;
DROP FUNCTION IF EXISTS public.list_tenant_members(TEXT);
```

Do not add a broad authenticated policy to `profiles`. Do not remove the last-admin trigger when rolling back the roster read.
