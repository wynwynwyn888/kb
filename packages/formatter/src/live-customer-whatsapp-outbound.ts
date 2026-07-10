/**
 * Live WhatsApp/SMS outbound shaping — shared with backend `customer-facing-live-format`.
 * Preserves WhatsApp *bold*; normalizes markdown **bold** to single asterisks; keeps bullets.
 */

export function normalizeLiveCustomerMarkdownForWhatsAppOutbound(text: string): string {
  let s = String(text ?? '');

  s = s.replace(/\*\*([\s\S]*?)\*\*/g, (_m, inner: string) => `*${String(inner).trim()}*`);

  s = s.replace(/^#{1,6}\s*(.+)$/gm, '$1');

  s = s.replace(/__(.+?)__/g, '$1');
  s = s.replace(/~~(.+?)~~/g, '$1');
  s = s.replace(/```[\s\S]*?```/g, block => block.replace(/```/g, ''));
  s = s.replace(/`([^`]+)`/g, '$1');

  s = s.replace(/!\[([^\]]*)\]\([^)]+\)/g, '$1');
  s = s.replace(/\[([^\]]+)\]\([^)]+\)/g, '$1');

  s = s.replace(/^\s*[-*+]\s+/gm, '• ');

  return s.trim();
}
