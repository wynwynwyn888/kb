import {
  classifyGhlImagePlaceholderBody,
  extractGhlInboundImageMediaUrl,
  ghlBodyIndicatesImagePlaceholder,
  stripGhlImagePlaceholderFromInboundBody,
} from './ghl-inbound-image-media';

describe('ghl-inbound-image-media', () => {
  it('extracts URL from attachments with image content type', () => {
    const url = extractGhlInboundImageMediaUrl({
      attachments: [{ url: 'https://cdn.example.com/photo.jpg', contentType: 'image/jpeg' }],
    });
    expect(url).toBe('https://cdn.example.com/photo.jpg');
  });

  it('extracts URL from nested message attachments via workflow flat', () => {
    const url = extractGhlInboundImageMediaUrl(
      {},
      {
        workflowFlatRaw: {
          customData: {
            attachments: [{ mediaUrl: 'https://cdn.example.com/nested.png', type: 'image' }],
          },
        },
      },
    );
    expect(url).toBe('https://cdn.example.com/nested.png');
  });

  it('ignores audio attachments', () => {
    const url = extractGhlInboundImageMediaUrl({
      attachments: [{ url: 'https://cdn.example.com/voice.m4a', contentType: 'audio/mp4' }],
    });
    expect(url).toBeNull();
  });

  it('detects GHL >IMAGE< placeholder in body', () => {
    expect(classifyGhlImagePlaceholderBody('>IMAGE<')).toBe('IMAGE');
    expect(ghlBodyIndicatesImagePlaceholder('>IMAGE<\ni sell this')).toBe(true);
  });

  it('strips >IMAGE< line and keeps caption', () => {
    expect(stripGhlImagePlaceholderFromInboundBody('>IMAGE<\ni sell this. can u help me?')).toBe(
      'i sell this. can u help me?',
    );
  });

  it('relaxed extraction when >IMAGE< placeholder and attachment lacks image mime', () => {
    const url = extractGhlInboundImageMediaUrl(
      {
        attachments: [{ url: 'https://cdn.example.com/ghl-upload-abc', type: 'file' }],
      },
      { messageBody: '>IMAGE<\ncaption' },
    );
    expect(url).toBe('https://cdn.example.com/ghl-upload-abc');
  });
});
