# Row Level Security (RLS) Plan

> **Status: HISTORICAL — SUPERSEDED.** This pre-cutover plan no longer describes
> production. Use `docs/security/README.md` and
> `docs/security/TENANT_ISOLATION_ROADMAP.md` for current decisions. Retained as
> design history only; do not use it as implementation instructions.

## Overview

Supabase Row Level Security policies provide a second layer of tenant isolation. Even with application-level authorization, RLS ensures that database queries are scoped correctly.

## Key Principles

1. **Backend authorization is primary** - RLS is a safety net, not the primary auth mechanism
2. **Application always validates tenant access** - RLS prevents accidental cross-tenant data access
3. **Service role bypasses RLS** - Backend should use service role for admin operations

## Table RLS Policies

### profiles
- Users can read their own profile
- Users can update their own profile
- Admins can read all profiles within their agency (via join)

```sql
-- Users can read/update their own profile
CREATE POLICY "Users can view own profile" ON profiles
  FOR SELECT USING (auth.uid() = id);

CREATE POLICY "Users can update own profile" ON profiles
  FOR UPDATE USING (auth.uid() = id);
```

### agencies
- Agency members can view their agency
- Only OWNER/ADMIN can modify

```sql
-- Agency members can view their agency
CREATE POLICY "Agency members can view agency" ON agencies
  FOR SELECT USING (
    id IN (SELECT agency_id FROM agency_users WHERE profile_id = auth.uid())
  );
```

### agency_users
- Users can view their own membership
- Agency ADMIN/OWNER can view all memberships
- No self-service modification of roles

### tenants
- Agency members can view tenants in their agency
- Tenant members can view their tenant

```sql
-- Agency members can view tenants in their agency
CREATE POLICY "Agency members can view tenants" ON tenants
  FOR SELECT USING (
    agency_id IN (SELECT agency_id FROM agency_users WHERE profile_id = auth.uid())
  );
```

### tenant_users
- Users can view their own tenant memberships
- Tenant ADMIN can view all tenant memberships

```sql
-- Users can view their tenant memberships
CREATE POLICY "Users can view own tenant membership" ON tenant_users
  FOR SELECT USING (profile_id = auth.uid());

-- Tenant admins can view all memberships in their tenant
CREATE POLICY "Tenant admins can view tenant members" ON tenant_users
  FOR SELECT USING (
    tenant_id IN (SELECT id FROM tenants WHERE id IN (
      SELECT tenant_id FROM tenant_users WHERE profile_id = auth.uid() AND role = 'ADMIN'
    ))
  );
```

### tenant_prompt_configs
- Tenant members can view prompt configs for their tenant
- Only tenant ADMIN can modify

```sql
-- Tenant members can view configs
CREATE POLICY "Tenant members can view prompts" ON tenant_prompt_configs
  FOR SELECT USING (
    tenant_id IN (SELECT tenant_id FROM tenant_users WHERE profile_id = auth.uid())
  );
```

### quota_wallets
- Tenant members can view their tenant's wallet
- Only tenant ADMIN can modify

```sql
-- Tenant members can view wallet
CREATE POLICY "Tenant members can view quota" ON quota_wallets
  FOR SELECT USING (
    tenant_id IN (SELECT tenant_id FROM tenant_users WHERE profile_id = auth.uid())
  );
```

### conversations, messages, audit_logs, action_logs
- Tenant-scoped views based on tenant_users membership

## Implementation Notes

1. **Prisma does not natively support RLS** - We use direct SQL for RLS policy management
2. **Migration approach** - RLS policies will be applied via raw SQL migration files
3. **Testing** - Verify RLS by testing queries as different users

## RLS Files Location

RLS policies will be stored in `apps/backend/prisma/rls/` as separate SQL files per table.

## Current Status

**Phase 1 (Current)**: Backend enforces all tenant isolation. RLS policies are planned but not yet applied.

**Phase 2 (Next)**: Apply core RLS policies for: profiles, tenants, tenant_users, tenant_prompt_configs, quota_wallets.

**Phase 3 (Future)**: Apply RLS for remaining tables as needed.
