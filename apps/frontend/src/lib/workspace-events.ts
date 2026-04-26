/** Fired after tenant display metadata changes (e.g. rename) so shell chrome can refresh without a full page reload. */
export const TENANT_WORKSPACE_META_CHANGED = 'aisbp:tenant-workspace-meta-changed';

export type TenantWorkspaceMetaDetail = { tenantId: string };

export function emitTenantWorkspaceMetaChanged(tenantId: string): void {
  if (typeof window === 'undefined') return;
  window.dispatchEvent(new CustomEvent(TENANT_WORKSPACE_META_CHANGED, { detail: { tenantId } }));
}
