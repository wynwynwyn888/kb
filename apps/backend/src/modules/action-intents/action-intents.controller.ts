// Action Intents controller - inspect action intents

import { Controller, Get, Query, UseGuards, NotFoundException } from '@nestjs/common';
import { ApiTags, ApiBearerAuth, ApiOperation } from '@nestjs/swagger';
import { ActionIntentsService } from './action-intents.service';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard';
import { CurrentTenantId, CurrentUser } from '../auth/decorators/current-user.decorator';
import type { SessionUser } from '../../lib/supabase';

@ApiTags('action-intents')
@ApiBearerAuth()
@UseGuards(JwtAuthGuard)
@Controller('action-intents')
export class ActionIntentsController {
  constructor(private readonly actionIntentsService: ActionIntentsService) {}

  @Get()
  @ApiOperation({ summary: 'List action intents for a tenant' })
  async findAll(
    @CurrentTenantId() tenantId: string | null,
    @CurrentUser() user: SessionUser,
    @Query('tenantId') queryTenantId?: string,
    @Query('conversationId') conversationId?: string,
    @Query('status') status?: string,
    @Query('limit') limit?: number,
    @Query('page') page?: number,
  ) {
    const effectiveTenantId = queryTenantId || tenantId;
    if (!effectiveTenantId) {
      throw new NotFoundException('tenantId is required');
    }

    if (user.tenantId && user.tenantId !== effectiveTenantId) {
      throw new NotFoundException('Not found');
    }

    return this.actionIntentsService.findAll(effectiveTenantId, {
      conversationId,
      status,
      limit: limit ? Number(limit) : undefined,
      page: page ? Number(page) : undefined,
    });
  }
}
