// Webhooks controller - receives inbound messages from GHL

import {
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
import { WebhookVerificationService } from './webhook-verification.service';
import { GhlWebhookPayload } from './dto/ghl-webhook.payload';

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
    @Body() payload: GhlWebhookPayload,
    @Headers('x-ghl-signature') signature: string,
  ) {
    // Log safe fields only — never log raw payload or message content
    this.logger.log(
      `Webhook received: event=${payload.event}, locationId=${payload.locationId}`,
    );

    // Verify signature (placeholder — always passes until key management exists)
    const verification = await this.webhookVerificationService.verifySignature(
      payload,
      signature,
    );

    if (!verification.valid) {
      this.logger.warn(
        `Webhook signature invalid: ${verification.reason || 'unknown reason'}`,
      );
      // Still return 200 to avoid GHL retry storms
      return {
        success: true,
        message: 'Webhook received (signature verification deferred)',
      };
    }

    try {
      const result = await this.webhooksService.handleGhlWebhook(payload);

      if (result.duplicate) {
        this.logger.debug(`Duplicate event acknowledged: ${result.eventId}`);
      }

      return {
        success: true,
        eventId: result.eventId,
        message: 'Webhook received',
      };
    } catch (error) {
      // Log error safely but still acknowledge GHL
      this.logger.error(
        `Webhook processing error: ${error instanceof Error ? error.message : 'unknown'}`,
      );
      return {
        success: true,
        message: 'Webhook received (processing deferred)',
      };
    }
  }
}
