# Authenticated Endpoint Authorization Inventory

Baseline: `04a0f24ed0419d6eee7eae87c5b7621b3c7fdb8d`

This inventory classifies every current Nest controller. Every method in a controller inherits the listed boundary unless a narrower method-level rule is stated in code. Route and body IDs select a resource; they never establish permission.

| Controller file | Route group | Boundary | Current decision source | Batch 2 shadow coverage | Enforcement migration note |
|---|---|---|---|---|---|
| `action-intents.controller.ts` | `/action-intents` | tenant | `TenantsService.checkTenantAccess` plus action service | central tenant-read shadow through TenantsService | Add action-specific approve/reject roles before cutover. |
| `agencies.controller.ts` | `/agencies` | agency | authenticated user and agency service predicates | policy unit coverage only | Migrate to agency read/admin decisions. |
| `agency-ai-config.controller.ts` | `/agency-ai-config` | agency | controller/service agency-role checks | policy unit coverage only | Keep credentials owner/admin restricted. |
| `agency-users.controller.ts` | `/agency-users` | agency | membership service role checks | policy unit coverage only | Preserve last-owner and invitation safeguards. |
| `ai-router.controller.ts` | `/ai-router` | tenant | `TenantsService.checkTenantAccess` | central tenant-read shadow through TenantsService | Treat routing as read/execute, not generic write. |
| `audit.controller.ts` | `/audit` | agency/tenant | audit service agency and tenant predicates | policy unit coverage only | Preserve append-only internal writes and scoped reads. |
| `auth.controller.ts` | `/auth` | identity | verified Supabase JWT and resolved memberships | complete `AccessContext` attached to session, not serialized | Keep token/context out of response and logs. |
| `booking-settings.controller.ts` | `/tenants/:tenantId/booking-settings` | tenant | `GhlService.ensureTenantAccessOrThrow` | central tenant-read shadow through GhlService | Add settings read/write distinction before cutover. |
| `calendars.controller.ts` | `/calendars` | tenant | authenticated request plus calendar service tenant context | policy unit coverage only | Require explicit tenant resource resolution. |
| `contacts.controller.ts` | `/contacts` | tenant | authenticated request plus contact service tenant context | policy unit coverage only | Resolve contact ownership before returning existence. |
| `conversations.controller.ts` | `/conversations` | tenant | `TenantsService.checkTenantAccess` and conversation parent lookup | central tenant-read shadow through TenantsService | Add conversation operational action policy. |
| `debug.controller.ts` | `/debug` | platform/operations | production/debug guards and role checks | excluded from tenant shadow | Keep production-disabled or privileged operator only. |
| `follow-up-settings.controller.ts` | `/tenants/:tenantId/follow-up-settings` | tenant | `GhlService.ensureTenantAccessOrThrow` | central tenant-read shadow through GhlService | Add settings read/write distinction before cutover. |
| `formatter.controller.ts` | `/formatter` | authenticated utility | JWT guard; no persistent tenant resource | excluded from tenant shadow | Confirm request contains no cross-tenant database lookup. |
| `ghl.controller.ts` | `/tenants/:tenantId/ghl` | tenant/secret | GHL service tenant access and connection checks | central tenant-read shadow through GhlService | Separate safe status reads from credential mutation. |
| `handover.controller.ts` | `/handover` | tenant | tenant/conversation parent lookup plus `TenantsService` | central tenant-read shadow through TenantsService | Add escalation operational action policy. |
| `human-escalation-settings.controller.ts` | `/tenants/:tenantId/human-escalation-settings` | tenant | `GhlService.ensureTenantAccessOrThrow` | central tenant-read shadow through GhlService | Redact notification destinations for non-admin roles. |
| `tenant-tagging.controller.ts` | `/tenants/:tenantId` tagging routes | tenant | `GhlService.ensureTenantAccessOrThrow` | central tenant-read shadow through GhlService | Add configuration versus sync-execute actions. |
| `kb.controller.ts` | `/kb` | tenant | `TenantsService.checkTenantAccess` plus document/vault lookups | central tenant-read shadow through TenantsService | Add KB read/ingest/admin actions and parent checks. |
| `notifications.controller.ts` | `/notifications` | user | authenticated profile ID | policy unit coverage only | Add workspace scope before tenant policies. |
| `ops.controller.ts` | `/ops` | agency/operations | agency assertion and tenant/resource resolution | policy unit coverage only | Preserve existence-hiding and privileged role restrictions. |
| `prompts.controller.ts` | `/prompts` | tenant/agency | prompt service membership and role checks | policy unit coverage only | Separate prompt read, tenant edit, and global policy admin. |
| `quotas.controller.ts` | `/quotas` | tenant/agency/billing | `TenantsService` plus agency role checks | central tenant-read shadow through TenantsService | Keep wallet mutations in privileged transactional service. |
| `tenant-users.controller.ts` | `/tenant-users` | tenant/authorization | tenant membership administration checks | policy unit coverage only | Add tenant-admin rules and prevent privilege escalation. |
| `tenants.controller.ts` | `/tenants` | tenant/agency | tenant service membership and agency checks | central tenant-read shadow through TenantsService | Separate tenant read, create, edit, and delete actions. |
| `webhooks.controller.ts` | `/webhooks/ghl` | external/internal | webhook verification, location mapping, idempotency | excluded from user authorization shadow | Batch 6 signed-source and worker-envelope boundary. |

## Shadow scope for this batch

Only legacy tenant-read decisions passing through `TenantsService.checkTenantAccess` or GHL's equivalent check are observed. All existing decisions remain final. Controllers marked “policy unit coverage only” are inventoried but deliberately not wired until their action-specific legacy behavior is specified and tested.

This partial wiring is a safety boundary: a generic read/write/admin policy must not be applied to credential, billing, membership, webhook, or operational endpoints without a resource-specific action decision.
