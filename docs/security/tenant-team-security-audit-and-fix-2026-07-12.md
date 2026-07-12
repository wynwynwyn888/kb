# Tenant Team Security Audit and Fix

Date: 2026-07-12  
Audited baseline: `0b5529a058b02db81b89b6f52d8c9c506af67c49`

## Product boundary

The two founder-controlled agency identities remain one `OWNER` and one `ADMIN`. Customer businesses manage their own team through tenant `ADMIN`, `AGENT`, and `VIEWER` memberships. Customer team actions must never create an agency membership, attach a founder identity as a customer member, or alter another identity's global sign-in credentials.

## P0 finding

The unused `POST /tenant-users/provision-credentials` endpoint accepted an email and caller-chosen password. After authorizing the caller only for the requested tenant, it looked up the email globally and called Supabase Admin `updateUserById` before proving that the target identity belonged to that tenant. A malicious tenant admin who knew a founder or another customer's email could therefore replace that person's global password and attach the identity to the attacker's tenant.

The production tenant-team page does not call this endpoint. It uses the verified email invitation flow. The fix removes the controller endpoint, backend method, global auth-user lookup/update path, and unused frontend API function.

## Additional controls

- Existing agency identities cannot be added to `tenant_users` through profile-ID attachment.
- Workspace invitations reject an email already holding agency membership for the tenant's agency.
- Invite acceptance rejects an authenticated agency identity before inserting tenant membership.
- Workspace password recovery rejects every agency identity, not only agency owners.
- When email delivery is unavailable, a tenant admin never receives another user's recovery action link.
- A database trigger serializes admin removal/demotion per tenant and rejects removal of the last admin, closing the concurrent-request race left by the application count check.

## Unchanged behavior

- Tenant admins can invite a user or another tenant admin by email.
- The invitee must authenticate as the invited email before membership is created.
- Tenant admins can promote, demote and remove members while at least one admin remains.
- Founder agency identities can support all customer tenants without receiving tenant membership.
- Customer membership does not create agency access.
- No production membership, password, invitation or customer data is modified by the code migration.

## Deployment and rollback

The database trigger migration is additive. The application already performs a friendly last-admin check; the trigger is a race-condition backstop. Roll back application code by reverting the endpoint-removal/security commit. Keep the trigger unless it is proven to cause a regression. If trigger removal is necessary after application rollback:

```sql
DROP TRIGGER IF EXISTS tenant_users_keep_last_admin ON public.tenant_users;
DROP FUNCTION IF EXISTS public.prevent_last_tenant_admin_removal();
```

Do not restore the direct-password endpoint without a new design that cannot update an existing global identity.
