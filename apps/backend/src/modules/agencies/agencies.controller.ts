// Agencies controller

import { Controller, Get, Post, Patch, Body, Param, UseGuards } from '@nestjs/common';
import { ApiTags, ApiBearerAuth, ApiOperation } from '@nestjs/swagger';
import { AgenciesService } from './agencies.service';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard';
import { CurrentUser } from '../auth/decorators/current-user.decorator';
import type { SessionUser } from '../../../lib/supabase';

@ApiTags('agencies')
@ApiBearerAuth()
@UseGuards(JwtAuthGuard)
@Controller('agencies')
export class AgenciesController {
  constructor(private readonly agenciesService: AgenciesService) {}

  @Get('me')
  @ApiOperation({ summary: 'Get current users agency' })
  async getMyAgency(@CurrentUser() user: SessionUser) {
    const agencies = await this.agenciesService.getAgenciesForUser(user.id);
    return agencies[0] || null;
  }

  @Get()
  @ApiOperation({ summary: 'Get all agencies for current user' })
  async findAll(@CurrentUser() user: SessionUser) {
    return this.agenciesService.getAgenciesForUser(user.id);
  }

  @Get(':id')
  @ApiOperation({ summary: 'Get agency by ID' })
  async findOne(@Param('id') id: string, @CurrentUser() user: SessionUser) {
    return this.agenciesService.getAgencyById(id, user.id);
  }
}