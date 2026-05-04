// Prompts controller — tenant prompt configs & agency policies (JWT, scoped)

import {
  BadRequestException,
  Body,
  Controller,
  Delete,
  Get,
  HttpCode,
  Param,
  Patch,
  Post,
  UseGuards,
} from '@nestjs/common';
import { ApiTags, ApiBearerAuth, ApiOperation } from '@nestjs/swagger';
import { PromptsService } from './prompts.service';
import { BotProfilesService } from './bot-profiles.service';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard';
import { CurrentUser } from '../auth/decorators/current-user.decorator';
import type { SessionUser } from '../../lib/supabase';

@ApiTags('prompts')
@ApiBearerAuth()
@UseGuards(JwtAuthGuard)
@Controller('prompts')
export class PromptsController {
  constructor(
    private readonly promptsService: PromptsService,
    private readonly botProfilesService: BotProfilesService,
  ) {}

  @Get('tenant/:tenantId')
  @ApiOperation({
    summary: 'List tenant prompt configs',
    description:
      'Requires membership on the tenant (or agency membership for that tenant\'s agency).',
  })
  async getTenantPrompts(
    @Param('tenantId') tenantId: string,
    @CurrentUser() user: SessionUser,
  ) {
    if (!tenantId?.trim()) {
      throw new BadRequestException('tenantId is required');
    }
    return this.promptsService.listTenantPrompts(tenantId.trim(), user.id);
  }

  @Post('tenant')
  @ApiOperation({
    summary: 'Create or update tenant prompt config',
    description:
      'Upserts by `(tenantId, name)`. Requires tenant ADMIN or agency OWNER/ADMIN for the tenant\'s agency.',
  })
  async upsertTenantPrompt(
    @Body()
    dto: {
      tenantId: string;
      name: string;
      systemPrompt: string;
      temperature?: number;
      modelOverride?: string;
      maxTokens?: number;
      promptVariables?: Record<string, unknown>;
      isActive?: boolean;
    },
    @CurrentUser() user: SessionUser,
  ) {
    if (!dto.tenantId?.trim()) {
      throw new BadRequestException('tenantId is required');
    }
    if (!dto.name?.trim()) {
      throw new BadRequestException('name is required');
    }
    if (dto.systemPrompt === undefined || dto.systemPrompt === null) {
      throw new BadRequestException('systemPrompt is required');
    }
    return this.promptsService.upsertTenantPrompt(user.id, {
      tenantId: dto.tenantId.trim(),
      name: dto.name.trim(),
      systemPrompt: dto.systemPrompt,
      temperature: dto.temperature,
      modelOverride: dto.modelOverride,
      maxTokens: dto.maxTokens,
      promptVariables: dto.promptVariables,
      isActive: dto.isActive,
    });
  }

  @Get('tenant/:tenantId/bot-profiles')
  @ApiOperation({ summary: 'List Assistant / Bot profiles for a workspace' })
  async listBotProfiles(@Param('tenantId') tenantId: string, @CurrentUser() user: SessionUser) {
    if (!tenantId?.trim()) throw new BadRequestException('tenantId is required');
    return this.botProfilesService.listBotProfiles(user.id, tenantId.trim());
  }

  @Post('tenant/:tenantId/bot-profiles')
  @ApiOperation({ summary: 'Create a new Assistant / Bot profile' })
  async createBotProfile(
    @Param('tenantId') tenantId: string,
    @Body()
    body: {
      name: string;
      description?: string;
      persona?: string;
      conversationGoals?: string;
      businessNotes?: string;
      toneRules?: string;
      bookingBehaviorNotes?: string;
      escalationBehaviorNotes?: string;
      knowledgeScopeNotes?: string;
      knowledgeScopeMode?: string;
      temperature?: number;
      modelOverride?: string | null;
      maxTokens?: number | null;
      setActive?: boolean;
    },
    @CurrentUser() user: SessionUser,
  ) {
    if (!tenantId?.trim()) throw new BadRequestException('tenantId is required');
    return this.botProfilesService.createBotProfile(user.id, tenantId.trim(), body);
  }

  @Patch('tenant/:tenantId/bot-profiles/:profileId')
  @ApiOperation({ summary: 'Update an Assistant / Bot profile' })
  async updateBotProfile(
    @Param('tenantId') tenantId: string,
    @Param('profileId') profileId: string,
    @Body()
    body: {
      name?: string;
      description?: string;
      persona?: string;
      conversationGoals?: string;
      businessNotes?: string;
      toneRules?: string;
      bookingBehaviorNotes?: string;
      escalationBehaviorNotes?: string;
      knowledgeScopeNotes?: string;
      knowledgeScopeMode?: string;
      temperature?: number;
      modelOverride?: string | null;
      maxTokens?: number | null;
    },
    @CurrentUser() user: SessionUser,
  ) {
    if (!tenantId?.trim() || !profileId?.trim()) {
      throw new BadRequestException('tenantId and profileId are required');
    }
    return this.botProfilesService.updateBotProfile(user.id, tenantId.trim(), profileId.trim(), body);
  }

  @Post('tenant/:tenantId/bot-profiles/:profileId/activate')
  @ApiOperation({ summary: 'Set an Assistant / Bot profile as the active one' })
  async activateBotProfile(
    @Param('tenantId') tenantId: string,
    @Param('profileId') profileId: string,
    @CurrentUser() user: SessionUser,
  ) {
    if (!tenantId?.trim() || !profileId?.trim()) {
      throw new BadRequestException('tenantId and profileId are required');
    }
    return this.botProfilesService.setActiveBotProfile(user.id, tenantId.trim(), profileId.trim());
  }

  @Post('tenant/:tenantId/bot-profiles/:profileId/duplicate')
  @ApiOperation({ summary: 'Duplicate an Assistant / Bot profile' })
  async duplicateBotProfile(
    @Param('tenantId') tenantId: string,
    @Param('profileId') profileId: string,
    @CurrentUser() user: SessionUser,
  ) {
    if (!tenantId?.trim() || !profileId?.trim()) {
      throw new BadRequestException('tenantId and profileId are required');
    }
    return this.botProfilesService.duplicateBotProfile(user.id, tenantId.trim(), profileId.trim());
  }

  @Delete('tenant/:tenantId/bot-profiles/:profileId')
  @HttpCode(204)
  @ApiOperation({ summary: 'Delete a non-active Assistant / Bot profile' })
  async deleteBotProfile(
    @Param('tenantId') tenantId: string,
    @Param('profileId') profileId: string,
    @CurrentUser() user: SessionUser,
  ): Promise<void> {
    if (!tenantId?.trim() || !profileId?.trim()) {
      throw new BadRequestException('tenantId and profileId are required');
    }
    await this.botProfilesService.deleteBotProfile(user.id, tenantId.trim(), profileId.trim());
  }

  @Get('policy/:agencyId')
  @ApiOperation({
    summary: 'List agency system policies',
    description: 'Requires agency membership.',
  })
  async getPolicies(
    @Param('agencyId') agencyId: string,
    @CurrentUser() user: SessionUser,
  ) {
    if (!agencyId?.trim()) {
      throw new BadRequestException('agencyId is required');
    }
    return this.promptsService.listAgencyPolicies(agencyId.trim(), user.id);
  }

  @Post('policy')
  @ApiOperation({
    summary: 'Create or update agency policy',
    description:
      'Upserts by `(agencyId, name)`. Requires agency OWNER or ADMIN.',
  })
  async upsertPolicy(
    @Body()
    dto: {
      agencyId: string;
      name: string;
      content: string;
      priority?: number;
      isDefault?: boolean;
      /** Update this policy row in place (including renames). Omit to upsert by `(agencyId, name)`. */
      policyId?: string | null;
    },
    @CurrentUser() user: SessionUser,
  ) {
    if (!dto.agencyId?.trim()) {
      throw new BadRequestException('agencyId is required');
    }
    if (!dto.name?.trim()) {
      throw new BadRequestException('name is required');
    }
    if (dto.content === undefined || dto.content === null) {
      throw new BadRequestException('content is required');
    }
    return this.promptsService.upsertAgencyPolicy(user.id, {
      agencyId: dto.agencyId.trim(),
      name: dto.name.trim(),
      content: dto.content,
      priority: dto.priority,
      isDefault: dto.isDefault,
      policyId: dto.policyId,
    });
  }

  @Delete('policy/:agencyId/:policyId')
  @HttpCode(204)
  @ApiOperation({
    summary: 'Delete agency system policy',
    description: 'Removes one policy row. Requires agency OWNER or ADMIN.',
  })
  async deletePolicy(
    @Param('agencyId') agencyId: string,
    @Param('policyId') policyId: string,
    @CurrentUser() user: SessionUser,
  ): Promise<void> {
    if (!agencyId?.trim() || !policyId?.trim()) {
      throw new BadRequestException('agencyId and policyId are required');
    }
    await this.promptsService.deleteAgencyPolicy(user.id, agencyId.trim(), policyId.trim());
  }
}
