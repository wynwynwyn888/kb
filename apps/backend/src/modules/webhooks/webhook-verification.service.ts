// Webhook verification — HMAC (raw body) or static token (GHL workflow webhooks).

import { Injectable, Logger } from '@nestjs/common';
import { createHmac, timingSafeEqual } from 'node:crypto';
import { isProductionEnv } from '../../lib/safe-text-preview-for-log';

export type WebhookVerificationInput = {
  rawBody: Buffer | string | undefined;
  /** HMAC hex digest in `x-ghl-signature` (integrations that sign the raw body). */
  hmacSignature?: string;
  /** Shared secret in `x-aisbp-webhook-token` (GHL workflow custom webhook headers). */
  staticToken?: string;
};

function timingSafeEqualString(a: string, b: string): boolean {
  const left = Buffer.from(a, 'utf8');
  const right = Buffer.from(b, 'utf8');
  if (left.length !== right.length) return false;
  return timingSafeEqual(left, right);
}

@Injectable()
export class WebhookVerificationService {
  private readonly logger = new Logger(WebhookVerificationService.name);
  private warnedNotConfigured = false;

  /**
   * Verify inbound GHL webhook auth.
   * - Prefer `x-aisbp-webhook-token` when set (static secret — required for GHL workflow webhooks).
   * - Else verify `x-ghl-signature` HMAC-SHA256 over raw request bytes.
   */
  async verify(input: WebhookVerificationInput): Promise<{
    valid: boolean;
    configured: boolean;
    reason?: string;
  }> {
    const secret = String(process.env['WEBHOOK_SIGNATURE_SECRET'] ?? '').trim();
    const staticToken = String(input.staticToken ?? '').trim();

    if (staticToken) {
      if (!secret) {
        if (isProductionEnv()) {
          return { valid: false, configured: false, reason: 'not_configured' };
        }
        return { valid: true, configured: false, reason: 'not_configured' };
      }
      if (timingSafeEqualString(secret, staticToken)) {
        return { valid: true, configured: true, reason: 'static_token' };
      }
      return { valid: false, configured: true, reason: 'invalid_static_token' };
    }

    return this.verifyHmacSignature(input.rawBody, input.hmacSignature ?? '');
  }

  /** @deprecated Use {@link verify} — kept for existing unit tests. */
  async verifySignature(
    rawBody: Buffer | string | undefined,
    signature: string,
  ): Promise<{ valid: boolean; configured: boolean; reason?: string }> {
    return this.verify({ rawBody, hmacSignature: signature });
  }

  private async verifyHmacSignature(
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
      : Buffer.from(typeof rawBody === 'string' ? rawBody : '', 'utf8');

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
