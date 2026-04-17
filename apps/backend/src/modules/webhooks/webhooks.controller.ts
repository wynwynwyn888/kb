// Webhooks controller - receives inbound messages from GHL

import { Controller, Post, Body, Headers, RawBodyRequest, Req } from '@nestjs/common';
import { ApiTags } from '@nestjs/swagger';
import { WebhooksService } from './webhooks.service';

@ApiTags('webhooks')
@Controller('webhooks/ghl')
export class WebhooksController {
  constructor(private readonly webhooksService: WebhooksService) {}

  @Post('inbound')
  async handleInbound(
    @Body() payload: Record<string, unknown>,
    @Headers('x-ghl-signature') signature: string,
  ) {
    // TODO: Verify webhook signature
    // TODO: Add to inbound message queue
    throw new Error('Not implemented');
  }

  @Post('conversation')
  async handleConversationEvent(@Body() payload: Record<string, unknown>) {
    // TODO: Handle conversation lifecycle events
    throw new Error('Not implemented');
  }
}