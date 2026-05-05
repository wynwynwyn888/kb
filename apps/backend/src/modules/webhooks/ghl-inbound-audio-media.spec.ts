import {
  collectGhlInboundMediaRootNodes,
  extractGhlInboundAudioMediaUrl,
  extractGhlInboundMessageBodyString,
  ghlAttachmentsHintAudio,
  ghlBodyIndicatesAudioPlaceholder,
  ghlInboundShouldTranscribeVoice,
  urlFilenameHintsAudio,
  VOICE_INBOUND_PLACEHOLDER_NO_MEDIA_USER_MESSAGE,
} from './ghl-inbound-audio-media';

describe('ghl-inbound-audio-media', () => {
  describe('extractGhlInboundAudioMediaUrl', () => {
    it('extracts URL from attachments[].url', () => {
      const url = extractGhlInboundAudioMediaUrl({
        attachments: [{ url: 'https://cdn.example.com/voice/msg.m4a', contentType: 'audio/mp4' }],
      });
      expect(url).toBe('https://cdn.example.com/voice/msg.m4a');
    });

    it('extracts from data.attachments nested shape', () => {
      const url = extractGhlInboundAudioMediaUrl({
        data: {
          attachments: [{ downloadUrl: 'https://cdn.example.com/nested.ogg' }],
        },
      } as Record<string, unknown>);
      expect(url).toBe('https://cdn.example.com/nested.ogg');
    });

    it('extracts from messages[0].attachments on inner data', () => {
      const url = extractGhlInboundAudioMediaUrl({
        messages: [
          {
            attachments: [{ mediaUrl: 'https://cdn.example.com/from-messages.m4a' }],
          },
        ],
      } as Record<string, unknown>);
      expect(url).toBe('https://cdn.example.com/from-messages.m4a');
    });

    it('extracts from message.media with fileUrl', () => {
      const url = extractGhlInboundAudioMediaUrl({
        message: {
          text: 'hi',
          media: { fileUrl: 'https://storage.example.com/voice-note.webm' },
        },
      } as Record<string, unknown>);
      expect(url).toBe('https://storage.example.com/voice-note.webm');
    });

    it('extracts from envelope.messages[0].attachments when passed envelope', () => {
      const data = { conversationId: 'c1', message: '' } as Record<string, unknown>;
      const envelope = {
        messages: [{ attachments: [{ url: 'https://cdn.example.com/env-msg0.mp3' }] }],
      } as Record<string, unknown>;
      const url = extractGhlInboundAudioMediaUrl(data, { envelope });
      expect(url).toBe('https://cdn.example.com/env-msg0.mp3');
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

    it('prefers nested message attachment over empty root', () => {
      const url = extractGhlInboundAudioMediaUrl({
        message: {
          attachments: [{ url: 'https://cdn.example.com/priority.m4a' }],
        },
      } as Record<string, unknown>);
      expect(url).toBe('https://cdn.example.com/priority.m4a');
    });
  });

  describe('extractGhlInboundMessageBodyString', () => {
    it('reads text from message object', () => {
      expect(
        extractGhlInboundMessageBodyString({
          message: { text: 'Voice message' },
        } as Record<string, unknown>),
      ).toBe('Voice message');
    });
  });

  describe('ghlBodyIndicatesAudioPlaceholder', () => {
    it('detects GHL unsupported copy', () => {
      expect(ghlBodyIndicatesAudioPlaceholder('This Message type is not supported')).toBe(true);
    });

    it('detects generic audio placeholder', () => {
      expect(ghlBodyIndicatesAudioPlaceholder('audio message')).toBe(true);
      expect(ghlBodyIndicatesAudioPlaceholder('Unsupported message from WhatsApp')).toBe(true);
    });

    it('returns false for normal text', () => {
      expect(ghlBodyIndicatesAudioPlaceholder('Book a table')).toBe(false);
    });
  });

  describe('ghlInboundShouldTranscribeVoice', () => {
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

    it('transcribes when placeholder body and audio URL exist', () => {
      expect(
        ghlInboundShouldTranscribeVoice({
          messageType: 'text',
          messageContent: 'This Message type is not supported',
          audioMediaUrl: 'https://cdn.example.com/a.ogg',
          rawData: {},
        }),
      ).toBe(true);
    });

    it('transcribes for VoiceMessage / voice mapped as audio upstream', () => {
      expect(
        ghlInboundShouldTranscribeVoice({
          messageType: 'audio',
          messageContent: '',
          audioMediaUrl: null,
          rawData: {},
        }),
      ).toBe(true);
    });

    it('triggers on audio/ mime even with caption body', () => {
      const raw = {
        attachments: [{ url: 'https://cdn.example.com/x.bin', contentType: 'audio/webm' }],
      };
      expect(
        ghlInboundShouldTranscribeVoice({
          messageType: 'text',
          messageContent: 'caption here',
          audioMediaUrl: 'https://cdn.example.com/x.bin',
          rawData: raw as Record<string, unknown>,
        }),
      ).toBe(true);
    });

    it('triggers on .oga filename in attachment name', () => {
      const raw = {
        attachments: [{ url: 'https://cdn.example.com/x', filename: 'note.oga' }],
      };
      expect(
        ghlInboundShouldTranscribeVoice({
          messageType: 'unknown',
          messageContent: '',
          audioMediaUrl: 'https://cdn.example.com/x',
          rawData: raw as Record<string, unknown>,
        }),
      ).toBe(true);
    });

    it('does not transcribe random https with non-audio URL and non-empty non-placeholder body', () => {
      expect(
        ghlInboundShouldTranscribeVoice({
          messageType: 'text',
          messageContent: 'see https://example.com',
          audioMediaUrl: 'https://example.com/page',
          rawData: {},
        }),
      ).toBe(false);
    });
  });

  describe('ghlAttachmentsHintAudio', () => {
    it('detects mime', () => {
      expect(
        ghlAttachmentsHintAudio({
          attachments: [{ url: 'https://x.com/f', contentType: 'audio/webm' }],
        } as Record<string, unknown>),
      ).toBe(true);
    });
  });

  describe('urlFilenameHintsAudio', () => {
    it('detects .oga in URL', () => {
      expect(urlFilenameHintsAudio('https://cdn.example.com/v.oga?sig=1')).toBe(true);
    });
  });

  describe('collectGhlInboundMediaRootNodes', () => {
    it('returns unique ordered nodes', () => {
      const data = { message: { attachments: [] }, data: {} } as Record<string, unknown>;
      const nodes = collectGhlInboundMediaRootNodes(data);
      expect(nodes.length).toBeGreaterThan(0);
    });
  });

  describe('VOICE_INBOUND_PLACEHOLDER_NO_MEDIA_USER_MESSAGE', () => {
    it('is a non-empty customer-safe string', () => {
      expect(VOICE_INBOUND_PLACEHOLDER_NO_MEDIA_USER_MESSAGE.length).toBeGreaterThan(20);
    });
  });
});
