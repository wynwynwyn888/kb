import { describe, expect, it } from '@jest/globals';
import {
  KNOWLEDGE_ACCESS_ALL_VAULTS,
  KNOWLEDGE_ACCESS_SELECTED_VAULTS,
  buildBookingNluProfileAppendix,
  buildBookingReplyPersonaPrompt,
  buildKnowledgeAccessSummaryLine,
  buildOrchestrationTenantPromptFromProfile,
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

  it('Critical Facts NOT present in old buildOrchestrationTenantPromptFromProfile output', () => {
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
    // Old path should NOT contain critical facts
    expect(out).not.toContain('Prices: $50-200');
    expect(out).not.toContain('Critical facts');
    expect(out).toContain('### Bot Persona');
  });

  it('criticalFacts field is included in BotProfilePromptFields (type check)', () => {
    const fields = {
      name: 'Test', description: '', persona: '', conversationGoals: '', businessNotes: '',
      toneRules: '', bookingBehaviorNotes: '', escalationBehaviorNotes: '', knowledgeScopeNotes: '',
      criticalFacts: 'Test facts',
      knowledgeAccessSummary: buildKnowledgeAccessSummaryLine(KNOWLEDGE_ACCESS_ALL_VAULTS, []),
    };
    // Just verifies the field is accepted — old path doesn't use it
    const out = buildOrchestrationTenantPromptFromProfile(fields);
    expect(typeof out).toBe('string');
  });
});
