// Webhooks controller - receives inbound messages from GHL

import {
  BadRequestException,
  Controller,
  Post,
  Body,
  Headers,
  HttpCode,
  HttpException,
  HttpStatus,
  InternalServerErrorException,
  Logger,
  Req,
  UnauthorizedException,
} from '@nestjs/common';
import type { RawBodyRequest } from '@nestjs/common';
import { SkipThrottle } from '@nestjs/throttler';
import { ApiTags, ApiOperation, ApiResponse } from '@nestjs/swagger';
import type { Request } from 'express';
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
@SkipThrottle()
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
    @Req() req: RawBodyRequest<Request>,
    @Body() body: unknown,
    @Headers('x-ghl-signature') signature: string,
    @Headers('x-aisbp-webhook-token') webhookToken: string,
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

    this.logger.log(
      `Webhook received: event=${payload.event}, locationId=${payload.locationId}`,
    );

    const rawBody =
      req.rawBody ??
      (body !== undefined && body !== null
        ? Buffer.from(JSON.stringify(body), 'utf8')
        : undefined);

    const verification = await this.webhookVerificationService.verify({
      rawBody,
      hmacSignature: signature,
      staticToken: webhookToken,
    });

    if (!verification.valid) {
      this.logger.warn(
        `webhookVerificationFailed ${JSON.stringify({
          configured: verification.configured,
          reason: verification.reason || 'unknown_reason',
          event: payload.event,
          locationId: payload.locationId,
        })}`,
      );
      throw new UnauthorizedException({
        message: 'Webhook verification failed',
        reason: verification.reason ?? 'unknown_reason',
      });
    }

    try {
      const isProd = process.env['NODE_ENV'] === 'production';
      const smokeAllowedInProd =
        String(process.env['AISBP_ALLOW_WEBHOOK_SMOKE_IN_PROD'] ?? '').toLowerCase() === 'true';
      const smokeImmediate =
        (!isProd || smokeAllowedInProd) &&
        (String(aisbpSmokeImmediate ?? '').toLowerCase() === 'true' ||
          String(process.env['AISBP_WEBHOOK_SMOKE_IMMEDIATE'] ?? '').toLowerCase() === 'true');
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
        ...(result.duplicate ? { duplicate: true as const, duplicateReason: result.duplicateReason } : {}),
        ...(result.skippedReason ? { skippedReason: result.skippedReason } : {}),
      };
    } catch (error) {
      this.logger.error(`Webhook processing error: ${formatPostgrestError(error)}`);
      if (error instanceof HttpException) {
        throw error;
      }
      throw new InternalServerErrorException('Webhook processing failed');
    }
  }
}
