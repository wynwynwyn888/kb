/**
 * Display-only workspace title for lists and switchers.
 * Does not change stored `name` in the database.
 */
export function formatWorkspaceDisplayName(workspace: {
  name?: string | null;
  id?: string | null;
  /** Internal agency/system workspace (CRM for agency-owned sends, low-credit warnings). */
  isAgencyWorkspace?: boolean;
}): string {
  const raw = (workspace.name ?? '').trim();
  const name =
    raw ||
    (workspace.id && String(workspace.id).length >= 8
      ? `Workspace ${String(workspace.id).slice(0, 8)}…`
      : 'Workspace');
  if (workspace.isAgencyWorkspace) {
    return `${name} (Agency Workspace)`;
  }
  return name;
}
