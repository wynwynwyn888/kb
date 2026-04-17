// GHL Controller - handles connection management endpoints
// Routes: GET, POST /tenants/:id/ghl/connection, verify, health

import { Controller, Get, Post, Delete, Body, Param, UseGuards, HttpCode, HttpStatus } from '@nestjs/common';
import { ApiTags, ApiBearerAuth, ApiOperation } from '@nestjs/swagger';
import { GhlService, SaveConnectionDto } from './ghl.service';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard';
import { CurrentUser } from '../auth/decorators/current-user.decorator';
import type { SessionUser } from '../../lib/supabase';

@ApiTags('ghl')
@ApiBearerAuth()
@UseGuards(JwtAuthGuard)
@Controller('tenants/:tenantId/ghl')
export class GhlController {
  constructor(private readonly ghlService: GhlService) {}

  @Get('connection')
  @ApiOperation({ summary: 'Get GHL connection status for tenant' })
  async getConnection(
    @Param('tenantId') tenantId: string,
    @CurrentUser() user: SessionUser
  ) {
    const status = await this.ghlService.getConnectionStatus(tenantId, user.id);
    if (!status) {
      return {
        connected: false,
        status: 'DISCONNECTED',
        ghlLocationId: null,
      };
    }
    return {
      connected: status.isConnected,
      status: status.status,
      ghlLocationId: status.ghlLocationId,
      verifiedAt: status.verifiedAt,
      lastHealthCheckAt: status.lastHealthCheckAt,
      lastError: status.lastError,
      maskToken: status.maskToken,
      metadata: status.metadata,
    };
  }

  @Post('connection')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: 'Save GHL connection for tenant' })
  async saveConnection(
    @Param('tenantId') tenantId: string,
    @Body() dto: SaveConnectionDto,
    @CurrentUser() user: SessionUser
  ) {
    const result = await this.ghlService.saveConnection(tenantId, user.id, dto);
    return {
      success: true,
      connected: result.isConnected,
      status: result.status,
      ghlLocationId: result.ghlLocationId,
      verifiedAt: result.verifiedAt,
      maskToken: result.maskToken,
      metadata: result.metadata,
    };
  }

  @Post('verify')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: 'Verify existing GHL connection' })
  async verifyConnection(
    @Param('tenantId') tenantId: string,
    @CurrentUser() user: SessionUser
  ) {
    return this.ghlService.verifyConnection(tenantId, user.id);
  }

  @Get('health')
  @ApiOperation({ summary: 'Health check GHL connection' })
  async healthCheck(
    @Param('tenantId') tenantId: string,
    @CurrentUser() user: SessionUser
  ) {
    return this.ghlService.healthCheck(tenantId, user.id);
  }

  @Delete('connection')
  @HttpCode(HttpStatus.NO_CONTENT)
  @ApiOperation({ summary: 'Disconnect GHL connection' })
  async deleteConnection(
    @Param('tenantId') tenantId: string,
    @CurrentUser() user: SessionUser
  ) {
    await this.ghlService.deleteConnection(tenantId, user.id);
  }
}