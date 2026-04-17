// Message formatter - interfaces for cleaning and bubble splitting

export interface FormatOptions {
  format: OutputFormat;
  maxBubbleLength?: number;
  preserveMarkdown?: boolean;
  stripHtml?: boolean;
}

export type OutputFormat = 'bubble' | 'plain' | 'markdown';

export interface FormattedOutput {
  text: string;
  bubbles: Bubble[];
  metadata: FormattingMetadata;
}

export interface Bubble {
  content: string;
  index: number;
  charCount: number;
}

export interface FormattingMetadata {
  originalLength: number;
  formattedLength: number;
  bubbleCount: number;
  htmlStripped: boolean;
  markdownPreserved: boolean;
}

// Formatter interface
export interface MessageFormatter {
  /**
   * Format raw AI response for channel delivery
   */
  format(content: string, options: FormatOptions): Promise<FormattedOutput>;

  /**
   * Split long content into bubble-friendly chunks
   */
  splitIntoBubbles(content: string, maxLength: number): Bubble[];

  /**
   * Strip markdown to plain text while preserving structure
   */
  stripMarkdown(content: string): string;

  /**
   * Clean HTML tags from content
   */
  stripHtml(content: string): string;

  /**
   * Convert markdown to WhatsApp-friendly format
   */
  markdownToWhatsApp(content: string): string;
}

// Default formatter implementation
export class DefaultMessageFormatter implements MessageFormatter {
  async format(content: string, options: FormatOptions): Promise<FormattedOutput> {
    // TODO: Implement full formatting logic:
    // 1. Strip HTML if needed
    // 2. Handle markdown based on format
    // 3. Split into bubbles if needed
    // 4. Apply channel-specific rules
    throw new Error('Formatter not yet implemented');
  }

  splitIntoBubbles(content: string, maxLength: number): Bubble[] {
    if (content.length <= maxLength) {
      return [{ content, index: 0, charCount: content.length }];
    }

    const bubbles: Bubble[] = [];
    const sentences = content.match(/[^.!?]+[.!?]+/g) || [content];
    let currentBubble = '';
    let index = 0;

    for (const sentence of sentences) {
      if ((currentBubble + sentence).length > maxLength && currentBubble.length > 0) {
        bubbles.push({
          content: currentBubble.trim(),
          index: index++,
          charCount: currentBubble.length,
        });
        currentBubble = sentence;
      } else {
        currentBubble += sentence;
      }
    }

    if (currentBubble.trim()) {
      bubbles.push({
        content: currentBubble.trim(),
        index: index,
        charCount: currentBubble.length,
      });
    }

    return bubbles;
  }

  stripMarkdown(content: string): string {
    // Basic markdown stripping
    return content
      .replace(/\*\*(.*?)\*\*/g, '$1') // bold
      .replace(/\*(.*?)\*/g, '$1') // italic
      .replace(/__(.*?)__/g, '$1') // underline
      .replace(/~~(.*?)~~/g, '$1') // strikethrough
      .replace(/`{1,3}(.*?)`{1,3}/gs, '$1') // code
      .replace(/#{1,6}\s+(.*?)\s*$/gm, '$1') // headers
      .replace(/\[(.*?)\]\(.*?\)/g, '$1') // links
      .replace(/!\[(.*?)\]\(.*?\)/g, '$1') // images
      .trim();
  }

  stripHtml(content: string): string {
    return content
      .replace(/<[^>]*>/g, '')
      .replace(/&nbsp;/g, ' ')
      .replace(/&amp;/g, '&')
      .replace(/&lt;/g, '<')
      .replace(/&gt;/g, '>')
      .replace(/&quot;/g, '"')
      .replace(/&#39;/g, "'")
      .trim();
  }

  markdownToWhatsApp(content: string): string {
    // Convert markdown to WhatsApp-friendly format
    return content
      .replace(/\*\*(.*?)\*\*/g, '*$1*') // bold stays
      .replace(/\*(.*?)\*/g, '_$1_') // italic becomes underscore
      .replace(/```([\s\S]*?)```/g, '```$1```') // code blocks
      .replace(/`{1}([^`]+)`{1}/g, "'$1'") // inline code
      .replace(/^>\s+(.*?)$/gm, '>$1') // blockquotes
      .replace(/#{1,3}\s+(.*?)$/gm, '*$1*') // headers to bold
      .trim();
  }
}

// WhatsApp-specific formatting rules
export const whatsappRules = {
  maxMessageLength: 4096,
  maxBubbleLength: 1024,
  preserveNewlines: true,
  emojiAllowed: true,
  urlShortening: false,
} as const;