import { REPLY_LANGUAGE_MIRROR_SYSTEM_CONTENT } from './reply-language-mirror';

describe('reply-language-mirror', () => {
  it('requires mirroring the customer latest-message language', () => {
    expect(REPLY_LANGUAGE_MIRROR_SYSTEM_CONTENT).toMatch(/same language/i);
    expect(REPLY_LANGUAGE_MIRROR_SYSTEM_CONTENT).toMatch(/Do NOT default to English/i);
    expect(REPLY_LANGUAGE_MIRROR_SYSTEM_CONTENT).toMatch(/voice-note transcripts/i);
  });
});
