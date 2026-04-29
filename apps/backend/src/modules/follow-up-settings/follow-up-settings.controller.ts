import { Body, Controller, Get, Patch, Param, UseGuards } from '@nestjs/common';
import { ApiBearerAuth, ApiOperation, ApiTags } from '@nestjs/swagger';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard';
import { CurrentUser } from '../auth/decorators/current-user.decorator';
import type { SessionUser } from '../../lib/supabase';
import { GhlService } from '../ghl/ghl.service';
import { FollowUpSettingsService } from './follow-up-settings.service';

@ApiTags('follow-up-settings')
@ApiBearerAuth()
@UseGuards(JwtAuthGuard)
@Controller('tenants/:tenantId/follow-up-settings')
export class FollowUpSettingsController {
  constructor(
    private readonly followUpSettingsService: FollowUpSettingsService,
    private readonly ghlService: GhlService,
  ) {}

  @Get()
  @ApiOperation({ summary: 'Get follow-up automation settings (stored only)' })
  async get(@Param('tenantId') tenantId: string, @CurrentUser() user: SessionUser) {
    await this.ghlService.ensureTenantAccessOrThrow(tenantId, user.id);
    return this.followUpSettingsService.getFollowUpSettings(tenantId);
  }

  @Patch()
  @ApiOperation({ summary: 'Update follow-up automation settings' })
  async patch(@Param('tenantId') tenantId: string, @CurrentUser() user: SessionUser, @Body() body: unknown) {
    await this.ghlService.ensureTenantAccessOrThrow(tenantId, user.id);
    return this.followUpSettingsService.patchFollowUpSettings(tenantId, body);
  }
}
