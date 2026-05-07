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

  it('does not classify HUMAN_HANDOVER for "human" used as a service/species context', () => {
    expect(classifyConversationIntent('do you do facial for human?')).not.toBe('HUMAN_HANDOVER');
    expect(classifyConversationIntent('is it safe for humans?')).not.toBe('HUMAN_HANDOVER');
    expect(classifyConversationIntent('human facial service')).not.toBe('HUMAN_HANDOVER');
    expect(classifyConversationIntent('human shampoo')).not.toBe('HUMAN_HANDOVER');
  });

  it('classifies HUMAN_HANDOVER only when contact/connect intent is present', () => {
    expect(classifyConversationIntent('can I speak to human?')).toBe('HUMAN_HANDOVER');
    expect(classifyConversationIntent('human agent please')).toBe('HUMAN_HANDOVER');
    expect(classifyConversationIntent('connect me to someone')).toBe('HUMAN_HANDOVER');
    expect(classifyConversationIntent('manager please')).toBe('HUMAN_HANDOVER');
  });
});
