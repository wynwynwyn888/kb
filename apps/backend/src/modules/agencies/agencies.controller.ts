// Agencies controller

import { Controller, Get, Post, Patch, Delete, Body, Param } from '@nestjs/common';
import { ApiTags, ApiBearerAuth } from '@nestjs/swagger';
import { AgenciesService } from './agencies.service';
import { CreateAgencyDto, UpdateAgencyDto } from '@aisbp/types';

@ApiTags('agencies')
@ApiBearerAuth()
@Controller('agencies')
export class AgenciesController {
  constructor(private readonly agenciesService: AgenciesService) {}

  @Post()
  async create(@Body() dto: CreateAgencyDto) {
    // TODO: Implement
    throw new Error('Not implemented');
  }

  @Get()
  async findAll() {
    // TODO: Implement
    throw new Error('Not implemented');
  }

  @Get(':id')
  async findOne(@Param('id') id: string) {
    // TODO: Implement
    throw new Error('Not implemented');
  }

  @Patch(':id')
  async update(@Param('id') id: string, @Body() dto: UpdateAgencyDto) {
    // TODO: Implement
    throw new Error('Not implemented');
  }

  @Delete(':id')
  async remove(@Param('id') id: string) {
    // TODO: Implement
    throw new Error('Not implemented');
  }
}