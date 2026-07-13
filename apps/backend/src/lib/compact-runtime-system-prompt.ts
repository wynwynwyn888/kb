import { PROMPT_FIELD_LIMITS } from '@aisbp/types';

const DEFAULT_TENANT_CAP = 7500;
const DEFAULT_AGENCY_CAP = 4200;

/**
 * Legacy single-blob compaction — retained ONLY as a fallback for pure-legacy tenants that have no
 * per-section `profileSections`. The primary runtime path uses field-level section budgets
 * (`compactProfileSections`) so the tenant prompt is no longer squeezed into one 7,500-char blob.
 */
export function compactPersonaPolicyForGeneration(params: {
  tenantPrompt: string;
  agencyPrompt: string;
  tenantCap?: number;
  agencyCap?: number;
}): {
  tenantBody: string;
  agencyBody: string;
  tenantTruncated: boolean;
  agencyTruncated: boolean;
} {
  const tenantCap = params.tenantCap ?? DEFAULT_TENANT_CAP;
  const agencyCap = params.agencyCap ?? DEFAULT_AGENCY_CAP;
  const tp = params.tenantPrompt.trim();
  const ap = params.agencyPrompt.trim();

  const truncate = (body: string, cap: number): { text: string; truncated: boolean } => {
    if (!body) return { text: '', truncated: false };
    const notice = '\n\n[truncated …]';
    if (body.length + notice.length <= cap) return { text: body, truncated: false };
    const take = Math.max(0, cap - notice.length);
    return {
      text: `${body.slice(0, take)}${notice}`,
      truncated: true,
    };
  };

  const tTrunc = truncate(tp, tenantCap);
  const aTrunc = truncate(ap, agencyCap);
  return {
    tenantBody: tTrunc.text,
    agencyBody: aTrunc.text,
    tenantTruncated: tTrunc.truncated,
    agencyTruncated: aTrunc.truncated,
  };
}

// Per-section runtime budgets (characters). Sourced from the shared PROMPT_FIELD_LIMITS so that
// frontend save limits, backend validation, and runtime section budgets never drift. Each tenant
// field has its OWN budget — there is no combined tenant-blob cap — so e.g. a large Business Notes
// section can never truncate Critical Facts, and Conversation Goals is never clipped because the
// whole tenant blob hit a single cap.
//
// Auxiliary sections (toneRules, knowledgeScope) are not part of PROMPT_FIELD_LIMITS but are kept
// as small runtime sections for Preview/runtime parity.
const AUX_SECTION_BUDGETS = {
  toneRules: 1000,
  knowledgeScope: 500,
} as const;

export const RUNTIME_TENANT_SECTION_BUDGETS: Record<string, number> = {
  criticalFacts: PROMPT_FIELD_LIMITS.criticalFacts,
  persona: PROMPT_FIELD_LIMITS.persona,
  goals: PROMPT_FIELD_LIMITS.conversationGoals,
  businessNotes: PROMPT_FIELD_LIMITS.businessNotes,
  salesPlaybook: PROMPT_FIELD_LIMITS.salesPlaybook,
  bookingBehavior: PROMPT_FIELD_LIMITS.bookingBehavior,
  escalationBehavior: PROMPT_FIELD_LIMITS.escalationBehavior,
  toneRules: AUX_SECTION_BUDGETS.toneRules,
  knowledgeScope: AUX_SECTION_BUDGETS.knowledgeScope,
};

/**
 * Injection order for tenant sections. Critical Facts first so locked instructions (e.g. a fixed
 * first-message menu, banned phrasings) lead; the required order then follows.
 */
export const RUNTIME_TENANT_SECTION_ORDER = [
  'criticalFacts',
  'salesPlaybook',
  'bookingBehavior',
  'escalationBehavior',
  'businessNotes',
  'goals',
  'persona',
  'toneRules',
  'knowledgeScope',
] as const;

/**
 * Makes conflict resolution explicit. Platform safety remains non-configurable and superior;
 * this declaration ranks the editable business instruction layers requested by the product.
 */
export const EDITABLE_INSTRUCTION_PRIORITY_DECLARATION =
  'Instruction priority when editable business instructions conflict (highest first): ' +
  'Global Prompt; Critical Facts; Sales Playbook; Booking Behavior; Escalation Behavior; ' +
  'Business Notes; Conversation Goals; Persona; Tone Rules; Knowledge Scope. ' +
  'Platform safety, legal requirements, and confirmed backend capability constraints always override editable instructions. ' +
  'Do not use a lower-priority instruction to weaken, skip, reinterpret, or contradict a higher-priority instruction.';

// The Global Prompt / agency policy is a SEPARATE policy layer with its own independent budget. It
// is injected separately (before tenant sections) and must never compete with tenant fields nor be
// squeezed into the tenant blob. 10,000 is a safe global cap (NOT the legacy 7,500 tenant cap).
export const GLOBAL_POLICY_RUNTIME_BUDGET = 10000;

export interface ProfileSections {
  criticalFacts?: string;
  persona?: string;
  goals?: string;
  businessNotes?: string;
  salesPlaybook?: string;
  toneRules?: string;
  bookingBehavior?: string;
  escalationBehavior?: string;
  knowledgeScope?: string;
}

export interface CompactedSections {
  sections: Record<string, string>;
  truncated: Record<string, boolean>;
  totalChars: number;
  approxTokens: number;
}

function truncateSection(body: string | undefined | null, cap: number): { text: string; truncated: boolean } {
  const b = (body ?? '').trim();
  if (!b) return { text: '', truncated: false };
  if (b.length <= cap) return { text: b, truncated: false };
  const notice = '\n\n[truncated …]';
  const take = Math.max(0, cap - notice.length);
  return { text: `${b.slice(0, take)}${notice}`, truncated: true };
}

/**
 * Per-section prompt compaction with individual field budgets (no combined tenant-blob cap).
 * Only includes non-empty sections, in the canonical injection order. Returns per-section text,
 * truncation flags, and total character / token counts.
 */
export function compactProfileSections(sections: ProfileSections): CompactedSections {
  const result: CompactedSections = {
    sections: {},
    truncated: {},
    totalChars: 0,
    approxTokens: 0,
  };

  for (const key of RUNTIME_TENANT_SECTION_ORDER) {
    const cap = RUNTIME_TENANT_SECTION_BUDGETS[key]!;
    const value = (sections as Record<string, string | undefined>)[key];
    const t = truncateSection(value, cap);
    if (t.text) {
      result.sections[key] = t.text;
      result.truncated[key] = t.truncated;
      result.totalChars += t.text.length;
    }
  }

  result.approxTokens = estimateApproxTokens(result.totalChars);
  return result;
}

/** Build the tenant prompt body from budgeted sections, with headers, in canonical order. */
export function buildCompactedPromptBody(compacted: CompactedSections): string {
  const labels: Record<string, string> = {
    criticalFacts: '### Critical facts',
    persona: '### Bot Persona',
    goals: '### Goals',
    businessNotes: '### Business notes',
    salesPlaybook: '### Sales playbook',
    bookingBehavior: '### Booking behavior',
    escalationBehavior: '### Escalation behavior',
    toneRules: '### Tone rules',
    knowledgeScope: '### Knowledge scope',
  };

  const chunks: string[] = [];
  for (const key of RUNTIME_TENANT_SECTION_ORDER) {
    const text = compacted.sections[key];
    if (text) {
      chunks.push(`${labels[key] ?? key}\n${text}`);
    }
  }
  return chunks.join('\n\n');
}

/**
 * Budget the Global Prompt / agency policy as an independent layer.
 * Uses its own safe cap (default {@link GLOBAL_POLICY_RUNTIME_BUDGET}), never the tenant caps.
 */
export function budgetGlobalPolicy(
  policy: string | null | undefined,
  cap: number = GLOBAL_POLICY_RUNTIME_BUDGET,
): { text: string; truncated: boolean } {
  return truncateSection(policy, cap);
}

/** Rough token estimate (~4 chars per token for Latin scripts). */
export function estimateApproxTokens(chars: number): number {
  if (chars <= 0) return 0;
  return Math.ceil(chars / 4);
}
