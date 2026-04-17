// Handover controller

import { Controller, Post, Patch, Get, Body, Param } from '@nestjs/common';
import { ApiTags, ApiBearerAuth } from '@nestjs/swagger';
import { HandoverService } from './handover.service';

@ApiTags('handover')
@ApiBearerAuth()
@Controller('handover')
export class HandoverController {
  constructor(private readonly handoverService: HandoverService) {}

  @Post('initiate')
  async initiate(@Body() dto: {
    conversationId: string;
    type: 'request' | 'transfer';
    note?: string;
  }) {
    // TODO: Implement
    throw new Error('Not implemented');
  }

  @Post('resume')
  async resume(@Body() dto: { conversationId: string }) {
    // TODO: Implement - resume AI replies
    throw new Error('Not implemented');
  }

  @Get('status/:conversationId')
  async getStatus(@Param('conversationId') conversationId: string) {
    // TODO: Implement
    throw new Error('Not implemented');
  }

  @Get('history/:conversationId')
  async getHistory(@Param('conversationId') conversationId: string) {
    // TODO: Implement
    throw new Error('Not implemented');
  }
}