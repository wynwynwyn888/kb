// Agency AI Config controller - manage agency-level AI provider settings

import { Controller, Get, Post, Body, UseGuards, NotFoundException } from '@nestjs/common';
import { ApiTags, ApiBearerAuth, ApiOperation } from '@nestjs/swagger';
import { AgencyAiConfigService, SaveAgencyAiConfigDto } from './agency-ai-config.service';
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
    return config ?? { provider: 'OPENAI', enabled: false, defaultModel: 'gpt-4o-mini', hasApiKey: false };
  }

  @Post()
  @ApiOperation({ summary: 'Save agency AI provider config' })
  async saveConfig(
    @CurrentAgencyId() agencyId: string | null,
    @Body() dto: SaveAgencyAiConfigDto,
  ) {
    if (!agencyId) {
      throw new NotFoundException('Agency context not found');
    }
    return this.configService.saveConfig(agencyId, dto);
  }
}
