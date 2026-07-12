# Single-Agency Access Contract

Status: approved business direction  
Model: one agency, multiple isolated tenant workspaces

## Product invariant

KB has exactly one operating agency. The agency is the ownership root for shared configuration and administration. Each tenant is a separate business workspace whose customer data must remain isolated from other tenants.

The existing `agencies` table remains to avoid a high-risk rewrite. Product flows must not create a second operating agency.

## Role contract

| Actor | Agency-wide configuration | All tenant operational reads | Assigned tenant reads | Tenant writes | Credentials/billing |
|---|---:|---:|---:|---:|---:|
| Agency `OWNER` | Yes | Yes | Yes | Yes | Yes |
| Agency `ADMIN` | Yes | Yes | Yes | Yes | Yes |
| Agency `OPERATOR` | No | Yes | Yes | Operational only | No |
| Agency `MEMBER` only | No | No | No | No | No |
| Tenant `ADMIN` | No | No | Assigned tenants | Administrative within assigned tenant | No agency credentials/billing |
| Tenant `AGENT` | No | No | Assigned tenants | Conversations/escalations within assigned tenant | No |
| Tenant `VIEWER` | No | No | Assigned tenants | No | No |
| Revoked/no membership | No | No | No | No | No |

An agency `MEMBER` may receive tenant access only through an explicit `tenant_users` membership. Client-supplied agency or tenant IDs never grant permission.

## Database-policy contract for the current three RLS resources

For `messages`, `handover_events`, and `tenant_bot_profile_knowledge_vaults`:

- `OWNER`, `ADMIN`, and `OPERATOR` may read rows across all tenants owned by the single agency.
- `MEMBER`, tenant `ADMIN`, tenant `AGENT`, and tenant `VIEWER` may read only explicitly assigned tenant rows.
- Revoked, unrelated, and unauthenticated users receive zero rows.
- Direct authenticated insert/update/delete remains denied until explicit mutation policies and behavioral tests are introduced.
- The service role remains an internal bypass and must not be used as proof that RLS works.

## Required behavioral proof

Staging tests must use three tenants under the one agency and verify positive and negative access with real Supabase JWTs. Migration-text tests are insufficient. Fixtures must be uniquely named, restricted to staging, and removed in `finally` cleanup.

Run the behavioral suite only with staging credentials:

```bash
NODE_ENV=staging ALLOW_STAGING_RLS_FIXTURES=1 pnpm --filter @aisbp/backend security:test:staging-rls
```

The runner also verifies that direct authenticated message and handover inserts remain denied.

## Central authorization shadow mode

Batch 2 introduces a central `AccessContext` and `AuthorizationPolicyService` without replacing existing authorization decisions. Existing checks remain final.

- Shadow comparison is disabled by default and performs zero additional queries while disabled.
- Enable only with `AUTHORIZATION_SHADOW_ENABLED=true` in a controlled environment.
- Disable immediately by removing the variable or setting it to `false`; no deployment or database rollback is required.
- `AUTHORIZATION_SHADOW_LOG_MATCHES=true` may be used temporarily in staging, but should normally remain off.
- Logs contain hashed profile and tenant identifiers, action, source, booleans, and reason codes only. They exclude tokens, emails, tenant names, prompts, customer messages, and database error details.
- A shadow query failure is observation-only: it is safely logged and never alters or interrupts the legacy request.

Known expected disagreement to measure before enforcement: legacy application checks currently treat agency `MEMBER` as tenant-readable, while the deployed database contract requires agency `OWNER`, `ADMIN`, or `OPERATOR` unless the member is explicitly assigned to the tenant.
