import type { RetrievalChunk } from '../modules/kb/dto/retrieval.dto';
import {
  filterKbChunksForLatestUserMessage,
  classifyQueryForKbLog,
} from './kb-relevance';

function chunk(partial: Partial<RetrievalChunk> & Pick<RetrievalChunk, 'title' | 'content'>): RetrievalChunk {
  return {
    chunkId: 'c1',
    documentId: 'd1',
    title: partial.title,
    content: partial.content,
    source: partial.source ?? 'faq',
    relevanceScore: partial.relevanceScore ?? 0.5,
    metadata: partial.metadata ?? {},
  };
}

describe('filterKbChunksForLatestUserMessage', () => {
  const hoursFaq = chunk({
    title: 'FAQ: What are your opening hours?',
    content: 'Weekdays 9am-11pm\nWeekends 9am-12am',
    metadata: { question: 'What are your opening hours?' },
  });

  const menuFaq = chunk({
    title: 'FAQ: Do you have a vegan menu?',
    content: 'Yes, we offer vegan starters, mains, and desserts.',
    metadata: { question: 'Do you have a vegan menu?' },
  });

  it('keeps hours FAQ for opening-hours style questions', () => {
    const { chunks, rejections } = filterKbChunksForLatestUserMessage('what time are you open', [
      hoursFaq,
    ]);
    expect(chunks.length).toBe(1);
    expect(rejections.length).toBe(0);
  });

  it('rejects hours FAQ when latest message is menu-only', () => {
    const { chunks, rejections } = filterKbChunksForLatestUserMessage('your menu', [hoursFaq]);
    expect(chunks.length).toBe(0);
    expect(rejections[0]?.reason).toBe('intent_mismatch_menu_vs_hours_kb');
    expect(classifyQueryForKbLog('your menu')).toBe('menu');
  });

  it('keeps menu FAQ for menu questions when both exist', () => {
    const { chunks } = filterKbChunksForLatestUserMessage('your menu please', [hoursFaq, menuFaq]);
    expect(chunks.map(c => c.title)).toContain('FAQ: Do you have a vegan menu?');
    expect(chunks.map(c => c.title)).not.toContain('FAQ: What are your opening hours?');
  });

  it('does not use hours answer when user asks menu even if hours ranked first', () => {
    const { chunks } = filterKbChunksForLatestUserMessage('i mean your menu?', [hoursFaq, menuFaq]);
    expect(chunks.find(c => c.title.includes('opening'))).toBeUndefined();
    expect(chunks.some(c => c.title.includes('vegan'))).toBe(true);
  });
});

describe('classifyQueryForKbLog', () => {
  it('classifies menu vs hours', () => {
    expect(classifyQueryForKbLog('ur menu')).toBe('menu');
    expect(classifyQueryForKbLog('opening hours')).toBe('hours');
  });
});
