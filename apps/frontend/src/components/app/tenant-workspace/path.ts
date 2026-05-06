/**
 * Path segment after `/app/tenant/:tenantId` used for cross-tenant navigation (preserve tab).
 */
export function getWorkspacePathSuffix(pathname: string, activeTenantId: string): string {
  const prefix = `/app/tenant/${activeTenantId}`;
  if (!pathname.startsWith(prefix)) return '/assistant';
  let suffix = pathname.slice(prefix.length);
  if (!suffix || suffix === '/') return '/assistant';
  if (suffix === '/bot' || suffix === '/prompt' || suffix === '/goals') return '/assistant/instructions';
  if (suffix === '/settings' || suffix.startsWith('/settings/')) {
    return suffix.replace(/^\/settings/, '/control-panel');
  }
  return suffix;
}

/**
 * When switching subaccounts, preserve agency Integrations (GHL) with `?subaccount=`, otherwise keep tab/suffix.
 */
export function getSubaccountSwitchHref(pathname: string, targetTenantId: string): string {
  if (pathname.startsWith('/app/agency/settings/ghl')) {
    return `/app/agency/settings/ghl?subaccount=${encodeURIComponent(targetTenantId)}`;
  }
  const m = pathname.match(/^\/app\/tenant\/([^/]+)/);
  if (m?.[1]) {
    const fromId = m[1];
    return `/app/tenant/${targetTenantId}${getWorkspacePathSuffix(pathname, fromId)}`;
  }
  return `/app/tenant/${targetTenantId}/assistant`;
}
