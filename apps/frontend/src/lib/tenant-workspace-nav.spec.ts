import { describe, expect, it } from 'vitest';
import {
  isAdvancedPath,
  isAgencyOnlyAdvancedRoute,
  isPathOrChild,
  tenantBasePath,
} from './tenant-workspace-nav';

/** Mirrors TenantWorkspaceGate: pure tenant users are redirected when this is true. */
function tenantAdvancedBlocked(pathname: string, tenantId: string, isAgencyStaff: boolean): boolean {
  return !isAgencyStaff && isAgencyOnlyAdvancedRoute(pathname, tenantId);
}

describe('isPathOrChild', () => {
  it('matches exact path', () => {
    expect(isPathOrChild('/app/tenant/x/diagnostics', '/app/tenant/x/diagnostics')).toBe(true);
  });

  it('matches nested paths under route', () => {
    expect(isPathOrChild('/app/tenant/x/diagnostics/run', '/app/tenant/x/diagnostics')).toBe(true);
  });

  it('does not match sibling segments that share a prefix', () => {
    expect(isPathOrChild('/app/tenant/x/diagnostics-extra', '/app/tenant/x/diagnostics')).toBe(false);
    expect(isPathOrChild('/app/tenant/x/conversations-feed', '/app/tenant/x/conversations')).toBe(false);
    expect(isPathOrChild('/app/tenant/x/advanced-settings', '/app/tenant/x/advanced')).toBe(false);
  });
});

describe('isAdvancedPath', () => {
  const tid = 'tenant_xyz';
  const base = tenantBasePath(tid);

  it('returns true for advanced, ghl-status, diagnostics, conversations and nested segments', () => {
    expect(isAdvancedPath(`${base}/advanced`, tid)).toBe(true);
    expect(isAdvancedPath(`${base}/advanced/anything`, tid)).toBe(true);
    expect(isAdvancedPath(`${base}/ghl-status`, tid)).toBe(true);
    expect(isAdvancedPath(`${base}/ghl-status/sync`, tid)).toBe(true);
    expect(isAdvancedPath(`${base}/diagnostics`, tid)).toBe(true);
    expect(isAdvancedPath(`${base}/diagnostics/health`, tid)).toBe(true);
    expect(isAdvancedPath(`${base}/conversations`, tid)).toBe(true);
    expect(isAdvancedPath(`${base}/conversations/abc`, tid)).toBe(true);
  });

  it('returns false for prefix sibling segments', () => {
    expect(isAdvancedPath(`${base}/advanced-settings`, tid)).toBe(false);
    expect(isAdvancedPath(`${base}/ghl-status-old`, tid)).toBe(false);
    expect(isAdvancedPath(`${base}/diagnostics-extra`, tid)).toBe(false);
    expect(isAdvancedPath(`${base}/conversations-feed`, tid)).toBe(false);
  });
});

describe('isAgencyOnlyAdvancedRoute', () => {
  const tid = 'sub_abc';

  it('does not include ghl-status (tenant CRM link from Control Panel)', () => {
    const base = tenantBasePath(tid);
    expect(isAgencyOnlyAdvancedRoute(`${base}/ghl-status`, tid)).toBe(false);
    expect(isAgencyOnlyAdvancedRoute(`${base}/ghl-status/detail`, tid)).toBe(false);
  });

  it('matches advanced, diagnostics, and conversations with boundary-safe segments', () => {
    const base = tenantBasePath(tid);
    expect(isAgencyOnlyAdvancedRoute(`${base}/advanced`, tid)).toBe(true);
    expect(isAgencyOnlyAdvancedRoute(`${base}/advanced/`, tid)).toBe(true);
    expect(isAgencyOnlyAdvancedRoute(`${base}/diagnostics`, tid)).toBe(true);
    expect(isAgencyOnlyAdvancedRoute(`${base}/diagnostics/probes`, tid)).toBe(true);
    expect(isAgencyOnlyAdvancedRoute(`${base}/conversations`, tid)).toBe(true);
    expect(isAgencyOnlyAdvancedRoute(`${base}/conversations/thread/1`, tid)).toBe(true);
  });

  it('does not match similarly named paths', () => {
    const base = tenantBasePath(tid);
    expect(isAgencyOnlyAdvancedRoute(`${base}/diagnostics-backup`, tid)).toBe(false);
    expect(isAgencyOnlyAdvancedRoute(`${base}/conversations-old`, tid)).toBe(false);
  });
});

describe('tenant advanced access (gate semantics)', () => {
  const tid = 't1';
  const base = tenantBasePath(tid);

  it('isAdvancedPath groups ghl-status with Advanced UI but tenantAdvancedBlocked still allows tenants on ghl-status only', () => {
    expect(isAdvancedPath(`${base}/ghl-status`, tid)).toBe(true);
    expect(isAdvancedPath(`${base}/ghl-status/sync`, tid)).toBe(true);
    expect(tenantAdvancedBlocked(`${base}/ghl-status`, tid, false)).toBe(false);
    expect(tenantAdvancedBlocked(`${base}/ghl-status/sync`, tid, false)).toBe(false);
    expect(isAdvancedPath(`${base}/advanced`, tid)).toBe(true);
    expect(tenantAdvancedBlocked(`${base}/advanced`, tid, false)).toBe(true);
    expect(isAdvancedPath(`${base}/diagnostics/health`, tid)).toBe(true);
    expect(tenantAdvancedBlocked(`${base}/diagnostics/health`, tid, false)).toBe(true);
  });

  it('pure tenant can access ghl-status', () => {
    expect(tenantAdvancedBlocked(`${base}/ghl-status`, tid, false)).toBe(false);
    expect(tenantAdvancedBlocked(`${base}/ghl-status/sync`, tid, false)).toBe(false);
  });

  it('pure tenant is blocked from advanced, diagnostics, conversations', () => {
    expect(tenantAdvancedBlocked(`${base}/advanced`, tid, false)).toBe(true);
    expect(tenantAdvancedBlocked(`${base}/diagnostics`, tid, false)).toBe(true);
    expect(tenantAdvancedBlocked(`${base}/conversations`, tid, false)).toBe(true);
    expect(tenantAdvancedBlocked(`${base}/diagnostics/x`, tid, false)).toBe(true);
  });

  it('agency user is not blocked on any of those routes', () => {
    const routes = [
      `${base}/ghl-status`,
      `${base}/advanced`,
      `${base}/diagnostics`,
      `${base}/conversations`,
      `${base}/diagnostics/routes`,
    ];
    for (const p of routes) {
      expect(tenantAdvancedBlocked(p, tid, true)).toBe(false);
    }
  });
});
