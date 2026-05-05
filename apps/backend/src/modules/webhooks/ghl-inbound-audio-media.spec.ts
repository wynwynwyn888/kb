import {
  extractGhlInboundAudioMediaUrl,
  ghlAttachmentsHintAudio,
  ghlInboundShouldTranscribeVoice,
} from './ghl-inbound-audio-media';

describe('ghl-inbound-audio-media', () => {
  it('extracts URL from attachments[].url', () => {
    const url = extractGhlInboundAudioMediaUrl({
      attachments: [{ url: 'https://cdn.example.com/voice/msg.m4a', contentType: 'audio/mp4' }],
    });
    expect(url).toBe('https://cdn.example.com/voice/msg.m4a');
  });

  it('extracts URL from media object', () => {
    const url = extractGhlInboundAudioMediaUrl({
      media: { url: 'https://storage.example.com/a.ogg' },
    });
    expect(url).toBe('https://storage.example.com/a.ogg');
  });

  it('extracts URL from message when body is a direct media link', () => {
    const url = extractGhlInboundAudioMediaUrl({
      message: 'https://files.example.com/upload.mp3',
    });
    expect(url).toBe('https://files.example.com/upload.mp3');
  });

  it('detects voice path: empty body + attachment + unknown type', () => {
    const raw = {
      attachments: [{ url: 'https://cdn.example.com/x.m4a', type: 'audio' }],
    };
    const mediaUrl = extractGhlInboundAudioMediaUrl(raw as Record<string, unknown>)!;
    expect(
      ghlInboundShouldTranscribeVoice({
        messageType: 'unknown',
        messageContent: '',
        audioMediaUrl: mediaUrl,
        rawData: raw as Record<string, unknown>,
      }),
    ).toBe(true);
  });

  it('does not transcribe normal text', () => {
    expect(
      ghlInboundShouldTranscribeVoice({
        messageType: 'text',
        messageContent: 'Hello there',
        audioMediaUrl: null,
        rawData: {},
      }),
    ).toBe(false);
  });

  it('attachmentsHintAudio detects mime', () => {
    expect(
      ghlAttachmentsHintAudio({
        attachments: [{ url: 'https://x.com/f', contentType: 'audio/webm' }],
      } as Record<string, unknown>),
    ).toBe(true);
  });
});
