import { Body, Controller, Delete, Get, Param, Patch, Post, UseGuards } from '@nestjs/common';
import { ApiBearerAuth, ApiOperation, ApiTags } from '@nestjs/swagger';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard';
import { CurrentUser } from '../auth/decorators/current-user.decorator';
import type { SessionUser } from '../../lib/supabase';
import { GhlService } from '../ghl/ghl.service';
import { TagRulesService } from './tag-rules.service';
import { TagRuleMatchService } from './tag-rule-match.service';

@ApiTags('tenant-tagging')
@ApiBearerAuth()
@UseGuards(JwtAuthGuard)
@Controller('tenants/:tenantId')
export class TenantTaggingController {
  constructor(
    private readonly tagRulesService: TagRulesService,
    private readonly tagRuleMatchService: TagRuleMatchService,
    private readonly ghlService: GhlService,
  ) {}

  @Get('tagging-settings')
  @ApiOperation({ summary: 'Get automatic tagging master toggle' })
  async getTaggingSettings(@Param('tenantId') tenantId: string, @CurrentUser() user: SessionUser) {
    await this.ghlService.ensureTenantAccessOrThrow(tenantId, user.id);
    return this.tagRulesService.getTaggingSettings(tenantId);
  }

  @Patch('tagging-settings')
  @ApiOperation({ summary: 'Update automatic tagging master toggle' })
  async patchTaggingSettings(
    @Param('tenantId') tenantId: string,
    @CurrentUser() user: SessionUser,
    @Body() body: { automaticTaggingEnabled?: boolean },
  ) {
    await this.ghlService.ensureTenantAccessOrThrow(tenantId, user.id);
    return this.tagRulesService.patchTaggingSettings(tenantId, body ?? {});
  }

  @Get('tag-rules')
  @ApiOperation({ summary: 'List CRM tag rules for this subaccount' })
  async listRules(@Param('tenantId') tenantId: string, @CurrentUser() user: SessionUser) {
    await this.ghlService.ensureTenantAccessOrThrow(tenantId, user.id);
    return this.tagRulesService.listRules(tenantId);
  }

  @Post('tag-rules')
  @ApiOperation({ summary: 'Create a tag rule' })
  async createRule(@Param('tenantId') tenantId: string, @CurrentUser() user: SessionUser, @Body() body: unknown) {
    await this.ghlService.ensureTenantAccessOrThrow(tenantId, user.id);
    return this.tagRulesService.createRule(tenantId, body);
  }

  @Post('tag-rules/sync-tags')
  @ApiOperation({ summary: 'Sync CRM tags for dropdowns' })
  async syncTags(@Param('tenantId') tenantId: string, @CurrentUser() user: SessionUser) {
    await this.ghlService.ensureTenantAccessOrThrow(tenantId, user.id);
    return this.tagRulesService.syncTags(tenantId, user.id);
  }

  @Post('tag-rules/test-tag')
  @ApiOperation({ summary: 'Apply a synced tag to a contact (smoke test)' })
  async testTag(
    @Param('tenantId') tenantId: string,
    @CurrentUser() user: SessionUser,
    @Body() body: { contactId?: string; tagName?: string },
  ) {
    await this.ghlService.ensureTenantAccessOrThrow(tenantId, user.id);
    return this.tagRulesService.testTag(tenantId, user.id, body ?? {});
  }

  @Post('tag-rules/test-match')
  @ApiOperation({ summary: 'Match customer message against enabled rules (no CRM write)' })
  async testMatch(
    @Param('tenantId') tenantId: string,
    @CurrentUser() user: SessionUser,
    @Body() body: { message?: string; ruleIds?: string[] },
  ) {
    await this.ghlService.ensureTenantAccessOrThrow(tenantId, user.id);
    return this.tagRuleMatchService.testMatch(tenantId, body?.message ?? '', {
      ruleIds: body?.ruleIds,
    });
  }

  @Patch('tag-rules/:ruleId')
  @ApiOperation({ summary: 'Update a tag rule' })
  async updateRule(
    @Param('tenantId') tenantId: string,
    @Param('ruleId') ruleId: string,
    @CurrentUser() user: SessionUser,
    @Body() body: unknown,
  ) {
    await this.ghlService.ensureTenantAccessOrThrow(tenantId, user.id);
    return this.tagRulesService.updateRule(tenantId, ruleId, body);
  }

  @Delete('tag-rules/:ruleId')
  @ApiOperation({ summary: 'Delete a tag rule' })
  async deleteRule(
    @Param('tenantId') tenantId: string,
    @Param('ruleId') ruleId: string,
    @CurrentUser() user: SessionUser,
  ) {
    await this.ghlService.ensureTenantAccessOrThrow(tenantId, user.id);
    return this.tagRulesService.deleteRule(tenantId, ruleId);
  }
}
