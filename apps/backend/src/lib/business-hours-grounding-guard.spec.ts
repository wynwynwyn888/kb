import { applyBusinessHoursGroundingGuard } from './business-hours-grounding-guard';
import type { RetrievalChunk } from '../modules/kb/dto/retrieval.dto';

const hoursChunk: RetrievalChunk = {
  chunkId: 'h1',
  documentId: 'd1',
  title: 'Opening hours',
  content: 'Weekdays 9am-11pm\nWeekends 9am-12am',
  source: 'faq',
  relevanceScore: 0.95,
  metadata: {},
};

describe('business-hours-grounding-guard', () => {
  it('strips lunch/dinner claims when user only asked opening time and KB is generic hours', () => {
    const draft =
      'We are open for lunch from noon and dinner from 5pm. Weekdays we open at 9am and close at 11pm.';
    const out = applyBusinessHoursGroundingGuard({
      latestIntent: 'BUSINESS_HOURS',
      userMessage: 'what time you open',
      kbChunks: [hoursChunk],
      draftText: draft,
    });
    expect(out.toLowerCase()).not.toContain('lunch');
    expect(out.toLowerCase()).not.toContain('dinner');
    expect(out.toLowerCase()).toMatch(/9|open|weekday/i);
  });

  it('keeps lunch mention when user asked about lunch', () => {
    const draft = 'Lunch runs noon–3pm; we open at 9am weekdays.';
    const out = applyBusinessHoursGroundingGuard({
      latestIntent: 'BUSINESS_HOURS',
      userMessage: 'what time is lunch',
      kbChunks: [hoursChunk],
      draftText: draft,
    });
    expect(out).toBe(draft);
  });
});
