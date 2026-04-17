// Tenants controller

import { Controller, Get, Post, Patch, Delete, Body, Param } from '@nestjs/common';
import { ApiTags, ApiBearerAuth } from '@nestjs/swagger';
import { TenantsService } from './tenants.service';
import { CreateTenantDto, UpdateTenantDto } from '@aisbp/types';

@ApiTags('tenants')
@ApiBearerAuth()
@Controller('tenants')
export class TenantsController {
  constructor(private readonly tenantsService: TenantsService) {}

  @Post()
  async create(@Body() dto: CreateTenantDto) {
    // TODO: Implement
    throw new Error('Not implemented');
  }

  @Get()
  async findAll(@Body() { agencyId }: { agencyId: string }) {
    // TODO: Implement
    throw new Error('Not implemented');
  }

  @Get(':id')
  async findOne(@Param('id') id: string) {
    // TODO: Implement
    throw new Error('Not implemented');
  }

  @Patch(':id')
  async update(@Param('id') id: string, @Body() dto: UpdateTenantDto) {
    // TODO: Implement
    throw new Error('Not implemented');
  }

  @Delete(':id')
  async remove(@Param('id') id: string) {
    // TODO: Implement
    throw new Error('Not implemented');
  }
}