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
    expect(classifyConversationIntent('first')).toBe('SHORT_SELECTION');
    expect(classifyConversationIntent('first one')).toBe('SHORT_SELECTION');
    expect(classifyConversationIntent('the last option')).toBe('SHORT_SELECTION');
    expect(classifyConversationIntent('option B')).toBe('SHORT_SELECTION');
  });

  it('does not treat hours question as short selection', () => {
    expect(classifyConversationIntent('what time you open')).toBe('BUSINESS_HOURS');
  });

  it('does not classify deferrals containing "first" as short selections', () => {
    expect(classifyConversationIntent('I need to think about it first.')).toBe('UNKNOWN');
    expect(classifyConversationIntent('Let me check with my partner first')).toBe('UNKNOWN');
  });

  it('does not classify HUMAN_HANDOVER for "human" used as a service/species context', () => {
    expect(classifyConversationIntent('is it safe for humans?')).not.toBe('HUMAN_HANDOVER');
    expect(classifyConversationIntent('is this intended for humans?')).not.toBe('HUMAN_HANDOVER');
  });

  it('classifies MENU for generic offering browse phrases', () => {
    expect(classifyConversationIntent('menu pls')).toBe('MENU');
    expect(classifyConversationIntent('what products are available?')).toBe('MENU');
    expect(classifyConversationIntent('what service do you have')).toBe('MENU');
  });

  it('classifies HUMAN_HANDOVER for direct talk/speak/connect phrasing', () => {
    expect(classifyConversationIntent('talk to human')).toBe('HUMAN_HANDOVER');
    expect(classifyConversationIntent('speak to staff')).toBe('HUMAN_HANDOVER');
    expect(classifyConversationIntent('can I talk to human')).toBe('HUMAN_HANDOVER');
    expect(classifyConversationIntent('can i talk to human pls')).toBe('HUMAN_HANDOVER');
    expect(classifyConversationIntent('ok, can i request human')).toBe('HUMAN_HANDOVER');
    expect(classifyConversationIntent('i need a human')).toBe('HUMAN_HANDOVER');
    expect(classifyConversationIntent('want manager')).toBe('HUMAN_HANDOVER');
    expect(classifyConversationIntent('connect me to team')).toBe('HUMAN_HANDOVER');
    expect(classifyConversationIntent('get someone to contact me')).toBe('HUMAN_HANDOVER');
  });

  it('classifies HUMAN_HANDOVER only when contact/connect intent is present', () => {
    expect(classifyConversationIntent('can I speak to human?')).toBe('HUMAN_HANDOVER');
    expect(classifyConversationIntent('human agent please')).toBe('HUMAN_HANDOVER');
    expect(classifyConversationIntent('connect me to someone')).toBe('HUMAN_HANDOVER');
    expect(classifyConversationIntent('manager please')).toBe('HUMAN_HANDOVER');
  });
});
