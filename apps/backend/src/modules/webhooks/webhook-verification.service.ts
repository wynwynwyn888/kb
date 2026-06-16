// Webhook signature verification — HMAC-SHA256 over raw request bytes.

import { Injectable, Logger } from '@nestjs/common';
import { createHmac, timingSafeEqual } from 'node:crypto';
import { isProductionEnv } from '../../lib/safe-text-preview-for-log';

@Injectable()
export class WebhookVerificationService {
  private readonly logger = new Logger(WebhookVerificationService.name);
  private warnedNotConfigured = false;

  /**
   * Verify GHL webhook signature (`x-ghl-signature`).
   * - Production: secret required; missing/invalid signatures reject.
   * - Non-production: when secret unset, accepts with warning (local dev).
   */
  async verifySignature(
    rawBody: Buffer | string | undefined,
    signature: string,
  ): Promise<{ valid: boolean; configured: boolean; reason?: string }> {
    const secret = String(process.env['WEBHOOK_SIGNATURE_SECRET'] ?? '').trim();
    if (!secret) {
      if (isProductionEnv()) {
        return { valid: false, configured: false, reason: 'not_configured' };
      }
      if (!this.warnedNotConfigured) {
        this.warnedNotConfigured = true;
        this.logger.warn(
          'webhookVerificationNotConfigured WEBHOOK_SIGNATURE_SECRET is not set; accepting unsigned webhooks in non-production',
        );
      }
      return { valid: true, configured: false, reason: 'not_configured' };
    }

    const sig = String(signature ?? '').trim();
    if (!sig) {
      return { valid: false, configured: true, reason: 'missing_signature' };
    }

    const bodyBuf = Buffer.isBuffer(rawBody)
      ? rawBody
      : Buffer.from(
          typeof rawBody === 'string' ? rawBody : '',
          'utf8',
        );

    if (bodyBuf.length === 0) {
      return { valid: false, configured: true, reason: 'missing_raw_body' };
    }

    const provided = sig.startsWith('sha256=') ? sig.slice('sha256='.length).trim() : sig;
    const expected = createHmac('sha256', secret).update(bodyBuf).digest('hex');

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
