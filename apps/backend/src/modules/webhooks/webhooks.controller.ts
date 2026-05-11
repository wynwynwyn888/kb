// Webhooks controller - receives inbound messages from GHL

import {
  BadRequestException,
  Controller,
  Post,
  Body,
  Headers,
  HttpCode,
  HttpStatus,
  Logger,
} from '@nestjs/common';
import { ApiTags, ApiOperation, ApiResponse } from '@nestjs/swagger';
import { WebhooksService } from './webhooks.service';
import { formatPostgrestError } from '../../lib/format-postgrest-error';
import { WebhookVerificationService } from './webhook-verification.service';
import type { GhlWebhookPayload } from './dto/ghl-webhook.payload';
import {
  coerceGhlWebhookPayload,
  summarizeGhlWebhookBodyKeys,
} from './ghl-webhook-payload-shape';
import { ghlWebhookLogBodyKeysEnabled } from '../../lib/production-log-flags';

@ApiTags('webhooks')
@Controller('webhooks/ghl')
export class WebhooksController {
  private readonly logger = new Logger(WebhooksController.name);

  constructor(
    private readonly webhooksService: WebhooksService,
    private readonly webhookVerificationService: WebhookVerificationService,
  ) {}

  @Post()
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: 'Handle GHL webhook events' })
  @ApiResponse({ status: 200, description: 'Webhook acknowledged' })
  async handleWebhook(
    @Body() body: unknown,
    @Headers('x-ghl-signature') signature: string,
    @Headers('x-aisbp-smoke-immediate') aisbpSmokeImmediate?: string,
  ) {
    if (ghlWebhookLogBodyKeysEnabled()) {
      this.logger.log(summarizeGhlWebhookBodyKeys(body));
    }

    let payload: GhlWebhookPayload;
    let workflowFlatRaw: Record<string, unknown> | undefined;
    try {
      const coerced = coerceGhlWebhookPayload(body);
      payload = coerced.payload;
      workflowFlatRaw = coerced.workflowFlatRaw;
      this.logger.log(`Webhook payload shape detected: ${coerced.shape}`);
    } catch (e) {
      throw new BadRequestException(
        e instanceof Error ? e.message : 'Invalid webhook payload',
      );
    }

    // Log safe fields only — never log raw payload or message content
    this.logger.log(
      `Webhook received: event=${payload.event}, locationId=${payload.locationId}`,
    );

    // Verify signature (placeholder — always passes until key management exists)
    const verification = await this.webhookVerificationService.verifySignature(
      body,
      signature,
    );

    if (!verification.valid) {
      this.logger.warn(
        `webhookVerificationFailed ${JSON.stringify({
          configured: verification.configured,
          reason: verification.reason || 'unknown_reason',
          event: payload.event,
          locationId: payload.locationId,
        })}`,
      );
      // Still return 200 to avoid GHL retry storms, but skip processing.
      return {
        success: true,
        message: 'Webhook received',
        skipped: true,
      };
    }

    try {
      const smokeImmediate =
        String(aisbpSmokeImmediate ?? '').toLowerCase() === 'true' ||
        String(process.env['AISBP_WEBHOOK_SMOKE_IMMEDIATE'] ?? '').toLowerCase() === 'true';
      const result = await this.webhooksService.handleGhlWebhook(payload, {
        smokeImmediate,
        workflowFlatRaw,
      });

      if (result.duplicate) {
        this.logger.log(
          `duplicateWebhookSkipped=true duplicateReason=${result.duplicateReason ?? 'n/a'} eventId=${result.eventId ?? 'n/a'}`,
        );
      }

      return {
        success: true,
        eventId: result.eventId,
        message: 'Webhook received',
      };
    } catch (error) {
      // Log error safely but still acknowledge GHL (PostgREST errors are not always Error instances)
      this.logger.error(`Webhook processing error: ${formatPostgrestError(error)}`);
      return {
        success: true,
        message: 'Webhook received (processing deferred)',
      };
    }
  }
}
