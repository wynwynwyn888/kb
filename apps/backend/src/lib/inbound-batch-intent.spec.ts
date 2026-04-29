import { summarizeInboundTextBatch } from './inbound-batch-intent';

describe('inbound-batch-intent', () => {
  it('oily scalp + neck massage: two lines combined with distinct intents surface in summary', () => {
    const s = summarizeInboundTextBatch([
      'i have oily scalp and buildup',
      'can i book neck massage?',
    ]);
    expect(s.orderedMessages).toHaveLength(2);
    expect(s.combinedText).toContain('oily scalp');
    expect(s.combinedText).toContain('neck massage');
    expect(s.intentsPerMessage.length).toBe(2);
    expect(s.answerableIntentCount).toBe(2);
  });

  it('location + hours: both lines preserved in combinedText', () => {
    const s = summarizeInboundTextBatch(['what time are you open?', 'where are you located?']);
    expect(s.combinedText).toMatch(/open\?\n\nwhere/i);
    expect(s.primaryIntent === 'BUSINESS_HOURS' || s.primaryIntent === 'LOCATION').toBe(true);
  });

  it('colour + damaged + low maintenance stays one combined customer turn', () => {
    const s = summarizeInboundTextBatch([
      'i want colour',
      'but my hair is damaged',
      'and i want low maintenance',
    ]);
    expect(s.orderedMessages).toHaveLength(3);
    expect(s.combinedText.split('\n\n')).toHaveLength(3);
  });

  it('menu + short selection in same batch preserves both lines and intents', () => {
    const s = summarizeInboundTextBatch(['menu pls', 'A']);
    expect(s.orderedMessages).toEqual(['menu pls', 'A']);
    expect(s.intentsPerMessage).toEqual(['MENU', 'SHORT_SELECTION']);
  });
});
