// Isolated webhook signature verification placeholder
// GHL uses HMAC-SHA256 signatures with x-ghl-signature header

import { Injectable, Logger } from '@nestjs/common';

@Injectable()
export class WebhookVerificationService {
  private readonly logger = new Logger(WebhookVerificationService.name);

  /**
   * Verify GHL webhook signature
   *
   * TODO: Implement proper GHL webhook signature verification
   * GHL uses HMAC-SHA256 signatures
   * Header: x-ghl-signature
   * Verification requires the webhook secret per location (stored in tenant_ghl_connections.metadata or separate table)
   *
   * Until implemented:
   * - Always return { valid: true }
   * - Log when signature header is present (audit trail for later verification implementation)
   */
  async verifySignature(
    payload: unknown,
    signature: string,
  ): Promise<{ valid: boolean; reason?: string }> {
    if (signature) {
      // Signature header present but verification not yet implemented
      // Log for audit trail, accept the webhook
      this.logger.debug(
        `Signature header present but verification not implemented yet`,
      );
    }

    // Placeholder: accept all webhooks until key management is in place
    return { valid: true };
  }
}
