/**
 * Parse / build tenant bot profile text for orchestration and legacy `system_prompt` storage.
 * Mirrors `TenantGoalsPanel` section headers so existing saved blobs round-trip.
 */

export type ParsedPromptSections = { persona: string; goals: string; additional: string };

export function parsePromptSections(raw: string): ParsedPromptSections {
  const t = (raw || '').trimEnd();
  if (!t) return { persona: '', goals: '', additional: '' };

  const lines = t.split(/\r?\n/);
  const headerPersona = '### Bot Persona';
  const headerGoals = '### Goals';
  const headerAdditional = '### Additional information';

  const hasOurPersonaHeader = lines.some(l => l.trim() === headerPersona);
  if (!hasOurPersonaHeader) {
    return { persona: '', goals: t.trim(), additional: '' };
  }

  type Section = 'none' | 'persona' | 'goals' | 'additional';
  let section: Section = 'none';
  const buckets: Record<'persona' | 'goals' | 'additional', string[]> = {
    persona: [],
    goals: [],
    additional: [],
  };

  for (const line of lines) {
    const trimmed = line.trim();
    if (trimmed === headerPersona) {
      section = 'persona';
      continue;
    }
    if (trimmed === headerGoals) {
      section = 'goals';
      continue;
    }
    if (trimmed === headerAdditional) {
      section = 'additional';
      continue;
    }
    if (section === 'none') continue;
    buckets[section].push(line);
  }

  const persona = buckets.persona.join('\n').trim();
  const goals = buckets.goals.join('\n').trim();
  const additional = buckets.additional.join('\n').trim();

  if (!persona && !goals && !additional) {
    return { persona: '', goals: t.trim(), additional: '' };
  }
  return { persona, goals, additional };
}

/** Legacy three-block blob stored in `tenant_prompt_configs.system_prompt`. */
export function buildThreeSectionPromptBlob(
  persona: string,
  conversationGoals: string,
  businessNotes: string,
): string {
  return [
    '### Bot Persona',
    persona.trim(),
    '',
    '### Goals',
    conversationGoals.trim(),
    '',
    '### Additional information',
    businessNotes.trim(),
  ].join('\n');
}

/** Assistant KB access: all vaults vs named vault subset. */
export const KNOWLEDGE_ACCESS_ALL_VAULTS = 'all_vaults';
export const KNOWLEDGE_ACCESS_SELECTED_VAULTS = 'selected_vaults';

/** Legacy DB column `knowledge_scope_mode` — kept in sync for older readers. */
export const KNOWLEDGE_SCOPE_ALL_WORKSPACE = 'all_workspace_knowledge';
export const KNOWLEDGE_SCOPE_SELECTED_COLLECTIONS = 'selected_collections';

export interface BotProfilePromptFields {
  name: string;
  description: string;
  persona: string;
  conversationGoals: string;
  businessNotes: string;
  toneRules: string;
  bookingBehaviorNotes: string;
  escalationBehaviorNotes: string;
  knowledgeScopeNotes: string;
  /** One line for orchestration / booking appendix, e.g. "Knowledge access: All knowledge vaults" */
  knowledgeAccessSummary: string;
}

/** Build the single-line knowledge access hint for prompts. */
export function buildKnowledgeAccessSummaryLine(
  accessMode: string | undefined,
  selectedVaultNames: string[],
): string {
  const m = (accessMode ?? '').trim();
  if (m === KNOWLEDGE_ACCESS_SELECTED_VAULTS && selectedVaultNames.length > 0) {
    return `Knowledge access: Selected vaults: ${selectedVaultNames.join(', ')}`;
  }
  if (m === KNOWLEDGE_ACCESS_SELECTED_VAULTS) {
    return 'Knowledge access: Selected vaults (none assigned)';
  }
  return 'Knowledge access: All knowledge vaults';
}

/** Full subaccount instructions for main orchestration (stacked under agency policy separately). */
export function buildOrchestrationTenantPromptFromProfile(p: BotProfilePromptFields): string {
  const chunks: string[] = [];

  const header = [`### Assistant profile`, `- name: ${p.name.trim() || 'Assistant'}`];
  if (p.description.trim()) {
    header.push('', p.description.trim());
  }
  chunks.push(header.join('\n'));

  chunks.push(p.knowledgeAccessSummary.trim() || buildKnowledgeAccessSummaryLine(KNOWLEDGE_ACCESS_ALL_VAULTS, []));

  chunks.push(
    buildThreeSectionPromptBlob(p.persona, p.conversationGoals, p.businessNotes),
  );

  if (p.toneRules.trim()) {
    chunks.push(`### Tone rules\n${p.toneRules.trim()}`);
  }
  if (p.bookingBehaviorNotes.trim()) {
    chunks.push(`### Booking behavior\n${p.bookingBehaviorNotes.trim()}`);
  }
  if (p.escalationBehaviorNotes.trim()) {
    chunks.push(`### Escalation behavior\n${p.escalationBehaviorNotes.trim()}`);
  }
  if (p.knowledgeScopeNotes.trim()) {
    chunks.push(`### Knowledge scope notes\n${p.knowledgeScopeNotes.trim()}`);
  }

  return chunks.filter(Boolean).join('\n\n');
}

/** Short appendix for booking NLU (tone / scope hints only). */
export function buildBookingNluProfileAppendix(p: BotProfilePromptFields): string {
  const parts: string[] = [];
  parts.push(p.knowledgeAccessSummary.trim() || buildKnowledgeAccessSummaryLine(KNOWLEDGE_ACCESS_ALL_VAULTS, []));
  if (p.description.trim()) parts.push(`Business context: ${p.description.trim()}`);
  if (p.toneRules.trim()) parts.push(`Tone: ${p.toneRules.trim()}`);
  if (p.bookingBehaviorNotes.trim()) parts.push(`Booking handling: ${p.bookingBehaviorNotes.trim()}`);
  if (p.knowledgeScopeNotes.trim()) parts.push(`Scope notes: ${p.knowledgeScopeNotes.trim()}`);
  return parts.filter(Boolean).join('\n');
}

/** Persona line(s) for booking reply composer user JSON `personaPrompt`. */
export function buildBookingReplyPersonaPrompt(p: BotProfilePromptFields): string {
  const parts: string[] = [
    p.knowledgeAccessSummary.trim() || buildKnowledgeAccessSummaryLine(KNOWLEDGE_ACCESS_ALL_VAULTS, []),
  ];
  if (p.persona.trim()) parts.push(p.persona.trim());
  if (p.toneRules.trim()) parts.push(`Tone rules: ${p.toneRules.trim()}`);
  if (p.bookingBehaviorNotes.trim()) parts.push(`Booking style: ${p.bookingBehaviorNotes.trim()}`);
  return parts.filter(Boolean).join('\n\n');
}
