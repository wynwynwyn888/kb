// Agency AI Config controller - manage agency-level AI provider settings

import { Body, Controller, Get, NotFoundException, Patch, Post, ServiceUnavailableException, UseGuards } from '@nestjs/common';
import { ApiTags, ApiBearerAuth, ApiOperation } from '@nestjs/swagger';
import {
  AgencyAiConfigService,
  type SaveableProvider,
  type SaveAgencyAiConfigDto,
  type SubaccountBehaviorPolicy,
} from './agency-ai-config.service';
import { SaveAgencyAiConfigBodyDto, SetActiveProviderBodyDto } from './save-agency-ai-config.dto';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard';
import { CurrentAgencyId, CurrentUser } from '../auth/decorators/current-user.decorator';
import type { SessionUser } from '../../lib/supabase';

@ApiTags('agency-ai-config')
@ApiBearerAuth()
@UseGuards(JwtAuthGuard)
@Controller('agency-ai-config')
export class AgencyAiConfigController {
  constructor(private readonly configService: AgencyAiConfigService) {}

  @Get()
  @ApiOperation({ summary: 'Get agency AI provider config' })
  async getConfig(@CurrentAgencyId() agencyId: string | null) {
    if (!agencyId) {
      throw new NotFoundException('Agency context not found');
    }
    const config = await this.configService.getConfig(agencyId);
    if (!config) {
      throw new ServiceUnavailableException('Could not load agency AI settings. Retry in a moment.');
    }
    return config;
  }

  @Post()
  @ApiOperation({ summary: 'Save agency AI provider config' })
  async saveConfig(
    @CurrentAgencyId() agencyId: string | null,
    @CurrentUser() user: SessionUser,
    @Body() dto: SaveAgencyAiConfigBodyDto,
  ) {
    if (!agencyId) {
      throw new NotFoundException('Agency context not found');
    }
    return this.configService.saveConfig(agencyId, dto as SaveAgencyAiConfigDto, user.id);
  }

  @Patch('subaccount-behavior')
  @ApiOperation({ summary: 'Save limits for what subaccounts may set on their bot (governance)' })
  async saveSubaccountBehavior(
    @CurrentAgencyId() agencyId: string | null,
    @CurrentUser() user: SessionUser,
    @Body() body: SubaccountBehaviorPolicy,
  ) {
    if (!agencyId) {
      throw new NotFoundException('Agency context not found');
    }
    return this.configService.saveSubaccountBehaviorPolicy(agencyId, body, user.id);
  }

  @Patch('active')
  @ApiOperation({ summary: 'Set active AI provider without rotating API keys' })
  async setActive(
    @CurrentAgencyId() agencyId: string | null,
    @CurrentUser() user: SessionUser,
    @Body() body: SetActiveProviderBodyDto,
  ) {
    if (!agencyId) {
      throw new NotFoundException('Agency context not found');
    }
    return this.configService.setActiveProvider(agencyId, body.provider as SaveableProvider, user.id);
  }
}
