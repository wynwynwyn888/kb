// Conversations controller

import { Controller, Get, Post, Body, Param, Query } from '@nestjs/common';
import { ApiTags, ApiBearerAuth } from '@nestjs/swagger';
import { ConversationsService } from './conversations.service';

@ApiTags('conversations')
@ApiBearerAuth()
@Controller('conversations')
export class ConversationsController {
  constructor(private readonly conversationsService: ConversationsService) {}

  @Get()
  async findAll(
    @Query('tenantId') tenantId: string,
    @Query('status') status?: string,
    @Query('page') page?: number,
    @Query('pageSize') pageSize?: number,
  ) {
    // TODO: Implement - with strict tenant isolation
    throw new Error('Not implemented');
  }

  @Get(':id')
  async findOne(@Param('id') id: string) {
    // TODO: Implement
    throw new Error('Not implemented');
  }

  @Get(':id/messages')
  async getMessages(
    @Param('id') id: string,
    @Query('limit') limit?: number,
    @Query('before') before?: string,
  ) {
    // TODO: Implement - last 10 turns, 24hr session reset logic
    throw new Error('Not implemented');
  }

  @Post(':id/send')
  async sendMessage(@Param('id') id: string, @Body() dto: { content: string }) {
    // TODO: Implement - send via GHL, deduct quota on success
    throw new Error('Not implemented');
  }
}