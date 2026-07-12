# Live Tenant-Isolation Audit and First Cutover Specification

Date: 2026-07-12 (Asia/Singapore)  
Audited runtime revision: `6d2605e6afea557f81a1069523a6a814e84d3c84`  
Audit branch/worktree: `audit/live-tenant-isolation-20260712` / `/Users/wyn/Projects/KB/kb-live-tenant-audit`  
Database actions performed: read-only transactions only; every audit ended with `ROLLBACK`

## Executive decision

KB is ready for a first narrow RLS route cutover, but is not ready for a broad service-role replacement. Production and staging are internally consistent on the ownership controls already deployed. Exactly 3 of 40 public application tables have authenticated `SELECT` policies; all user-facing backend database access still needs to be migrated resource by resource.

## Canonical product access model

KB is a single-agency, multi-customer SaaS. The agency workspace at `/app/agency` is the private AISBP platform-management area. Only the founder's verified account or explicitly documented founder-controlled recovery account may hold an agency membership or access agency pages and APIs.

Customer businesses are tenants. Their workspace URL is `/app/tenant/:tenantId/...`, for example `/app/tenant/34c62859-95b1-49a8-911c-cc44ced05452/control-panel`. Customer staff receive only `tenant_users` memberships and tenant roles (`ADMIN`, `AGENT`, or `VIEWER`). A customer account must never receive an `agency_users` row, access `/app/agency`, call agency-management APIs, access platform credentials, or read another tenant by changing a URL or request identifier.

The intended invariants are:

- one canonical AISBP agency;
- founder-controlled identities only in `agency_users`;
- the confirmed founder `OWNER` and founder `ADMIN` are the only live agency identities required by the product;
- every customer business is represented by a tenant;
- customer access is granted only through explicit tenant membership;
- tenant `ADMIN` manages its customer workspace, not the AISBP agency;
- tenant `AGENT` and `VIEWER` permissions remain confined to the assigned tenant;
- the founder can enter every customer tenant for support and platform operation.

Legacy agency roles remain in the schema for compatibility, and `can_read_tenant` currently permits agency `OWNER`, `ADMIN`, and `OPERATOR`. The production `OWNER` and `ADMIN` on the real agency were confirmed by the founder on 2026-07-12 and must both be preserved. `OPERATOR` and `MEMBER` are not part of the current product model. Do not silently narrow the shared helper during the first tagging-settings cutover because it already protects three live resources. Prevent customer provisioning from creating agency memberships and behaviorally test all affected agency pages and APIs before separately hardening unused roles.

The first cutover should be only:

`GET /api/v1/tenants/:tenantId/tagging-settings`

backed by:

`public.tenant_tagging_settings`

No write route, worker, webhook, tag-rule route, or CRM operation is included.

## Verified live state

The checked results match in staging and production unless stated otherwise.

| Check | Result |
|---|---|
| Current ownership/RLS migrations | Applied |
| Public application tables | 40 |
| Tables with policies | 3 |
| Policies | 3 authenticated `SELECT` policies |
| Tables with forced RLS | 0 |
| Unvalidated constraints | 0 |
| Expected ownership triggers | Present and enabled on all 3 protected ownership paths |
| Null ownership in messages, handovers, profile-vault links | 0 |
| Missing parents in those ownership paths | 0 |
| Parent/tenant mismatches | 0 |
| Duplicate agency memberships | 0 |
| Duplicate tenant memberships | 0 |
| Missing membership parents | 0 |
| Direct tenant columns on messages, handovers, profile-vault links | `NOT NULL` |

The three current policies are:

- `messages_member_select`
- `handover_events_member_select`
- `profile_vault_links_member_select`

All call `public.can_read_tenant(tenant_id)`. The helper's current legacy behavior permits direct tenant members and agency `OWNER`, `ADMIN`, or `OPERATOR`; an agency `MEMBER` requires a direct tenant assignment. This matches the application read policy deployed in PR #72, but the agency-role portion must later be narrowed to the founder-only product model described above.

All 40 tables have RLS enabled, but 37 have no policy. Supabase's standard `anon`, `authenticated`, and `service_role` table grants remain broad. For `anon` and `authenticated`, RLS is the effective barrier. The service role bypasses that barrier and remains the principal blast-radius risk.

Staging-specific note: the staging database has one tenant, zero agency memberships, zero tenant memberships, and zero `tenant_tagging_settings` rows. Purpose-built, isolated authentication fixtures are required for behavioral RLS testing.

## Why this is the safest first resource

The endpoint returns one boolean: `automaticTaggingEnabled`. It contains no customer conversation, prompt, API credential, personal profile, or billing information. If no row exists, current behavior returns `{ automaticTaggingEnabled: false }`; an RLS query returning no matching row preserves that default.

The route already calls `ensureTenantAccessOrThrow(tenantId, user.id)` before reading. The RLS policy becomes a second independent check. The table has a non-null tenant foreign key. Background tagging and the `PATCH` endpoint can continue using the internal client during this batch, avoiding automation regression.

Booking, follow-up, escalation, conversations, messages, prompts, credentials, and knowledge resources are excluded because they have more runtime consumers, more sensitive data, or higher customer-facing impact.

## Required implementation

### 1. Migration

Add one rerunnable migration after `20260712150000_fix_rls_membership_evaluation`:

```sql
ALTER TABLE public.tenant_tagging_settings ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS tenant_tagging_settings_member_select
  ON public.tenant_tagging_settings;

CREATE POLICY tenant_tagging_settings_member_select
ON public.tenant_tagging_settings
FOR SELECT TO authenticated
USING (public.can_read_tenant(tenant_id));
```

Do not add `INSERT`, `UPDATE`, or `DELETE` policies in this batch. Do not use `FOR ALL`. Do not force RLS. Do not change grants, columns, constraints, or data.

Migration ordering is mandatory: policy first, code second. Deploying code before the policy would make valid caller-scoped reads look like missing rows.

### 2. Request token extraction

Add a reusable request-only access-token decorator or helper beside `CurrentUser`. It must:

- accept exactly a Bearer authorization header;
- return only the raw token, without the `Bearer` prefix;
- reject missing, empty, malformed, whitespace-containing, or oversized tokens;
- never attach the token to `SessionUser` or `accessContext`;
- never log, serialize, cache, or persist the token.

The JWT guard remains responsible for authentication. The decorator only passes the already-validated request credential to the caller-scoped database adapter.

### 3. Read-path split

Do not replace `TagRulesService.supabase` globally. That instance is used by internal reads, writes, and automation.

Add a dedicated method, for example:

```ts
async getTaggingSettingsForCaller(
  tenantId: string,
  accessToken: string,
): Promise<TaggingSettingsDto>
```

It must create a fresh client using `createUserDatabaseClient(accessToken)`, query only `automatic_tagging_enabled`, retain `.eq('tenant_id', tenantId).maybeSingle()`, and preserve the existing default and public error message.

Keep the existing internal `getTaggingSettings(tenantId)` unchanged for the patch flow and background automation in this batch.

Update only the GET controller method to call the new caller method after `ensureTenantAccessOrThrow`. The PATCH route and every tag-rule/CRM route remain unchanged.

### 4. Error behavior

- Authentication failure remains HTTP 401.
- Application authorization failure remains the current non-enumerating response behavior.
- A permitted tenant with no settings row returns `{ automaticTaggingEnabled: false }`.
- A database/network failure returns the existing generic `Could not load tagging settings` error; raw Supabase errors and tokens must not reach the response or logs.
- RLS denial must never be converted into permission success. The application authorization check remains first.

## Mandatory tests before route cutover

### Static and unit tests

1. Caller client uses anon key plus the raw caller JWT.
2. Two calls create different clients and do not reuse authorization headers.
3. Token extractor rejects malformed and oversized values.
4. Controller calls legacy authorization before the caller-scoped read.
5. GET uses the caller-scoped method.
6. PATCH and internal automation still use the internal method.
7. Existing row maps true and false correctly.
8. Missing row preserves the false default.
9. Database error remains generic and contains no token.
10. Migration contains only a SELECT policy for this table.
11. Existing database-client boundary and 59-file ratchet remain green.

### Behavioral staging tests

Create clearly named temporary staging fixtures with guaranteed cleanup:

- One founder fixture with an agency `OWNER` membership.
- Customer Tenant A and Customer Tenant B under the staging AISBP agency.
- Tenant A `ADMIN`, `AGENT`, and `VIEWER` customer identities with no agency membership.
- A Tenant B `ADMIN` customer identity with no Tenant A or agency membership.
- An authenticated user with no membership.
- One settings row for each tenant with distinguishable boolean values.

Prove through the anon-key/JWT client, not service role:

1. The founder can read both Customer Tenant A and Customer Tenant B.
2. Tenant A `ADMIN` reads Tenant A.
3. Tenant A `ADMIN` cannot read Tenant B.
4. Tenant A `AGENT` reads Tenant A but not Tenant B.
5. Tenant A `VIEWER` reads Tenant A but not Tenant B.
6. Tenant B `ADMIN` reads Tenant B but not Tenant A.
7. Every customer fixture is rejected by agency pages and agency-management APIs.
8. An authenticated identity with no membership reads neither tenant.
9. An anonymous client reads neither tenant.
10. Customer callers cannot insert, update, or delete settings directly through RLS.
11. The GET API payload is identical before and after cutover, including the authorized missing-row default.
12. An authorized Tenant A administrator can PATCH through the existing guarded API and the caller-scoped GET reflects the change; agent/viewer write rules remain unchanged.
13. Changing a Tenant A URL or request identifier to Tenant B never returns Tenant B's setting or reveals whether the tenant exists.
14. Tenant A's token is never reused by a subsequent Tenant B request, including concurrent requests.

Fixtures must use reserved staging-only identifiers and be removed in a `finally` cleanup. The test must hard-refuse the production Supabase project reference.

### Founder-only agency prerequisite

Before the first production route cutover:

1. Inventory production `agency_users` using counts and founder-confirmed account identifiers without exposing them in logs or reports.
2. Confirm every remaining agency membership is a founder-controlled login or documented recovery login.
3. Confirm customer onboarding creates `tenant_users` rows only.
4. Add tests proving tenant users cannot call agency controllers even when they know the agency ID.
5. Remove agency-user management from customer-visible navigation and tenant APIs.
6. Specify a separately reversible change to reject new non-founder agency memberships. Do not hardcode an email address or user UUID in RLS or application code.

This prerequisite does not require deleting legacy role enum values. It requires making them unreachable through normal customer provisioning and ensuring no customer holds them.

Production verification on 2026-07-12 found that the real agency owns both production tenants and has exactly two founder-confirmed memberships: one `OWNER` and one `ADMIN`. Neither has a tenant membership, and both must remain. A separate empty test agency has one old test owner. Eight non-production agency records have no tenants, invitations, audit logs, quota logs, or credit events, but contain one old membership, one model-provider row, and seven system-policy rows; they are excluded from this cutover and require a separate export-and-cleanup plan.

Code review confirmed that customer workspace invitations use `WORKSPACE` scope and create `tenant_users` membership. Agency membership requires an explicit agency invitation or agency-member operation. Customer provisioning must continue to use only the workspace path.

### Staging evidence

On 2026-07-12 the SELECT policy was applied to the designated staging project and tested through real anon-key/JWT clients. Eleven database-level assertions passed:

- founder read of both customer tenants;
- Tenant A `ADMIN`, `AGENT`, and `VIEWER` confinement;
- Tenant B `ADMIN` confinement;
- customer denial from the agency table;
- unaffiliated authenticated and anonymous denial;
- insert, update, and delete denial;
- concurrent Customer A/Customer B token isolation.

All temporary fixture agencies, tenants, profiles, authentication users, memberships, and settings were removed. A read-only residue check returned zero fixture rows.

## Deployment gates

1. Re-run the count-only audit in staging.
2. Capture current staging policy definition as rollback evidence.
3. Apply the policy migration to staging.
4. Run all behavioral staging tests with zero unexpected access.
5. Deploy caller-read code to staging.
6. Run API parity and frontend Automation Tags/Assistant Overview smoke tests.
7. Run the full backend and frontend suites and monorepo build.
8. Review results before production approval.
9. Capture the production policy catalogue and migration state.
10. Apply the additive production policy migration.
11. Confirm the legacy production API still works before code deployment.
12. Deploy code through the normal PR/CI pipeline.
13. Verify frontend HTTP 200, unauthenticated API 401, authenticated tagging settings load, and PATCH/GET parity.
14. Monitor errors for at least one normal operating window before selecting the next table.

## Rollback

Code rollback is independent of database rollback.

Fastest rollback:

1. Revert only the controller/service caller-read commit so GET returns to the internal client.
2. Redeploy through CI.
3. Confirm GET and PATCH parity.

The SELECT policy may safely remain because legacy service-role reads bypass it. If policy removal is required after code rollback:

```sql
DROP POLICY IF EXISTS tenant_tagging_settings_member_select
  ON public.tenant_tagging_settings;
```

Do not disable RLS, drop `can_read_tenant`, modify data, or roll back unrelated policies. Since this batch changes no rows or columns, no data restore should be necessary.

## Risks and controls

| Risk | Control |
|---|---|
| Valid user sees default false because policy is missing | Apply and behaviorally verify policy before code |
| App and RLS tenant rules disagree | Reuse `can_read_tenant`; test founder plus every tenant role |
| Legacy agency roles are broader than the founder-only model | Inventory founder-controlled memberships and harden provisioning separately before production cutover |
| Customer gains agency access | Customer provisioning writes only `tenant_users`; adversarial agency endpoint tests |
| Token leaks into logs or session objects | Request-only raw token; static no-logging tests |
| User token reused between requests | Fresh client per call; concurrency test |
| PATCH or automation breaks | Do not migrate writes or internal method |
| Wrong tenant appears as legitimate default false | Keep application authorization first; adversarial API tests |
| Staging results are meaningless due to no fixtures | Seed isolated two-tenant fixtures with cleanup |
| Production differs from repository | Re-run live count-only audit immediately before migration |

## Definition of done

This first cutover is complete only when the policy and route are live, the founder-only agency prerequisite is verified, all founder-versus-customer and cross-tenant staging tests pass, production health checks pass, no tagging-settings regression is observed, and rollback has been proven mechanically. It does not mean KB is fully database-isolated. It establishes the safe pattern to repeat for the remaining resources.
