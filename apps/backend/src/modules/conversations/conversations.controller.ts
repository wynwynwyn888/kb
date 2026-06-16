// Conversations controller - list and inspect conversations with messages

import {
  Controller,
  Get,
  Post,
  Param,
  Query,
  NotFoundException,
  UseGuards,
  BadRequestException,
  HttpCode,
  HttpStatus,
} from '@nestjs/common';
import { InjectQueue } from '@nestjs/bullmq';
import type { Queue } from 'bullmq';
import { ApiTags, ApiBearerAuth, ApiOperation } from '@nestjs/swagger';
import { ConversationsService } from './conversations.service';
import { ConversationsControllerService } from './conversations-controller.service';
import { ConversationResetService } from './conversation-reset.service';
import { TenantsService } from '../tenants/tenants.service';
import { QUEUES } from '../../queues/queue.constants';
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
    private readonly conversationResetService: ConversationResetService,
    private readonly tenantsService: TenantsService,
    @InjectQueue(QUEUES.SEND_BUBBLE) private readonly sendBubbleQueue: Queue,
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

    await this.assertTenantScope(user, effectiveTenantId);

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

    await this.assertTenantScope(user, conversation.tenantId);

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

    await this.assertTenantScope(user, conversation.tenantId);

    return this.controllerService.getMessages(id, limit, before);
  }

  @Post(':id/reset-state')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: 'Reset bot policy state and memory anchor (keeps message history)' })
  async resetBotState(@Param('id') id: string, @CurrentUser() user: SessionUser) {
    const conversation = await this.controllerService.findOne(id);
    if (!conversation) {
      throw new NotFoundException('Conversation not found');
    }
    await this.assertTenantScope(user, conversation.tenantId);

    const ghlLocationId = await this.controllerService.getTenantGhlLocationId(conversation.tenantId);
    if (!ghlLocationId) {
      throw new BadRequestException('Tenant has no GHL location configured');
    }

    const result = await this.conversationResetService.performBotStateReset({
      conversationId: conversation.id,
      tenantId: conversation.tenantId,
      source: 'dashboard',
    });

    await this.conversationResetService.clearHandoverAfterAllowedReset(conversation.id, conversation.tenantId);

    const plan = this.conversationResetService.buildConfirmationReplyPlan();
    await this.sendBubbleQueue.add('send-bubble', {
      conversationId: conversation.id,
      tenantId: conversation.tenantId,
      contactId: conversation.contactId,
      ghlLocationId,
      replyPlanJson: JSON.stringify(plan),
    });

    return {
      ok: true,
      memoryResetAt: result.memoryResetAt,
      resetVersion: result.resetVersion,
      clearedKeys: [...result.clearedKeys],
    };
  }

  private async assertTenantScope(user: SessionUser, effectiveTenantId: string): Promise<void> {
    const ok = await this.tenantsService.checkTenantAccess(effectiveTenantId, user.id);
    if (!ok) {
      throw new NotFoundException('Conversation not found');
    }
  }
}
