// Tenant Users controller

import { Controller, Get, Post, Patch, Delete, Body, Param } from '@nestjs/common';
import { ApiTags, ApiBearerAuth } from '@nestjs/swagger';
import { TenantUsersService } from './tenant-users.service';

@ApiTags('tenant-users')
@ApiBearerAuth()
@Controller('tenant-users')
export class TenantUsersController {
  constructor(private readonly service: TenantUsersService) {}

  @Post()
  async addUser(@Body() dto: { userId: string; tenantId: string; role: string }) {
    // TODO: Implement
    throw new Error('Not implemented');
  }

  @Get()
  async findAll(@Body() { tenantId }: { tenantId: string }) {
    // TODO: Implement
    throw new Error('Not implemented');
  }

  @Patch(':id/role')
  async updateRole(@Param('id') id: string, @Body() dto: { role: string }) {
    // TODO: Implement
    throw new Error('Not implemented');
  }

  @Delete(':id')
  async remove(@Param('id') id: string) {
    // TODO: Implement
    throw new Error('Not implemented');
  }
}