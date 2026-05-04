import { describe, expect, it } from '@jest/globals';
import {
  KNOWLEDGE_SCOPE_ALL_WORKSPACE,
  buildBookingNluProfileAppendix,
  buildBookingReplyPersonaPrompt,
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

  it('buildOrchestrationTenantPromptFromProfile includes persona blocks and extras', () => {
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
      knowledgeScopeMode: KNOWLEDGE_SCOPE_ALL_WORKSPACE,
    });
    expect(out).toContain('### Assistant profile');
    expect(out).toContain('Celeste');
    expect(out).toContain('Knowledge scope: All workspace knowledge');
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
      knowledgeScopeMode: KNOWLEDGE_SCOPE_ALL_WORKSPACE,
    });
    expect(s).toContain('Knowledge scope: All workspace knowledge');
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
      knowledgeScopeMode: KNOWLEDGE_SCOPE_ALL_WORKSPACE,
    });
    expect(s).toContain('Knowledge scope: All workspace knowledge');
    expect(s).toContain('P');
    expect(s).toContain('Tone rules: T');
  });
});
