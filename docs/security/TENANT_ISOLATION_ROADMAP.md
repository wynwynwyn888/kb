# Tenant Isolation Roadmap

Status: **CURRENT**  
Production baseline: `df951eaf0d577fb52848539811772d2869035b6e`  
Last verified: 2026-07-12

## Goal

Protect every customer workspace with two independent boundaries: application
authorization and database-enforced tenant isolation. Preserve the private
founder agency model while allowing customers to manage users only inside their
own tenant.

## Current production position

- Row-level security is enabled on all public application tables.
- Five tables have authenticated tenant-scoped SELECT policies:
  `messages`, `handover_events`, `tenant_bot_profile_knowledge_vaults`,
  `tenant_tagging_settings`, and `tenant_users`.
- Caller-scoped database reads are deployed for tagging settings, tenant
  rosters, and booking settings. Roster profile visibility is limited by a
  narrow RPC; booking staff-alert fields are redacted for read-only roles; the
  global `profiles` directory remains closed.
- User-facing service-role access remains the principal migration risk and must
  be reduced one resource group at a time.
- Internal workers, webhooks, migrations, and narrow administration may retain
  service-role access when explicitly classified and tested.

## Current cutover

`tenant_booking_settings` reads use a fixed caller-JWT RPC because the table
contains a staff notification destination/template. Direct authenticated table
reads and writes remain closed. Tenant ADMIN and agency OWNER/ADMIN can manage;
tenant AGENT/VIEWER and agency OPERATOR receive read-only, redacted status.

Do not select another table until the booking-settings deployment has passed its
production verification and normal operating window. The next candidate must be
chosen from the catalogue using the same risk review; it is not pre-approved by
this roadmap.

## Required safety gates for every resource group

1. Confirm ownership columns, foreign keys, null rules, and tenant-leading
   indexes.
2. Inventory every endpoint, worker, webhook, script, and service-role call.
3. Preserve the application authorization check before the database call.
4. Add only the minimum policy or narrow RPC needed for the selected operation.
5. Keep authenticated mutations denied until separately specified and tested.
6. Test founder roles, every supported tenant role, unrelated tenant,
   unaffiliated authenticated user, revoked user, and anonymous user.
7. Run two-tenant concurrent-token and direct-table adversarial tests on staging.
8. Run feature regression tests and the full backend/frontend test and build
   suites.
9. Prove fast code rollback and document optional database rollback.
10. Deploy the exact reviewed commit, verify production read-only, and check live
    health before selecting the next table.

## Sequencing

1. Low-risk tenant settings reads.
2. Tenant and agency identity/root reads with non-recursive policies.
3. Prompt and bot configuration reads.
4. Knowledge metadata and content, after parent-child ownership constraints.
5. Conversation and operational data, with assignment and retention decisions.
6. Billing, credentials, audit, notification, and worker-owned resources only
   after their specialized ownership models are resolved.

Avoid bulk conversion. A small reversible cutover is safer than enabling broad
policies across many tables in one release.

## Document lifecycle

- This roadmap and `tenant-data-catalogue.md` describe current direction.
- Completed cutover documents remain beside the current documents as deployment
  and rollback evidence.
- Superseded plans and point-in-time audits move to `docs/archive/security/` with
  an explicit historical banner.
- Applied migrations are permanent history and are never archived out of the
  Prisma migration chain.
