import {
  REPLY_LANGUAGE_MIRROR_SYSTEM_CONTENT,
  SINGAPORE_ALLOWED_REPLY_LANGUAGES,
} from './reply-language-mirror';

describe('reply-language-mirror', () => {
  it('lists only Singapore-relevant languages', () => {
    expect(SINGAPORE_ALLOWED_REPLY_LANGUAGES).toEqual([
      'English',
      'Bahasa Malaysia (Malay)',
      'Mandarin Chinese',
      'Tamil',
    ]);
  });

  it('requires mirroring within the Singapore language whitelist', () => {
    expect(REPLY_LANGUAGE_MIRROR_SYSTEM_CONTENT).toMatch(/English, Bahasa Malaysia/i);
    expect(REPLY_LANGUAGE_MIRROR_SYSTEM_CONTENT).toMatch(/Mandarin Chinese/i);
    expect(REPLY_LANGUAGE_MIRROR_SYSTEM_CONTENT).toMatch(/Tamil/i);
    expect(REPLY_LANGUAGE_MIRROR_SYSTEM_CONTENT).toMatch(/No Portuguese/i);
    expect(REPLY_LANGUAGE_MIRROR_SYSTEM_CONTENT).toMatch(/voice-note transcripts/i);
  });
});
