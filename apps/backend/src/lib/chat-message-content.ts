import { INBOUND_IMAGE_PLACEHOLDER_CONTENT } from './inbound-image';

export type ChatContentPart =
  | { type: 'text'; text: string }
  | { type: 'image_url'; image_url: { url: string } };

export type ChatMessageContent = string | ChatContentPart[];

export function buildUserMessageContent(text: string, imageUrl?: string | null): ChatMessageContent {
  const caption = text.trim();
  const url = imageUrl?.trim();
  if (!url) return caption;

  const parts: ChatContentPart[] = [{ type: 'image_url', image_url: { url } }];
  if (caption && caption !== INBOUND_IMAGE_PLACEHOLDER_CONTENT) {
    parts.push({ type: 'text', text: caption });
  } else {
    parts.push({ type: 'text', text: 'The customer sent this image.' });
  }
  return parts;
}
