// Agency Users controller

import { Controller, Get, Post, Patch, Delete, Body, Param } from '@nestjs/common';
import { ApiTags, ApiBearerAuth } from '@nestjs/swagger';
import { AgencyUsersService } from './agency-users.service';

@ApiTags('agency-users')
@ApiBearerAuth()
@Controller('agency-users')
export class AgencyUsersController {
  constructor(private readonly service: AgencyUsersService) {}

  @Post()
  async addUser(@Body() dto: { userId: string; agencyId: string; role: string }) {
    // TODO: Implement
    throw new Error('Not implemented');
  }

  @Get()
  async findAll(@Body() { agencyId }: { agencyId: string }) {
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