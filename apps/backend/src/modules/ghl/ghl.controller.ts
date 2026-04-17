// GHL controller

import { Controller, Get, Post, Body, Query, Redirect } from '@nestjs/common';
import { ApiTags, ApiBearerAuth } from '@nestjs/swagger';
import { GhlService } from './ghl.service';

@ApiTags('ghl')
@ApiBearerAuth()
@Controller('ghl')
export class GhlController {
  constructor(private readonly ghlService: GhlService) {}

  @Get('oauth/connect')
  @Redirect()
  async connect(@Query('tenantId') tenantId: string) {
    // TODO: Generate OAuth URL and redirect to GHL
    throw new Error('Not implemented');
  }

  @Get('oauth/callback')
  @Redirect()
  async callback(@Query('code') code: string, @Query('locationId') locationId: string) {
    // TODO: Exchange code for tokens, store connection
    throw new Error('Not implemented');
  }

  @Post('disconnect')
  async disconnect(@Body() { tenantId }: { tenantId: string }) {
    // TODO: Revoke GHL connection for tenant
    throw new Error('Not implemented');
  }

  @Get('connection/:tenantId')
  async getConnection(@Body() { tenantId }: { tenantId: string }) {
    // TODO: Check connection status
    throw new Error('Not implemented');
  }
}