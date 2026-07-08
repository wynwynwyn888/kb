/** Shared client-workspace nav: sidebar (AppShell) + advanced subnav (TenantWorkspaceChrome). */

export type TenantNavIconId = 'settings' | 'book' | 'bot' | 'automation' | 'chart' | 'users' | 'scroll' | 'sliders';

/** @deprecated Flat nav item — use `TenantNavNode` + `buildTenantSidebarNav`. */
export type TenantNavItem = {
  href: string;
  label: string;
  icon: TenantNavIconId;
  match: (pathname: string) => boolean;
};

export type TenantNavChild = {
  href: string;
  label: string;
  match: (pathname: string) => boolean;
};

export type TenantNavGroup = {
  kind: 'group';
  label: string;
  icon: TenantNavIconId;
  overviewHref: string;
  /** True when overview or any child is active */
  match: (pathname: string) => boolean;
  children: TenantNavChild[];
};

export type TenantNavLeaf = {
  kind: 'leaf';
  href: string;
  label: string;
  icon: TenantNavIconId;
  match: (pathname: string) => boolean;
};

export type TenantNavNode = TenantNavLeaf | TenantNavGroup;

export function tenantBasePath(tenantId: string): string {
  return `/app/tenant/${tenantId}`;
}

/** Exact route or a nested segment (`route/sub`), not `route-suffix` false positives. */
export function isPathOrChild(pathname: string, route: string): boolean {
  return pathname === route || pathname.startsWith(`${route}/`);
}

/** UI grouping for Advanced chrome/highlight only — not used for access control. */
export function isAdvancedPath(pathname: string, tenantId: string): boolean {
  const base = tenantBasePath(tenantId);
  return (
    isPathOrChild(pathname, `${base}/advanced`) ||
    isPathOrChild(pathname, `${base}/ghl-status`) ||
    isPathOrChild(pathname, `${base}/diagnostics`) ||
    isPathOrChild(pathname, `${base}/conversations`)
  );
}

/** Advanced hub tools hidden from pure tenant users (CRM status stays reachable from Control Panel). */
export function isAgencyOnlyAdvancedRoute(pathname: string, tenantId: string): boolean {
  const base = tenantBasePath(tenantId);
  return (
    isPathOrChild(pathname, `${base}/advanced`) ||
    isPathOrChild(pathname, `${base}/diagnostics`) ||
    isPathOrChild(pathname, `${base}/conversations`)
  );
}

function assistantSubtreeMatch(base: string, pathname: string): boolean {
  const a = `${base}/assistant`;
  return (
    pathname === a ||
    pathname.startsWith(`${a}/`) ||
    pathname === `${base}/goals` ||
    pathname === `${base}/bot` ||
    pathname === `${base}/prompt` ||
    false
  );
}

function automationSubtreeMatch(base: string, pathname: string): boolean {
  const a = `${base}/automation`;
  const legacyA = `${base}/assistant/automation`;
  return pathname === a || pathname.startsWith(`${a}/`) || pathname === legacyA || pathname.startsWith(`${legacyA}/`);
}

export function buildTenantSidebarNav(
  tenantId: string,
  opts: { showAdvanced: boolean; showLogs: boolean },
): TenantNavNode[] {
  const base = tenantBasePath(tenantId);
  const assistantBase = `${base}/assistant`;
  const automationBase = `${base}/automation`;

  const nodes: TenantNavNode[] = [
    {
      kind: 'leaf',
      href: `${base}/control-panel`,
      label: 'Control Panel',
      icon: 'settings',
      match: p =>
        p === `${base}/control-panel` ||
        p.startsWith(`${base}/control-panel/`) ||
        p === `${base}/settings` ||
        p.startsWith(`${base}/settings/`),
    },
    {
      kind: 'group',
      label: 'AI Agent',
      icon: 'bot',
      overviewHref: assistantBase,
      match: p => assistantSubtreeMatch(base, p),
      children: [
        {
          href: `${assistantBase}/profiles`,
          label: 'Profiles',
          match: p => p === `${assistantBase}/profiles`,
        },
        {
          href: `${assistantBase}/instructions`,
          label: 'Instructions',
          match: p =>
            p === `${assistantBase}/instructions` ||
            p === `${assistantBase}/preview` ||
            p === `${assistantBase}/test-bot` ||
            p === `${base}/goals` ||
            p === `${base}/bot` ||
            p === `${base}/prompt`,
        },
      ],
    },
    {
      kind: 'group',
      label: 'Automation',
      icon: 'automation',
      overviewHref: automationBase,
      match: p => automationSubtreeMatch(base, p),
      children: [
        {
          href: `${automationBase}/tagging`,
          label: 'Tagging',
          match: p => p === `${automationBase}/tagging` || p === `${automationBase}/tags`,
        },
        {

          href: `${automationBase}/follow-up`,
          label: 'Follow-up',
          match: p => p === `${automationBase}/follow-up`,
        },
        {
          href: `${automationBase}/escalation`,
          label: 'Human Escalation',
          match: p => p === `${automationBase}/escalation`,
        },
      ],
    },
    {
      kind: 'leaf',
      href: `${base}/knowledge-vaults`,
      label: 'Knowledge Vaults',
      icon: 'book',
      match: p => p === `${base}/knowledge-vaults` || p === `${base}/knowledge`,
    },
    {
      kind: 'leaf',
      href: `${base}/usage`,
      label: 'Credit & Usage',
      icon: 'chart',
      match: p => p === `${base}/usage`,
    },
    {
      kind: 'leaf',
      href: `${base}/team`,
      label: 'Team',
      icon: 'users',
      match: p => p === `${base}/team`,
    },
  ];

  if (opts.showLogs) {
    nodes.push({
      kind: 'leaf',
      href: `${base}/log`,
      label: 'Logs',
      icon: 'scroll',
      match: p => p.startsWith(`${base}/log`),
    });
  }

  if (opts.showAdvanced) {
    nodes.push({
      kind: 'leaf',
      href: `${base}/advanced`,
      label: 'Advanced',
      icon: 'sliders',
      match: p => isAdvancedPath(p, tenantId),
    });
  }

  return nodes;
}

/** @deprecated */
export function buildTenantNavItems(tenantId: string): TenantNavItem[] {
  return buildTenantSidebarNav(tenantId, { showAdvanced: true, showLogs: true }).flatMap(node => {
    if (node.kind === 'leaf') {
      return [{ href: node.href, label: node.label, icon: node.icon, match: node.match }];
    }
    return [
      { href: node.overviewHref, label: node.label, icon: node.icon, match: node.match },
      ...node.children.map(c => ({
        href: c.href,
        label: c.label,
        icon: node.icon,
        match: c.match,
      })),
    ];
  });
}
