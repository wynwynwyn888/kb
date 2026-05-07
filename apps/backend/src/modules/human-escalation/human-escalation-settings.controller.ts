import { Body, Controller, Get, Param, Patch, UseGuards } from '@nestjs/common';
import { ApiBearerAuth, ApiOperation, ApiTags } from '@nestjs/swagger';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard';
import { CurrentUser } from '../auth/decorators/current-user.decorator';
import type { SessionUser } from '../../lib/supabase';
import { GhlService } from '../ghl/ghl.service';
import { HumanEscalationSettingsService } from './human-escalation-settings.service';

@ApiTags('human-escalation-settings')
@ApiBearerAuth()
@UseGuards(JwtAuthGuard)
@Controller('tenants/:tenantId/human-escalation-settings')
export class HumanEscalationSettingsController {
  constructor(
    private readonly humanEscalationSettingsService: HumanEscalationSettingsService,
    private readonly ghlService: GhlService,
  ) {}

  @Get()
  @ApiOperation({ summary: 'Get tenant human escalation automation settings' })
  async get(@Param('tenantId') tenantId: string, @CurrentUser() user: SessionUser) {
    await this.ghlService.ensureTenantAccessOrThrow(tenantId, user.id);
    return this.humanEscalationSettingsService.getSettings(tenantId);
  }

  @Patch()
  @ApiOperation({ summary: 'Update tenant human escalation automation settings' })
  async patch(
    @Param('tenantId') tenantId: string,
    @CurrentUser() user: SessionUser,
    @Body()
    body: Partial<{
      enabled: boolean;
      teamNotificationNumber: string | null;
      optionalMessagePrefix: string | null;
    }>,
  ) {
    await this.ghlService.ensureTenantAccessOrThrow(tenantId, user.id);
    return this.humanEscalationSettingsService.patchSettings(tenantId, body);
  }
}
