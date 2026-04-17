// Quotas controller

import { Controller, Get, Post, Body, Param } from '@nestjs/common';
import { ApiTags, ApiBearerAuth } from '@nestjs/swagger';
import { QuotasService } from './quotas.service';

@ApiTags('quotas')
@ApiBearerAuth()
@Controller('quotas')
export class QuotasController {
  constructor(private readonly quotasService: QuotasService) {}

  @Get('status/:tenantId')
  async getStatus(@Param('tenantId') tenantId: string) {
    // TODO: Implement
    throw new Error('Not implemented');
  }

  @Post('check')
  async check(@Body() dto: { tenantId: string; amount: number }) {
    // TODO: Implement
    throw new Error('Not implemented');
  }

  @Post('deduct')
  async deduct(@Body() dto: {
    tenantId: string;
    amount: number;
    conversationId?: string;
    description: string;
  }) {
    // TODO: Implement - deduct on successful outbound send
    throw new Error('Not implemented');
  }

  @Post('credit')
  async credit(@Body() dto: {
    tenantId: string;
    amount: number;
    description: string;
  }) {
    // TODO: Implement - add quota (admin function)
    throw new Error('Not implemented');
  }

  @Get('ledger/:tenantId')
  async getLedger(
    @Param('tenantId') tenantId: string,
    @Body() query?: { startDate?: string; endDate?: string; page?: number; pageSize?: number }
  ) {
    // TODO: Implement
    throw new Error('Not implemented');
  }

  @Post('set-quota')
  async setQuota(@Body() dto: {
    tenantId: string;
    totalQuota: number;
    periodStart: Date;
    periodEnd: Date;
  }) {
    // TODO: Implement - set quota allowance for period
    throw new Error('Not implemented');
  }
}