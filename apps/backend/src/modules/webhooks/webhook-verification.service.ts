// Webhook signature verification (config-gated).
// When WEBHOOK_SIGNATURE_SECRET is configured, validate x-ghl-signature as HMAC-SHA256 over the JSON body.
// When not configured, accept all webhooks but log a one-time warning at runtime.

import { Injectable, Logger } from '@nestjs/common';
import { createHmac, timingSafeEqual } from 'node:crypto';

@Injectable()
export class WebhookVerificationService {
  private readonly logger = new Logger(WebhookVerificationService.name);
  private warnedNotConfigured = false;

  /**
   * Verify GHL webhook signature
   *
   * Safe-mode implementation:
   * - If WEBHOOK_SIGNATURE_SECRET is unset/blank: accept and return { valid: true, configured: false }
   * - If set: require a signature and validate it; invalid signatures return { valid: false, configured: true }
   *
   * NOTE: This uses JSON.stringify(payload) since raw bytes are not captured in this build.
   */
  async verifySignature(
    payload: unknown,
    signature: string,
  ): Promise<{ valid: boolean; configured: boolean; reason?: string }> {
    const secret = String(process.env['WEBHOOK_SIGNATURE_SECRET'] ?? '').trim();
    if (!secret) {
      if (!this.warnedNotConfigured) {
        this.warnedNotConfigured = true;
        this.logger.warn('webhookVerificationNotConfigured WEBHOOK_SIGNATURE_SECRET is not set; accepting all webhooks');
      }
      return { valid: true, configured: false, reason: 'not_configured' };
    }

    const sig = String(signature ?? '').trim();
    if (!sig) {
      return { valid: false, configured: true, reason: 'missing_signature' };
    }

    const provided = sig.startsWith('sha256=') ? sig.slice('sha256='.length).trim() : sig;
    const body = JSON.stringify(payload ?? {});
    const expected = createHmac('sha256', secret).update(body, 'utf8').digest('hex');

    try {
      const a = Buffer.from(provided, 'hex');
      const b = Buffer.from(expected, 'hex');
      if (a.length !== b.length) {
        return { valid: false, configured: true, reason: 'signature_length_mismatch' };
      }
      const ok = timingSafeEqual(a, b);
      return ok ? { valid: true, configured: true } : { valid: false, configured: true, reason: 'invalid_signature' };
    } catch {
      return { valid: false, configured: true, reason: 'invalid_signature_format' };
    }
  }
}
