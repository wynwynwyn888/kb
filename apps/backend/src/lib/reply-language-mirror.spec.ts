import { REPLY_LANGUAGE_MIRROR_SYSTEM_CONTENT } from './reply-language-mirror';

describe('reply-language-mirror', () => {
  it('mirrors any customer language without a country-specific allowlist', () => {
    expect(REPLY_LANGUAGE_MIRROR_SYSTEM_CONTENT).toMatch(/Match the language of the customer/i);
    expect(REPLY_LANGUAGE_MIRROR_SYSTEM_CONTENT).toMatch(/voice-note transcripts/i);
    expect(REPLY_LANGUAGE_MIRROR_SYSTEM_CONTENT).not.toMatch(/Singapore|No Portuguese|Bahasa Malaysia/i);
  });
});
