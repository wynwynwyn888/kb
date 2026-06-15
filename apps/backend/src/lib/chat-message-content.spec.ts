import { buildUserMessageContent } from './chat-message-content';
import { INBOUND_IMAGE_PLACEHOLDER_CONTENT } from './inbound-image';

describe('chat-message-content', () => {
  it('builds multimodal user content when image URL is present', () => {
    const content = buildUserMessageContent('What is this?', 'https://cdn.example.com/a.jpg');
    expect(content).toEqual([
      { type: 'image_url', image_url: { url: 'https://cdn.example.com/a.jpg' } },
      { type: 'text', text: 'What is this?' },
    ]);
  });

  it('uses default caption when only photo placeholder text is present', () => {
    const content = buildUserMessageContent(
      INBOUND_IMAGE_PLACEHOLDER_CONTENT,
      'https://cdn.example.com/a.jpg',
    );
    expect(content).toEqual([
      { type: 'image_url', image_url: { url: 'https://cdn.example.com/a.jpg' } },
      { type: 'text', text: 'The customer sent this image.' },
    ]);
  });
});
