import { shouldSkipKbShortFollowUpActiveTopic } from './short-followup-kb';
import type { ConversationIntent } from '../modules/conversation-policy/conversation-intent';

describe('short-followup-kb', () => {
  const base = {
    activeTopic: 'menu' as const,
    menuSelectionAnchorActive: false,
  };

  it('skips when short UNKNOWN with activeTopic', () => {
    expect(
      shouldSkipKbShortFollowUpActiveTopic({
        ...base,
        latestMessageTrimmed: 'How long?',
        latestIntent: 'UNKNOWN' as ConversationIntent,
      }),
    ).toBe(true);
  });

  it('never skips PRICE', () => {
    expect(
      shouldSkipKbShortFollowUpActiveTopic({
        ...base,
        latestMessageTrimmed: 'Price?',
        latestIntent: 'PRICE',
      }),
    ).toBe(false);
  });

  it('never skips SHORT_SELECTION', () => {
    expect(
      shouldSkipKbShortFollowUpActiveTopic({
        ...base,
        latestMessageTrimmed: 'B',
        latestIntent: 'SHORT_SELECTION',
      }),
    ).toBe(false);
  });

  it('never skips when menu anchor active', () => {
    expect(
      shouldSkipKbShortFollowUpActiveTopic({
        ...base,
        latestMessageTrimmed: 'Haircut styling',
        latestIntent: 'UNKNOWN' as ConversationIntent,
        menuSelectionAnchorActive: true,
      }),
    ).toBe(false);
  });

  it('never skips without activeTopic', () => {
    expect(
      shouldSkipKbShortFollowUpActiveTopic({
        ...base,
        activeTopic: null,
        latestMessageTrimmed: 'How long?',
        latestIntent: 'UNKNOWN' as ConversationIntent,
      }),
    ).toBe(false);
  });
});
