/** Stored message content when GHL sends an image without a caption. */
export const INBOUND_IMAGE_PLACEHOLDER_CONTENT = '[Photo]';

export function isInboundImagePlaceholderContent(text: string | null | undefined): boolean {
  return (text ?? '').trim() === INBOUND_IMAGE_PLACEHOLDER_CONTENT;
}
