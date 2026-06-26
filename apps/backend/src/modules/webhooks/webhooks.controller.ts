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
import type { GhlWebhookPayload, GhlOutboundThroughKbPayload } from './dto/ghl-webhook.payload';
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

  /**
   * Record outbound-through-KB messages (GHL workflow → KB context).
   * Accepts GHL standard webhook fields — no custom body needed.
   */
  @Post('outbound')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: 'Record GHL workflow outbound message in KB context' })
  async recordOutbound(
    @Body() body: Record<string, unknown>,
    @Headers('x-aisbp-webhook-token') webhookToken: string,
  ) {
    if (process.env['AISBP_OUTBOUND_THROUGH_KB_ENABLED'] !== 'true') {
      throw new BadRequestException('Outbound-through-KB is not enabled');
    }

    const authResult = await this.webhookVerificationService.verify({
      rawBody: Buffer.from(JSON.stringify(body)),
      hmacSignature: undefined,
      staticToken: webhookToken,
    });
    if (!authResult) {
      throw new UnauthorizedException('Invalid webhook token');
    }

    // Accept GHL standard fields: contact_id (preferred) or phone, location.id
    const contactId = (typeof body['contact_id'] === 'string' ? body['contact_id'] : null)
      ?? (typeof body['phone'] === 'string' ? body['phone'] : null)
      ?? null;
    const locationId = (body['location'] as Record<string,unknown> | null)?.['id'] as string | undefined
      ?? body['ghlLocationId'] as string | undefined
      ?? body['locationId'] as string | undefined;
    // GHL workflow webhooks don't include the outbound message text — fall back to workflow name or generic msg
    const messageBody = (typeof body['message'] === 'object'
      ? ((body['message'] as Record<string,unknown>)?.['body'] as string
        ?? (body['message'] as Record<string,unknown>)?.['message'] as string)
      : null)
      ?? (typeof body['body'] === 'string' ? body['body'] as string : null)
      ?? (typeof body['messageContent'] === 'string' ? body['messageContent'] as string : null)
      ?? (typeof body['msg'] === 'string' ? body['msg'] as string : null)
      ?? ((body['workflow'] as Record<string,unknown> | null)?.['name'] as string)
      ?? 'Outbound message sent via GHL workflow';

    if (!contactId || !locationId) {
      this.logger.error(`outboundThroughKb validation failed: contactId=${!!contactId} location=${!!locationId} keys=${JSON.stringify(Object.keys(body).slice(0,10))}`);
      throw new BadRequestException(`Missing required fields: contact_id, location.id (got keys: ${Object.keys(body).join(', ')})`);
    }

    // Resolve tenant from location
    const tenantId = await this.webhooksService.resolveTenantFromLocation(String(locationId));
    if (!tenantId) {
      throw new BadRequestException('No tenant found for this location');
    }

    // Find or create conversation using the GHL contact_id (matches inbound path)
    const conversationId = await this.webhooksService.resolveConversationForContact(
      tenantId, String(locationId), String(contactId),
    );

    await this.webhooksService.recordOutboundThroughKb({
      tenantId,
      ghlLocationId: String(locationId),
      conversationId,
      contactId: '',
      messageContent: String(messageBody),
      metadata: { source: 'ghl_workflow', rawKeys: Object.keys(body).filter(k => typeof body[k] !== 'object').join(',') },
    });

    return { success: true, tenantId, conversationId, messageContent: String(messageBody).slice(0, 100) };
  }
}
