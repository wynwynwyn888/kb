/** Shared client-workspace nav: sidebar (AppShell) + advanced subnav (TenantWorkspaceChrome). */

export type TenantNavItem = {
  href: string;
  label: string;
  /** Lucide-style label for aria; icon rendered in UI */
  icon: 'settings' | 'book' | 'bot' | 'chart' | 'users' | 'scroll' | 'sliders';
  match: (pathname: string) => boolean;
};

export function tenantBasePath(tenantId: string): string {
  return `/app/tenant/${tenantId}`;
}

export function isAdvancedPath(pathname: string, tenantId: string): boolean {
  const base = tenantBasePath(tenantId);
  return (
    pathname === `${base}/advanced` ||
    pathname.startsWith(`${base}/ghl-status`) ||
    pathname.startsWith(`${base}/diagnostics`) ||
    pathname.startsWith(`${base}/conversations`)
  );
}

export function buildTenantNavItems(tenantId: string): TenantNavItem[] {
  const base = tenantBasePath(tenantId);
  return [
    { href: `${base}/settings`, label: 'Settings', icon: 'settings', match: p => p === `${base}/settings` || p.startsWith(`${base}/settings/`) },
    { href: `${base}/knowledge`, label: 'Knowledge', icon: 'book', match: p => p === `${base}/knowledge` },
    {
      href: `${base}/goals`,
      label: 'Bot Instructions',
      icon: 'bot',
      match: p => p === `${base}/goals` || p === `${base}/bot` || p === `${base}/prompt`,
    },
    { href: `${base}/usage`, label: 'Usage', icon: 'chart', match: p => p === `${base}/usage` },
    { href: `${base}/team`, label: 'Team', icon: 'users', match: p => p === `${base}/team` },
    { href: `${base}/log`, label: 'Log', icon: 'scroll', match: p => p.startsWith(`${base}/log`) },
    {
      href: `${base}/advanced`,
      label: 'Advanced',
      icon: 'sliders',
      match: p => isAdvancedPath(p, tenantId),
    },
  ];
}
