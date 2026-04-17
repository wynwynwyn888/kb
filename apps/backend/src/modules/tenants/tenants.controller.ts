// Tenants controller

import { Controller, Get, Post, Patch, Body, Param, UseGuards, Query } from '@nestjs/common';
import { ApiTags, ApiBearerAuth, ApiOperation } from '@nestjs/swagger';
import { TenantsService } from './tenants.service';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard';
import { CurrentUser } from '../auth/decorators/current-user.decorator';
import type { SessionUser } from '../../lib/supabase';

@ApiTags('tenants')
@ApiBearerAuth()
@UseGuards(JwtAuthGuard)
@Controller('tenants')
export class TenantsController {
  constructor(private readonly tenantsService: TenantsService) {}

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