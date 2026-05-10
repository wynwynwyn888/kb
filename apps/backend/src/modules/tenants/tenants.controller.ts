// Tenants controller

import {
  BadRequestException,
  Body,
  Controller,
  Delete,
  Get,
  Param,
  Patch,
  Post,
  UseGuards,
} from '@nestjs/common';
import { ApiTags, ApiBearerAuth, ApiOperation } from '@nestjs/swagger';
import { BotTestService } from './bot-test.service';
import { BotTestBodyDto } from './dto/bot-test-body.dto';
import { TenantsService } from './tenants.service';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard';
import { CurrentUser } from '../auth/decorators/current-user.decorator';
import type { SessionUser } from '../../lib/supabase';

@ApiTags('tenants')
@ApiBearerAuth()
@UseGuards(JwtAuthGuard)
@Controller('tenants')
export class TenantsController {
  constructor(
    private readonly tenantsService: TenantsService,
    private readonly botTestService: BotTestService,
  ) {}

  @Post()
  @ApiOperation({ summary: 'Create workspace (agency staff)' })
  async create(
    @CurrentUser() user: SessionUser,
    @Body()
    body: {
      agencyId: string;
      name: string;
      ghlLocationId?: string | null;
      annualPlanDurationMonths?: number;
      initialCredits?: number;
      clientContactName?: string | null;
      clientContactPhone?: string | null;
      clientContactEmail?: string | null;
    },
  ) {
    if (!user?.id) {
      throw new BadRequestException('User required');
    }
    if (!body?.agencyId) {
      throw new BadRequestException('agencyId is required');
    }
    return this.tenantsService.createTenant(body.agencyId, user.id, body);
  }

  @Patch(':id')
  @ApiOperation({
    summary: 'Update workspace: rename (agency staff) and/or bot operating mode (anyone with access)',
  })
  async patchTenant(
    @Param('id') id: string,
    @CurrentUser() user: SessionUser,
    @Body() body: { name?: string; botMode?: 'off' | 'suggestive' | 'autopilot' },
  ) {
    if (!user?.id) {
      return null;
    }
    if (body?.name === undefined && body?.botMode === undefined) {
      throw new BadRequestException('Provide at least one of: name, botMode');
    }
    return this.tenantsService.updateTenant(id, user.id, {
      name: body.name,
      botMode: body.botMode,
    });
  }

  @Patch(':id/client-profile')
  @ApiOperation({
    summary: 'Update workspace client contact profile (agency staff). Used by automated low-credit warnings.',
  })
  async patchClientProfile(
    @Param('id') id: string,
    @CurrentUser() user: SessionUser,
    @Body()
    body: {
      clientContactName?: string | null;
      clientContactPhone?: string | null;
      clientContactEmail?: string | null;
    },
  ) {
    if (!user?.id) throw new BadRequestException('User required');
    if (
      body?.clientContactName === undefined &&
      body?.clientContactPhone === undefined &&
      body?.clientContactEmail === undefined
    ) {
      throw new BadRequestException('Provide at least one client profile field');
    }
    return this.tenantsService.updateClientProfile(id, user.id, body);
  }

  @Post('agency/:agencyId/system-workspace')
  @ApiOperation({
    summary: 'Ensure the single agency system workspace exists (idempotent). Returns the workspace summary.',
  })
  async ensureAgencyWorkspace(
    @Param('agencyId') agencyId: string,
    @CurrentUser() user: SessionUser,
  ) {
    if (!user?.id) throw new BadRequestException('User required');
    if (!agencyId?.trim()) throw new BadRequestException('agencyId is required');
    return this.tenantsService.ensureAgencySystemWorkspaceForActor(agencyId, user.id);
  }

  @Delete(':id')
  @ApiOperation({ summary: 'Delete workspace (agency staff); rejected for the agency system workspace.' })
  async remove(@Param('id') id: string, @CurrentUser() user: SessionUser) {
    if (!user?.id) {
      throw new BadRequestException('User required');
    }
    await this.tenantsService.deleteTenant(id, user.id);
    return { ok: true, id };
  }

  @Get('me')
  @ApiOperation({ summary: 'Get tenants for current user' })
  async getMyTenants(@CurrentUser() user: SessionUser) {
    return this.tenantsService.getTenantsForUser(user.id);
  }

  @Get('agency/:agencyId')
  @ApiOperation({ summary: 'Get all tenants for an agency' })
  async getAgencyTenants(
    @Param('agencyId') agencyId: string,
    @CurrentUser() user: SessionUser
  ) {
    return this.tenantsService.getTenantsByAgency(agencyId, user.id);
  }

  @Post(':id/bot-test')
  @ApiOperation({ summary: 'Test bot: real generation (agency policy + subaccount prompt + KB; not live chat)' })
  async botTest(
    @Param('id') id: string,
    @CurrentUser() user: SessionUser,
    @Body() body: BotTestBodyDto,
  ) {
    if (!user?.id) {
      throw new BadRequestException('User required');
    }
    return this.botTestService.runTest(id, user.id, body);
  }

  @Get(':id')
  @ApiOperation({ summary: 'Get tenant by ID with prompt and quota info' })
  async findOne(@Param('id') id: string, @CurrentUser() user: SessionUser) {
    const tenant = await this.tenantsService.getTenantById(id, user.id);
    if (!tenant) {
      return null;
    }
    return tenant;
  }

  @Get(':id/prompt')
  @ApiOperation({ summary: 'Get active prompt config for tenant' })
  async getTenantPrompt(@Param('id') id: string, @CurrentUser() user: SessionUser) {
    const tenant = await this.tenantsService.getTenantById(id, user.id);
    return tenant?.promptConfig || null;
  }

  @Get(':id/quota')
  @ApiOperation({ summary: 'Get quota status for tenant' })
  async getTenantQuota(@Param('id') id: string, @CurrentUser() user: SessionUser) {
    const tenant = await this.tenantsService.getTenantById(id, user.id);
    return tenant?.quota || null;
  }

  @Get(':id/summary')
  @ApiOperation({ summary: 'Get tenant summary with all details' })
  async getTenantSummary(@Param('id') id: string, @CurrentUser() user: SessionUser) {
    return this.tenantsService.getTenantById(id, user.id);
  }
}
