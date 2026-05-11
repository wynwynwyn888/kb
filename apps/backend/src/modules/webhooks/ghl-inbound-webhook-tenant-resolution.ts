/**
 * Canonical inbound GHL webhook → tenant routing.
 * Source of truth: tenant_ghl_connections (CONNECTED + ghl_location_id), not tenants.ghl_location_id.
 */

export type WebhookGhlRouteSource = 'tenant_ghl_connection' | 'tenant_legacy_location_match';

export type ResolveInboundGhlWebhookTenantResult =
  | {
      ok: true;
      tenantId: string;
      routeSource: WebhookGhlRouteSource;
      /** Incoming / connection canonical location id (trimmed). */
      connectionLocationId: string | null;
      /** tenants.ghl_location_id at time of resolution (may drift from connection row). */
      tenantLegacyGhlLocationId: string | null;
    }
  | { ok: false; reason: 'no_match' | 'duplicate_crm_location'; duplicateTenantIds?: string[] };

function normLoc(s: string | null | undefined): string {
  return (s ?? '').trim();
}

function logWarn(logger: { warn: (m: string) => void } | undefined, msg: string): void {
  logger?.warn(msg);
}

/**
 * Resolves which tenant should receive an inbound GHL webhook for `locationId`.
 *
 * Order: (1) CONNECTED tenant_ghl_connections rows for locationId — duplicate if >1;
 * (2) single row + tenant bot_enabled / !handover_paused → connection match;
 * (3) legacy tenants.ghl_location_id match when no qualifying connection route (unique legacy id).
 */
export async function resolveInboundGhlWebhookTenant(params: {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  supabase: any;
  locationId: string;
  logger?: { warn: (m: string) => void; log?: (m: string) => void };
}): Promise<ResolveInboundGhlWebhookTenantResult> {
  const { supabase, locationId, logger } = params;
  const trimmed = normLoc(locationId);
  if (!trimmed) {
    return { ok: false, reason: 'no_match' };
  }

  const { data: rawConnections, error: connErr } = await supabase
    .from('tenant_ghl_connections')
    .select('tenant_id, ghl_location_id, status')
    .eq('ghl_location_id', trimmed)
    .eq('status', 'CONNECTED');

  if (connErr) {
    logWarn(
      logger,
      `[resolveInboundGhlWebhookTenant] tenant_ghl_connections query failed: ${String((connErr as { message?: string }).message ?? connErr)}`,
    );
    return { ok: false, reason: 'no_match' };
  }

  const connectedRows =
    (rawConnections as { tenant_id: string; ghl_location_id?: string | null; status?: string }[] | null)?.filter(
      (r) => normLoc(r.ghl_location_id) === trimmed && normLoc(r.ghl_location_id) !== '',
    ) ?? [];

  if (connectedRows.length > 1) {
    const duplicateTenantIds = connectedRows.map((r) => r.tenant_id);
    logWarn(
      logger,
      `Duplicate CRM location mapping detected. AI reply skipped. locationId=${trimmed} tenantIds=${duplicateTenantIds.join(',')}`,
    );
    return { ok: false, reason: 'duplicate_crm_location', duplicateTenantIds };
  }

  const tryConnectionRow = async (
    row: { tenant_id: string; ghl_location_id?: string | null },
  ): Promise<ResolveInboundGhlWebhookTenantResult | null> => {
    const { data: tenant, error: tErr } = await supabase
      .from('tenants')
      .select('id, ghl_location_id, bot_enabled, handover_paused, name, is_agency_workspace')
      .eq('id', row.tenant_id)
      .single();

    if (tErr || !tenant) return null;
    const t = tenant as {
      id: string;
      ghl_location_id?: string | null;
      bot_enabled?: boolean;
      handover_paused?: boolean;
    };
    if (!t.bot_enabled || t.handover_paused) {
      return null;
    }
    return {
      ok: true,
      tenantId: t.id,
      routeSource: 'tenant_ghl_connection',
      connectionLocationId: trimmed,
      tenantLegacyGhlLocationId: t.ghl_location_id ?? null,
    };
  };

  if (connectedRows.length === 1) {
    const only = connectedRows[0];
    if (only) {
      const resolved = await tryConnectionRow(only);
      if (resolved) {
        return resolved;
      }
    }
  }

  const { data: legacyTenant, error: legErr } = await supabase
    .from('tenants')
    .select('id, ghl_location_id, bot_enabled, handover_paused, name, is_agency_workspace')
    .eq('ghl_location_id', trimmed)
    .maybeSingle();

  if (legErr || !legacyTenant) {
    return { ok: false, reason: 'no_match' };
  }

  const lt = legacyTenant as {
    id: string;
    ghl_location_id?: string | null;
    bot_enabled?: boolean;
    handover_paused?: boolean;
  };

  if (!lt.bot_enabled || lt.handover_paused) {
    return { ok: false, reason: 'no_match' };
  }

  logWarn(
    logger,
    `routeSource=tenant_legacy_location_match tenantId=${lt.id} locationId=${trimmed} (no qualifying CONNECTED tenant_ghl_connections row; using tenants.ghl_location_id)`,
  );

  return {
    ok: true,
    tenantId: lt.id,
    routeSource: 'tenant_legacy_location_match',
    connectionLocationId: null,
    tenantLegacyGhlLocationId: lt.ghl_location_id ?? null,
  };
}
