-- Restore partial/conditional safety indexes that can be lost when a database
-- schema is created outside the Prisma migration ledger. Every statement is
-- additive and idempotent. Duplicate preflight counts must be zero before deploy.

SET lock_timeout = '5s';

CREATE UNIQUE INDEX IF NOT EXISTS tenant_bot_profiles_one_active_per_tenant
  ON public.tenant_bot_profiles (tenant_id)
  WHERE is_active = true;

CREATE UNIQUE INDEX IF NOT EXISTS quota_ledgers_idempotency_key_unique
  ON public.quota_ledgers (idempotency_key)
  WHERE idempotency_key IS NOT NULL;

CREATE UNIQUE INDEX IF NOT EXISTS user_invitations_pending_unique
  ON public.user_invitations (
    agency_id,
    COALESCE(tenant_id, ''),
    scope,
    email_normalized
  )
  WHERE status = 'PENDING';

CREATE UNIQUE INDEX IF NOT EXISTS tenants_one_agency_workspace_per_agency
  ON public.tenants (agency_id)
  WHERE is_agency_workspace = true;

CREATE UNIQUE INDEX IF NOT EXISTS workspace_credit_warning_events_sent_unique
  ON public.workspace_credit_warning_events (
    tenant_id,
    threshold,
    billing_period_end
  )
  NULLS NOT DISTINCT
  WHERE status = 'SENT';

CREATE UNIQUE INDEX IF NOT EXISTS tenant_ghl_connections_connected_location_uidx
  ON public.tenant_ghl_connections (ghl_location_id)
  WHERE status = 'CONNECTED'
    AND ghl_location_id IS NOT NULL
    AND length(trim(ghl_location_id)) > 0;

CREATE UNIQUE INDEX IF NOT EXISTS workspace_credit_reset_reminder_events_sent_unique
  ON public.workspace_credit_reset_reminder_events (
    tenant_id,
    days_before_reset,
    billing_period_end
  )
  NULLS NOT DISTINCT
  WHERE status = 'SENT';
