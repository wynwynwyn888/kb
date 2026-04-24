// Audit controller

import { Controller, Get, Post, Body, Param, Query } from '@nestjs/common';
import { ApiTags, ApiOperation } from '@nestjs/swagger';
import { AuditService } from './audit.service';

const STUB_DESC =
  'Not implemented: handler throws. This controller has no JwtAuthGuard — endpoints are not Bearer-protected.';

@ApiTags('audit')
@Controller('audit')
export class AuditController {
  constructor(private readonly auditService: AuditService) {}

  @Get()
  @ApiOperation({
    summary: '[Stub] Query audit log',
    deprecated: true,
    description: STUB_DESC,
  })
  async findAll(
    @Query('agencyId') agencyId: string,
    @Query('tenantId') tenantId?: string,
    @Query('userId') userId?: string,
    @Query('startDate') startDate?: string,
    @Query('endDate') endDate?: string,
    @Query('page') page?: number,
    @Query('pageSize') pageSize?: number,
  ) {
    // TODO: Implement - agency-level access
    throw new Error('Not implemented');
  }

  @Get(':id')
  @ApiOperation({
    summary: '[Stub] Get audit entry',
    deprecated: true,
    description: STUB_DESC,
  })
  async findOne(@Param('id') id: string) {
    // TODO: Implement
    throw new Error('Not implemented');
  }

  @Post('log')
  @ApiOperation({
    summary: '[Stub] Create audit log',
    deprecated: true,
    description: STUB_DESC,
  })
  async createLog(@Body() dto: {
    agencyId: string;
    userId: string;
    tenantId?: string;
    action: string;
    resource: string;
    resourceId?: string;
    changes?: Record<string, unknown>;
    ipAddress?: string;
  }) {
    // TODO: Implement - used internally by other services
    throw new Error('Not implemented');
  }
}
