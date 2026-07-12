# Booking Settings RLS Cutover Specification

Status: **STAGING VALIDATED — PR CI REQUIRED BEFORE PRODUCTION**  
Baseline: `3403e884268e2750514a95593191d39685ae32b4`

## Goal

Move the user-facing booking-settings read from the service-role client to the
caller's JWT without changing internal booking automation. Correct the existing
write-authority gap so customer agents/viewers and agency operators cannot change
booking behavior or invoke credentialed calendar tools.

## Confirmed findings

1. `GET /tenants/:tenantId/booking-settings` checks application tenant access but
   reads with the service role.
2. The same internal `getBookingSettings` method is used by orchestration and the
   booking flow. Replacing it globally would break trusted workers under RLS.
3. The response contains a staff notification phone number and message template.
   Direct table SELECT for every tenant reader would expose more than required.
4. PATCH, calendar sync, calendar test, slot test, and the diagnostic probe use
   the broad read check. That permits tenant AGENT/VIEWER and agency OPERATOR even
   though the centralized role contract grants writes only to tenant ADMIN and
   agency OWNER/ADMIN.
5. The table has a required primary-key `tenant_id` and cascading foreign key to
   `tenants`; no ownership backfill or new index is required.

## Access contract

| Actor | Read operational settings | Read staff alert destination/template | Modify or run calendar tools |
|---|---:|---:|---:|
| Agency OWNER/ADMIN | Yes | Yes | Yes |
| Agency OPERATOR | Yes | No | No |
| Tenant ADMIN | Yes | Yes | Yes |
| Tenant AGENT/VIEWER | Yes | No | No |
| Other tenant, unaffiliated, anonymous | No | No | No |

## Design

- Keep the table closed to direct authenticated SELECT.
- Add `can_manage_tenant(tenantId)` as a fixed, security-definer boolean helper.
- Add `get_tenant_booking_settings(tenantId)` as a fixed-shape, security-definer
  RPC. It requires `can_read_tenant`, returns defaults when no settings row
  exists, includes `can_manage`, and redacts alert destination/template for
  read-only roles.
- Revoke both helpers from PUBLIC/anon and grant only authenticated/service_role.
- Keep authenticated INSERT/UPDATE/DELETE unavailable.
- Preserve internal `getBookingSettings` for workers and add a separate
  `getBookingSettingsForCaller` for the HTTP GET and post-PATCH response.
- Enforce manager roles in the backend before every mutation or credentialed
  calendar tool. The frontend uses `canManage` only for UX; it is not a security
  boundary.

## Regression risks and controls

| Risk | Control |
|---|---|
| Booking AI loses settings | Internal worker method remains unchanged; booking-flow/orchestration suites must pass. |
| Existing settings disappear | RPC returns the same operational fields and explicit defaults. |
| Staff phone/template leaks | No table policy; RPC conditionally returns null/false. |
| Tenant admin cannot save | Real JWT staging test plus HTTP/controller tests. |
| Agent/viewer loses status dashboard | RPC preserves non-sensitive read fields. |
| Wrong role inferred by frontend primary membership | Database computes `can_manage`; frontend does not infer it. |
| Rollback leaves a public function | Grants are explicit; optional DB rollback drops only the two new functions. |

## Required validation

- Static migration and caller-client tests.
- Unit tests for all read/write roles and controller ordering.
- Real staging JWT tests for two tenants, redaction, direct-table denial,
  anonymous denial, mutation denial, concurrent token isolation, and fixture
  cleanup.
- Booking settings, booking flow, orchestration, backend, frontend, typecheck,
  and full build suites.
- Read-only production verification of migration, function owner/security/grants,
  absence of a booking table policy, founder identities, and live HTTP health.

## Staging evidence

Fourteen real-JWT assertions passed on the designated staging project. They
covered founder owner and operator, Tenant A admin/agent/viewer, Tenant B admin,
an unaffiliated user, anonymous access, sensitive-field redaction, direct-table
read/write denial, cross-tenant and concurrent-token isolation, and complete
database/auth fixture cleanup. Targeted tests, backend and frontend type checks,
199 backend suites (1,722 tests), 25 frontend files (91 tests), and the full
monorepo production build also passed before PR submission.

## Rollback

Fast rollback: revert the controller/service/frontend commit and redeploy. The
legacy internal reader remains available and the new functions are inert when
unused.

After code rollback, optional database rollback is:

```sql
DROP FUNCTION IF EXISTS public.get_tenant_booking_settings(TEXT);
DROP FUNCTION IF EXISTS public.can_manage_tenant(TEXT);
```

Do not disable RLS, remove `can_read_tenant`, edit an applied migration, or add a
broad SELECT policy to `tenant_booking_settings`.
