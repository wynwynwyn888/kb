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
}

/** Full subaccount instructions for main orchestration (stacked under agency policy separately). */
export function buildOrchestrationTenantPromptFromProfile(p: BotProfilePromptFields): string {
  const chunks: string[] = [];

  const header = [`### Assistant profile`, `- name: ${p.name.trim() || 'Assistant'}`];
  if (p.description.trim()) {
    header.push('', p.description.trim());
  }
  chunks.push(header.join('\n'));

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
    chunks.push(`### Knowledge scope\n${p.knowledgeScopeNotes.trim()}`);
  }

  return chunks.filter(Boolean).join('\n\n');
}

/** Short appendix for booking NLU (tone / scope hints only). */
export function buildBookingNluProfileAppendix(p: BotProfilePromptFields): string {
  const parts: string[] = [];
  if (p.description.trim()) parts.push(`Business context: ${p.description.trim()}`);
  if (p.toneRules.trim()) parts.push(`Tone: ${p.toneRules.trim()}`);
  if (p.bookingBehaviorNotes.trim()) parts.push(`Booking handling: ${p.bookingBehaviorNotes.trim()}`);
  if (p.knowledgeScopeNotes.trim()) parts.push(`Scope: ${p.knowledgeScopeNotes.trim()}`);
  return parts.join('\n');
}

/** Persona line(s) for booking reply composer user JSON `personaPrompt`. */
export function buildBookingReplyPersonaPrompt(p: BotProfilePromptFields): string {
  const parts: string[] = [];
  if (p.persona.trim()) parts.push(p.persona.trim());
  if (p.toneRules.trim()) parts.push(`Tone rules: ${p.toneRules.trim()}`);
  if (p.bookingBehaviorNotes.trim()) parts.push(`Booking style: ${p.bookingBehaviorNotes.trim()}`);
  return parts.join('\n\n');
}
