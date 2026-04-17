// Formatter service - handles message formatting

import { Injectable } from '@nestjs/common';
import { DefaultMessageFormatter, FormatOptions } from '@aisbp/formatter';

@Injectable()
export class FormatterService {
  private formatter = new DefaultMessageFormatter();

  // TODO: Implement formatting
  // - Strip markdown/HTML based on settings
  // - Split into bubble-friendly chunks
  // - Apply channel-specific rules (WhatsApp, SMS, etc.)
  // - Preserve readability for chat channels

  async format(content: string, options: FormatOptions) {
    return this.formatter.format(content, options);
  }

  async splitIntoBubbles(content: string, maxLength: number = 1024) {
    return this.formatter.splitIntoBubbles(content, maxLength);
  }

  async stripMarkdown(content: string) {
    return this.formatter.stripMarkdown(content);
  }

  async toWhatsApp(content: string) {
    return this.formatter.markdownToWhatsApp(content);
  }
}