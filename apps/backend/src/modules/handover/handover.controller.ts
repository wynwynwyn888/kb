// Handover controller - list active handovers and resume

import { Controller, Get, Post, Param, Body, UseGuards, Query, NotFoundException } from '@nestjs/common';
import { ApiTags, ApiBearerAuth, ApiOperation } from '@nestjs/swagger';
import { HandoverService } from './handover.service';
import { TenantsService } from '../tenants/tenants.service';
import { ConversationsControllerService } from '../conversations/conversations-controller.service';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard';
import { CurrentTenantId, CurrentUser } from '../auth/decorators/current-user.decorator';
import type { SessionUser } from '../../lib/supabase';

@ApiTags('handover')
@ApiBearerAuth()
@UseGuards(JwtAuthGuard)
@Controller('handover')
export class HandoverController {
  constructor(
    private readonly handoverService: HandoverService,
    private readonly tenantsService: TenantsService,
    private readonly conversationsControllerService: ConversationsControllerService,
  ) {}

  @Get('active')
  @ApiOperation({ summary: 'List conversations currently in active handover' })
  async getActive(
    @CurrentTenantId() tenantId: string | null,
    @CurrentUser() user: SessionUser,
    @Query('tenantId') queryTenantId?: string,
  ) {
    const effectiveTenantId = queryTenantId || tenantId;
    if (!effectiveTenantId) {
      throw new NotFoundException('tenantId is required');
    }

    await this.assertTenantScope(user, effectiveTenantId);

    return this.handoverService.getActiveHandoverEvents(effectiveTenantId);
  }

  @Post('resume')
  @ApiOperation({ summary: 'Resume a conversation from handover' })
  async resume(
    @Body() dto: { conversationId: string },
    @CurrentUser() user: SessionUser,
  ) {
    const { conversationId } = dto;
    await this.assertConversationScope(user, conversationId);

    const active = await this.handoverService.getActiveHandover(conversationId);
    if (!active) {
      throw new NotFoundException('Active handover not found');
    }

    await this.handoverService.resume(conversationId);
    return { success: true, conversationId };
  }

  @Get('status/:conversationId')
  @ApiOperation({ summary: 'Get active handover status for a conversation' })
  async getStatus(
    @Param('conversationId') conversationId: string,
    @CurrentUser() user: SessionUser,
  ) {
    await this.assertConversationScope(user, conversationId);

    const handover = await this.handoverService.getActiveHandover(conversationId);
    return {
      inHandover: handover !== null,
      handover: handover ?? null,
    };
  }

  @Get('history/:conversationId')
  @ApiOperation({ summary: 'Get handover history for a conversation' })
  async getHistory(
    @Param('conversationId') conversationId: string,
    @CurrentUser() user: SessionUser,
  ) {
    await this.assertConversationScope(user, conversationId);
    return this.handoverService.getHandoverHistory(conversationId);
  }

  private async assertTenantScope(user: SessionUser, effectiveTenantId: string): Promise<void> {
    const ok = await this.tenantsService.checkTenantAccess(effectiveTenantId, user.id);
    if (!ok) {
      throw new NotFoundException('Not found');
    }
  }

  private async assertConversationScope(user: SessionUser, conversationId: string): Promise<void> {
    const conversation = await this.conversationsControllerService.findOne(conversationId);
    if (!conversation) {
      throw new NotFoundException('Conversation not found');
    }
    await this.assertTenantScope(user, conversation.tenantId);
  }
}
