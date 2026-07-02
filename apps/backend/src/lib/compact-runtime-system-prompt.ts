const DEFAULT_TENANT_CAP = 7500;
const DEFAULT_AGENCY_CAP = 4200;

/**
 * Stored persona/policy stays full-size in DB; generation uses capped bodies to control token burn.
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

// Per-section budget caps (characters)
const SECTION_CAPS: Record<string, number> = {
  criticalFacts: 1500,
  persona: 1500,
  goals: 5000,
  businessNotes: 5000,
  toneRules: 1000,
  bookingBehavior: 1000,
  escalationBehavior: 1000,
  knowledgeScope: 500,
  agency: 4000,
};

export interface ProfileSections {
  criticalFacts?: string;
  persona?: string;
  goals?: string;
  businessNotes?: string;
  toneRules?: string;
  bookingBehavior?: string;
  escalationBehavior?: string;
  knowledgeScope?: string;
  agency?: string;
}

export interface CompactedSections {
  sections: Record<string, string>;
  truncated: Record<string, boolean>;
  totalChars: number;
  approxTokens: number;
}

function truncateSection(body: string | undefined, cap: number): { text: string; truncated: boolean } {
  const b = (body ?? '').trim();
  if (!b) return { text: '', truncated: false };
  if (b.length <= cap) return { text: b, truncated: false };
  const notice = '\n\n[truncated …]';
  const take = Math.max(0, cap - notice.length);
  return { text: `${b.slice(0, take)}${notice}`, truncated: true };
}

/**
 * Per-section prompt compaction with individual budgets.
 * Only includes non-empty sections. Returns total character and token counts.
 */
export function compactProfileSections(sections: ProfileSections): CompactedSections {
  const result: CompactedSections = {
    sections: {},
    truncated: {},
    totalChars: 0,
    approxTokens: 0,
  };

  for (const [key, cap] of Object.entries(SECTION_CAPS)) {
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

/** Build the full prompt body from compacted sections, with headers. */
export function buildCompactedPromptBody(compacted: CompactedSections): string {
  const labels: Record<string, string> = {
    criticalFacts: '### Critical facts',
    persona: '### Bot Persona',
    goals: '### Goals',
    businessNotes: '### Business notes',
    toneRules: '### Tone rules',
    bookingBehavior: '### Booking behavior',
    escalationBehavior: '### Escalation behavior',
    knowledgeScope: '### Knowledge scope',
    agency: '### Agency instructions',
  };

  const chunks: string[] = [];
  for (const key of Object.keys(SECTION_CAPS)) {
    const text = compacted.sections[key];
    if (text) {
      chunks.push(`${labels[key] ?? key}\n${text}`);
    }
  }
  return chunks.join('\n\n');
}

/** Rough token estimate (~4 chars per token for Latin scripts). */
export function estimateApproxTokens(chars: number): number {
  if (chars <= 0) return 0;
  return Math.ceil(chars / 4);
}
