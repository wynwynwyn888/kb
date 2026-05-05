import { classifyConversationIntent } from './conversation-intent';

describe('classifyConversationIntent', () => {
  it('classifies greetings and hours vs menu', () => {
    expect(classifyConversationIntent('hi')).toBe('GREETING');
    expect(classifyConversationIntent('ur opening hour?')).toBe('BUSINESS_HOURS');
    expect(classifyConversationIntent('your menu')).toBe('MENU');
  });

  it('classifies short selections including first one', () => {
    expect(classifyConversationIntent('A')).toBe('SHORT_SELECTION');
    expect(classifyConversationIntent('F')).toBe('SHORT_SELECTION');
    expect(classifyConversationIntent('f')).toBe('SHORT_SELECTION');
    expect(classifyConversationIntent('H')).toBe('SHORT_SELECTION');
    expect(classifyConversationIntent('6')).toBe('SHORT_SELECTION');
    expect(classifyConversationIntent('first one')).toBe('SHORT_SELECTION');
    expect(classifyConversationIntent('option B')).toBe('SHORT_SELECTION');
  });

  it('does not treat hours question as short selection', () => {
    expect(classifyConversationIntent('what time you open')).toBe('BUSINESS_HOURS');
  });
});
