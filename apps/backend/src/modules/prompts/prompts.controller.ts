// Prompts controller

import { Controller, Get, Post, Patch, Delete, Body, Param } from '@nestjs/common';
import { ApiTags, ApiBearerAuth } from '@nestjs/swagger';
import { PromptsService } from './prompts.service';

@ApiTags('prompts')
@ApiBearerAuth()
@Controller('prompts')
export class PromptsController {
  constructor(private readonly promptsService: PromptsService) {}

  // Tenant prompt configs
  @Post('tenant')
  async createTenantPrompt(@Body() dto: {
    tenantId: string;
    name: string;
    systemPrompt: string;
    temperature?: number;
    modelOverride?: string;
    maxTokens?: number;
  }) {
    // TODO: Implement
    throw new Error('Not implemented');
  }

  @Get('tenant/:tenantId')
  async getTenantPrompts(@Param('tenantId') tenantId: string) {
    // TODO: Implement
    throw new Error('Not implemented');
  }

  @Patch(':id')
  async updatePrompt(@Param('id') id: string, @Body() dto: Record<string, unknown>) {
    // TODO: Implement
    throw new Error('Not implemented');
  }

  // Agency system policies
  @Post('policy')
  async createPolicy(@Body() dto: {
    agencyId: string;
    name: string;
    content: string;
    priority?: number;
    isDefault?: boolean;
  }) {
    // TODO: Implement
    throw new Error('Not implemented');
  }

  @Get('policy/:agencyId')
  async getPolicies(@Param('agencyId') agencyId: string) {
    // TODO: Implement
    throw new Error('Not implemented');
  }
}