/** Align with backend `tenant_bot_profiles.knowledge_scope_mode`. */
export const KNOWLEDGE_SCOPE_ALL_WORKSPACE = 'all_workspace_knowledge';
export const KNOWLEDGE_SCOPE_SELECTED_COLLECTIONS = 'selected_collections';

/** Short label for profile cards (Knowledge: …). */
export function knowledgeScopeCardLabel(mode: string | undefined): string {
  const m = mode?.trim();
  if (m === KNOWLEDGE_SCOPE_SELECTED_COLLECTIONS) return 'Selected collections';
  return 'All workspace knowledge';
}

/** Full sentence for assistant summary card. */
export function knowledgeScopeSentence(mode: string | undefined): string {
  const m = mode?.trim();
  if (m === KNOWLEDGE_SCOPE_SELECTED_COLLECTIONS) {
    return 'Knowledge: Selected collections';
  }
  return 'Knowledge: All workspace knowledge';
}

export function formatProfileUpdatedAt(iso: string): string {
  try {
    const d = new Date(iso);
    if (Number.isNaN(d.getTime())) return iso;
    return d.toLocaleString(undefined, { dateStyle: 'medium', timeStyle: 'short' });
  } catch {
    return iso;
  }
}
