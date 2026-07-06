import { describe, expect, it } from '@jest/globals';
import {
  KNOWLEDGE_ACCESS_ALL_VAULTS,
  KNOWLEDGE_ACCESS_SELECTED_VAULTS,
  buildBookingNluProfileAppendix,
  buildBookingReplyPersonaPrompt,
  buildKnowledgeAccessSummaryLine,
  buildOrchestrationTenantPromptFromProfile,
  buildTenantPromptFingerprint,
  buildThreeSectionPromptBlob,
  parsePromptSections,
} from './tenant-bot-profile-prompt';

describe('tenant-bot-profile-prompt', () => {
  it('parsePromptSections splits AISBP headers', () => {
    const raw = ['### Bot Persona', 'Hi', '', '### Goals', 'Do X', '', '### Additional information', 'Note'].join('\n');
    const p = parsePromptSections(raw);
    expect(p.persona).toBe('Hi');
    expect(p.goals).toBe('Do X');
    expect(p.additional).toBe('Note');
  });

  it('buildKnowledgeAccessSummaryLine formats all vaults', () => {
    expect(buildKnowledgeAccessSummaryLine(KNOWLEDGE_ACCESS_ALL_VAULTS, [])).toContain('All knowledge vaults');
  });

  it('buildKnowledgeAccessSummaryLine formats selected vault names', () => {
    const s = buildKnowledgeAccessSummaryLine(KNOWLEDGE_ACCESS_SELECTED_VAULTS, ['A', 'B']);
    expect(s).toContain('Selected vaults');
    expect(s).toContain('A');
    expect(s).toContain('B');
  });

  it('buildOrchestrationTenantPromptFromProfile includes knowledge access summary', () => {
    const out = buildOrchestrationTenantPromptFromProfile({
      name: 'Celeste',
      description: 'Salon front desk',
      persona: 'Warm',
      conversationGoals: 'Book',
      businessNotes: 'Hours 9-5',
      toneRules: 'No slang',
      bookingBehaviorNotes: 'Confirm slot',
      escalationBehaviorNotes: 'Hand to human if angry',
      knowledgeScopeNotes: 'Only services on menu',
      knowledgeAccessSummary: buildKnowledgeAccessSummaryLine(KNOWLEDGE_ACCESS_ALL_VAULTS, []),
    });
    expect(out).toContain('### Assistant profile');
    expect(out).toContain('Celeste');
    expect(out).toContain('Knowledge access:');
    expect(out).toContain('### Bot Persona');
    expect(out).toContain('Warm');
    expect(out).toContain('### Tone rules');
    expect(out).toContain('No slang');
    expect(out).toContain('### Booking behavior');
  });

  it('buildThreeSectionPromptBlob is stable for legacy storage', () => {
    const b = buildThreeSectionPromptBlob('a', 'b', 'c');
    const p = parsePromptSections(b);
    expect(p.persona).toBe('a');
    expect(p.goals).toBe('b');
    expect(p.additional).toBe('c');
  });

  it('buildBookingNluProfileAppendix is compact', () => {
    const s = buildBookingNluProfileAppendix({
      name: 'X',
      description: 'D',
      persona: '',
      conversationGoals: '',
      businessNotes: '',
      toneRules: 'T',
      bookingBehaviorNotes: 'B',
      escalationBehaviorNotes: '',
      knowledgeScopeNotes: 'K',
      knowledgeAccessSummary: buildKnowledgeAccessSummaryLine(KNOWLEDGE_ACCESS_ALL_VAULTS, []),
    });
    expect(s).toContain('Knowledge access:');
    expect(s).toContain('Business context: D');
    expect(s).toContain('Tone: T');
  });

  it('buildBookingReplyPersonaPrompt combines persona and tone', () => {
    const s = buildBookingReplyPersonaPrompt({
      name: 'Y',
      description: '',
      persona: 'P',
      conversationGoals: '',
      businessNotes: '',
      toneRules: 'T',
      bookingBehaviorNotes: 'BB',
      escalationBehaviorNotes: '',
      knowledgeScopeNotes: '',
      knowledgeAccessSummary: buildKnowledgeAccessSummaryLine(KNOWLEDGE_ACCESS_ALL_VAULTS, []),
    });
    expect(s).toContain('P');
    expect(s).toContain('Tone rules: T');
  });

  it('Critical Facts IS present in buildOrchestrationTenantPromptFromProfile output (parity fix)', () => {
    const out = buildOrchestrationTenantPromptFromProfile({
      name: 'Test',
      description: '',
      persona: 'Friendly',
      conversationGoals: 'Sell',
      businessNotes: 'Notes',
      toneRules: '',
      bookingBehaviorNotes: '',
      escalationBehaviorNotes: '',
      knowledgeScopeNotes: '',
      criticalFacts: 'Prices: $50-200. Guarantee: 30 days.',
      knowledgeAccessSummary: buildKnowledgeAccessSummaryLine(KNOWLEDGE_ACCESS_ALL_VAULTS, []),
    });
    // Critical Facts must now be delivered on the shared (non-section-budget) path too, so that
    // Preview Bot and the live WhatsApp legacy path both include the tenant's locked facts.
    expect(out).toContain('### Critical facts');
    expect(out).toContain('Prices: $50-200');
    expect(out).toContain('### Bot Persona');
    // Critical facts should appear before the persona/goals blob so it survives downstream compaction.
    expect(out.indexOf('### Critical facts')).toBeLessThan(out.indexOf('### Bot Persona'));
  });

  it('omits Critical facts section when criticalFacts is empty', () => {
    const out = buildOrchestrationTenantPromptFromProfile({
      name: 'Test',
      description: '',
      persona: 'Friendly',
      conversationGoals: 'Sell',
      businessNotes: 'Notes',
      toneRules: '',
      bookingBehaviorNotes: '',
      escalationBehaviorNotes: '',
      knowledgeScopeNotes: '',
      criticalFacts: '',
      knowledgeAccessSummary: buildKnowledgeAccessSummaryLine(KNOWLEDGE_ACCESS_ALL_VAULTS, []),
    });
    expect(out).not.toContain('### Critical facts');
    expect(out).toContain('### Bot Persona');
  });

  it('criticalFacts field is included in BotProfilePromptFields (type check)', () => {
    const fields = {
      name: 'Test', description: '', persona: '', conversationGoals: '', businessNotes: '',
      toneRules: '', bookingBehaviorNotes: '', escalationBehaviorNotes: '', knowledgeScopeNotes: '',
      criticalFacts: 'Test facts',
      knowledgeAccessSummary: buildKnowledgeAccessSummaryLine(KNOWLEDGE_ACCESS_ALL_VAULTS, []),
    };
    const out = buildOrchestrationTenantPromptFromProfile(fields);
    expect(typeof out).toBe('string');
    expect(out).toContain('Test facts');
  });

  describe('buildTenantPromptFingerprint (Preview ↔ WhatsApp parity)', () => {
    const aisbpSections = {
      criticalFacts:
        'First message menu:\n1) Leads going cold\n2) Staff too busy\n3) Prospects ask price\n7) Something else',
      persona: 'Direct AISBP setter',
      goals: 'Route to AI Automation Session',
      businessNotes: 'B2B automation agency',
      toneRules: 'Never say "How can I assist you?"',
      bookingBehavior: 'Book the session',
      escalationBehavior: 'Escalate on request',
      knowledgeScope: 'AISBP vault only',
    };

    it('produces the same hash for the same profile fields regardless of channel', () => {
      // Preview and WhatsApp both fingerprint the identical profileSections object shape.
      const preview = buildTenantPromptFingerprint({ ...aisbpSections });
      const whatsapp = buildTenantPromptFingerprint({ ...aisbpSections });
      expect(whatsapp.hash).toBe(preview.hash);
      expect(whatsapp.includesCriticalFacts).toBe(true);
      expect(whatsapp.includesGoals).toBe(true);
    });

    it('changes hash when any tenant field changes (drift detection)', () => {
      const base = buildTenantPromptFingerprint({ ...aisbpSections });
      const changed = buildTenantPromptFingerprint({ ...aisbpSections, goals: 'Different goal' });
      expect(changed.hash).not.toBe(base.hash);
    });

    it('flags missing Critical Facts / Goals and never leaks content', () => {
      const fp = buildTenantPromptFingerprint({ persona: 'x' });
      expect(fp.includesCriticalFacts).toBe(false);
      expect(fp.includesGoals).toBe(false);
      // Only lengths + hash are exposed — no raw content fields.
      expect(Object.keys(fp)).toEqual(
        expect.arrayContaining(['hash', 'fieldLengths', 'includesCriticalFacts', 'includesGoals', 'totalChars']),
      );
      expect(JSON.stringify(fp)).not.toContain('x');
    });

    it('treats null/undefined sections as an empty, stable fingerprint', () => {
      expect(buildTenantPromptFingerprint(null).hash).toBe(buildTenantPromptFingerprint(undefined).hash);
      expect(buildTenantPromptFingerprint(null).includesCriticalFacts).toBe(false);
    });
  });
});
