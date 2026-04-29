import { Body, Controller, Get, Patch, Post, Param, UseGuards } from '@nestjs/common';
import { ApiBearerAuth, ApiOperation, ApiTags } from '@nestjs/swagger';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard';
import { CurrentUser } from '../auth/decorators/current-user.decorator';
import type { SessionUser } from '../../lib/supabase';
import { GhlService } from '../ghl/ghl.service';
import { IntentTagsService } from './intent-tags.service';

@ApiTags('intent-tags')
@ApiBearerAuth()
@UseGuards(JwtAuthGuard)
@Controller('tenants/:tenantId/intent-tag-rules')
export class IntentTagsController {
  constructor(
    private readonly intentTagsService: IntentTagsService,
    private readonly ghlService: GhlService,
  ) {}

  @Get()
  @ApiOperation({ summary: 'List MVP intent → GHL tag rules' })
  async get(@Param('tenantId') tenantId: string, @CurrentUser() user: SessionUser) {
    await this.ghlService.ensureTenantAccessOrThrow(tenantId, user.id);
    return this.intentTagsService.getIntentTagRules(tenantId);
  }

  @Patch()
  @ApiOperation({ summary: 'Upsert intent tag rules (MVP intent keys only)' })
  async patch(
    @Param('tenantId') tenantId: string,
    @CurrentUser() user: SessionUser,
    @Body() body: { rules: unknown[] },
  ) {
    await this.ghlService.ensureTenantAccessOrThrow(tenantId, user.id);
    return this.intentTagsService.patchIntentTagRules(tenantId, body);
  }

  @Post('sync-tags')
  @ApiOperation({ summary: 'List tags from GHL for dropdowns / validation' })
  async syncTags(@Param('tenantId') tenantId: string, @CurrentUser() user: SessionUser) {
    await this.ghlService.ensureTenantAccessOrThrow(tenantId, user.id);
    return this.intentTagsService.syncTags(tenantId, user.id);
  }

  @Post('test-tag')
  @ApiOperation({ summary: 'Apply a synced tag to a contact ( smoke test )' })
  async testTag(
    @Param('tenantId') tenantId: string,
    @CurrentUser() user: SessionUser,
    @Body() body: { contactId?: string; tagName?: string },
  ) {
    await this.ghlService.ensureTenantAccessOrThrow(tenantId, user.id);
    return this.intentTagsService.testTag(tenantId, user.id, body ?? {});
  }
}
