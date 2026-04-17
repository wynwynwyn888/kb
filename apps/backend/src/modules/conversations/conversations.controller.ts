// Conversations controller - list and inspect conversations with messages

import { Controller, Get, Param, Query, NotFoundException, UseGuards } from '@nestjs/common';
import { ApiTags, ApiBearerAuth, ApiOperation } from '@nestjs/swagger';
import { ConversationsService } from './conversations.service';
import { ConversationsControllerService } from './conversations-controller.service';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard';
import { CurrentTenantId, CurrentAgencyId, CurrentUser } from '../auth/decorators/current-user.decorator';
import type { SessionUser } from '../../lib/supabase';

@ApiTags('conversations')
@ApiBearerAuth()
@UseGuards(JwtAuthGuard)
@Controller('conversations')
export class ConversationsController {
  constructor(
    private readonly conversationsService: ConversationsService,
    private readonly controllerService: ConversationsControllerService,
  ) {}

  @Get()
  @ApiOperation({ summary: 'List conversations for a tenant' })
  async findAll(
    @CurrentTenantId() tenantId: string | null,
    @CurrentAgencyId() agencyId: string | null,
    @CurrentUser() user: SessionUser,
    @Query('tenantId') queryTenantId?: string,
    @Query('status') status?: string,
    @Query('page') page?: number,
    @Query('pageSize') pageSize?: number,
  ) {
    // Resolve tenantId: query param > user.tenantId
    const effectiveTenantId = queryTenantId || tenantId;
    if (!effectiveTenantId) {
      throw new NotFoundException('tenantId is required');
    }

    // Access check: agency users can cross tenants; tenant users must match
    if (user.tenantId && user.tenantId !== effectiveTenantId) {
      throw new NotFoundException('Conversation not found');
    }

    return this.controllerService.findAll(effectiveTenantId, status, page, pageSize);
  }

  @Get(':id')
  @ApiOperation({ summary: 'Get a conversation by ID' })
  async findOne(
    @Param('id') id: string,
    @CurrentUser() user: SessionUser,
  ) {
    const conversation = await this.controllerService.findOne(id);
    if (!conversation) {
      throw new NotFoundException('Conversation not found');
    }

    // Access check
    if (user.tenantId && user.tenantId !== conversation.tenantId) {
      throw new NotFoundException('Conversation not found');
    }

    return conversation;
  }

  @Get(':id/messages')
  @ApiOperation({ summary: 'Get messages for a conversation' })
  async getMessages(
    @Param('id') id: string,
    @CurrentUser() user: SessionUser,
    @Query('limit') limit?: number,
    @Query('before') before?: string,
  ) {
    const conversation = await this.controllerService.findOne(id);
    if (!conversation) {
      throw new NotFoundException('Conversation not found');
    }

    // Access check
    if (user.tenantId && user.tenantId !== conversation.tenantId) {
      throw new NotFoundException('Conversation not found');
    }

    return this.controllerService.getMessages(id, limit, before);
  }
}
