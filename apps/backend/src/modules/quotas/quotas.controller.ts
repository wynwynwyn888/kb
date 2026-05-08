// Quotas controller — minimal honest HTTP surface backed by QuotasService.checkQuota only.

import {
  Controller,
  Get,
  Post,
  Body,
  Param,
  Query,
  UseGuards,
  BadRequestException,
  NotFoundException,
  HttpCode,
  HttpStatus,
} from '@nestjs/common';
import { ApiTags, ApiBearerAuth, ApiOperation } from '@nestjs/swagger';
import { QuotasService } from './quotas.service';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard';
import { CurrentAgencyId, CurrentUser } from '../auth/decorators/current-user.decorator';
import type { SessionUser } from '../../lib/supabase';

@ApiTags('quotas')
@ApiBearerAuth()
@UseGuards(JwtAuthGuard)
@Controller('quotas')
export class QuotasController {
  constructor(private readonly quotasService: QuotasService) {}

  @Get('status/:tenantId')
  @ApiOperation({
    summary: 'Quota wallet status (not implemented)',
    deprecated: true,
    description:
      'Not implemented (throws). QuotasService.getStatus is not implemented; use tenants quota embed or wait for service support.',
  })
  async getStatus(@Param('tenantId') _tenantId: string) {
    throw new Error(
      'Not implemented: QuotasService.getStatus has no implementation yet.',
    );
  }

  @Post('check')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({
    summary: 'Check if tenant has at least `amount` quota remaining',
    description:
      'Uses QuotasService.checkQuota. If no quota_wallets row exists for the tenant, returns allowed=true (no tracking = treated as unlimited).',
  })
  async check(
    @Body() dto: { tenantId: string; amount: number },
    @CurrentUser() user: SessionUser,
  ) {
    if (!dto.tenantId?.trim()) {
      throw new BadRequestException('tenantId is required');
    }
    if (dto.amount === undefined || dto.amount === null) {
      throw new BadRequestException('amount is required');
    }
    if (typeof dto.amount !== 'number' || !Number.isFinite(dto.amount)) {
      throw new BadRequestException('amount must be a finite number');
    }
    if (dto.amount < 0) {
      throw new BadRequestException('amount must be >= 0');
    }

    this.assertTenantScope(user, dto.tenantId);

    const allowed = await this.quotasService.checkQuota(dto.tenantId, dto.amount);
    return {
      tenantId: dto.tenantId,
      amount: dto.amount,
      allowed,
    };
  }

  @Post('deduct')
  @ApiOperation({
    summary: 'Deduct quota (not implemented)',
    deprecated: true,
    description: 'Not implemented (throws). No ledger path on QuotasService yet.',
  })
  async deduct(
    @Body()
    _dto: {
      tenantId: string;
      amount: number;
      conversationId?: string;
      description: string;
    },
  ) {
    throw new Error(
      'Not implemented: QuotasService.deduct has no ledger/alert path yet.',
    );
  }

  @Post('credit')
  @ApiOperation({ summary: 'Credit quota (not implemented)' })
  async credit(
    @Body() _dto: { tenantId: string; amount: number; description: string },
  ) {
    throw new Error('Not implemented: QuotasService.credit has no ledger path yet.');
  }

  @Get('ledger/:tenantId')
  @ApiOperation({
    summary: 'Quota ledger (not implemented)',
    deprecated: true,
    description: 'Not implemented (throws). Ledger API not built.',
  })
  async getLedger(@Param('tenantId') _tenantId: string) {
    throw new Error('Not implemented: quota ledger API is not built yet.');
  }

  @Get('tenant/usage/:tenantId')
  @ApiOperation({ summary: 'Credits usage summary for tenant (client-safe)' })
  async tenantUsage(@Param('tenantId') tenantId: string, @CurrentUser() user: SessionUser) {
    if (!tenantId?.trim()) throw new BadRequestException('tenantId is required');
    this.assertTenantScope(user, tenantId);
    return this.quotasService.getTenantUsageSummary(tenantId);
  }

  @Get('tenant/ledger/:tenantId')
  @ApiOperation({ summary: 'Recent credits ledger (client-safe)' })
  async tenantLedger(
    @Param('tenantId') tenantId: string,
    @CurrentUser() user: SessionUser,
    @Query('limit') limitStr?: string,
  ) {
    if (!tenantId?.trim()) throw new BadRequestException('tenantId is required');
    this.assertTenantScope(user, tenantId);
    const limit = limitStr ? parseInt(limitStr, 10) : 50;
    return this.quotasService.getTenantLedger(tenantId, { limit });
  }

  @Get('agency/wallets')
  @ApiOperation({ summary: 'List subaccount credit wallets (agency staff)' })
  async agencyWallets(
    @CurrentAgencyId() agencyId: string | null,
    @CurrentUser() user: SessionUser,
    @Query('limit') limitStr?: string,
  ) {
    if (!agencyId) throw new BadRequestException('Agency context required');
    const limit = limitStr ? parseInt(limitStr, 10) : 200;
    return this.quotasService.listAgencyWallets(agencyId, user.id, { limit });
  }

  @Post('set-quota')
  @ApiOperation({
    summary: 'Set quota allowance (not implemented)',
    deprecated: true,
    description: 'Not implemented (throws). Not supported on QuotasService yet.',
  })
  async setQuota(
    @Body()
    _dto: {
      tenantId: string;
      totalQuota: number;
      periodStart: Date;
      periodEnd: Date;
    },
  ) {
    throw new Error('Not implemented: set-quota is not supported on QuotasService yet.');
  }

  @Post('agency/default')
  @ApiOperation({ summary: 'Set agency default quota for new subaccount wallets' })
  async setAgencyDefault(
    @CurrentAgencyId() agencyId: string | null,
    @CurrentUser() user: SessionUser,
    @Body() dto: { defaultSubaccountQuota: number },
  ) {
    if (!agencyId) throw new BadRequestException('Agency context required');
    if (dto.defaultSubaccountQuota === undefined) {
      throw new BadRequestException('defaultSubaccountQuota is required');
    }
    return this.quotasService.setAgencyDefaultQuota(agencyId, user.id, dto.defaultSubaccountQuota);
  }

  @Post('agency/topup')
  @ApiOperation({ summary: 'Top up a subaccount wallet (agency staff)' })
  async topup(
    @CurrentAgencyId() agencyId: string | null,
    @CurrentUser() user: SessionUser,
    @Body() dto: { tenantId: string; amount: number; note?: string },
  ) {
    if (!agencyId) throw new BadRequestException('Agency context required');
    if (!dto.tenantId?.trim()) throw new BadRequestException('tenantId is required');
    if (dto.amount == null) throw new BadRequestException('amount is required');
    return this.quotasService.topUpSubaccount(agencyId, user.id, dto.tenantId, dto.amount, dto.note);
  }

  @Post('agency/adjust')
  @ApiOperation({ summary: 'Manual credit adjustment (agency staff)' })
  async adjust(
    @CurrentAgencyId() agencyId: string | null,
    @CurrentUser() user: SessionUser,
    @Body() dto: { tenantId: string; delta: number; reason?: string },
  ) {
    if (!agencyId) throw new BadRequestException('Agency context required');
    if (!dto.tenantId?.trim()) throw new BadRequestException('tenantId is required');
    if (dto.delta == null) throw new BadRequestException('delta is required');
    return this.quotasService.adjustSubaccountCredits(agencyId, user.id, dto.tenantId, dto.delta, dto.reason);
  }

  @Post('agency/wallet-policy')
  @ApiOperation({ summary: 'Update subaccount wallet policy (agency staff)' })
  async policy(
    @CurrentAgencyId() agencyId: string | null,
    @CurrentUser() user: SessionUser,
    @Body() dto: { tenantId: string; allowNegativeCredits?: boolean; negativeCreditLimit?: number; lowCreditThreshold?: number },
  ) {
    if (!agencyId) throw new BadRequestException('Agency context required');
    if (!dto.tenantId?.trim()) throw new BadRequestException('tenantId is required');
    return this.quotasService.updateWalletPolicy(agencyId, user.id, dto.tenantId, {
      allowNegativeCredits: dto.allowNegativeCredits,
      negativeCreditLimit: dto.negativeCreditLimit,
      lowCreditThreshold: dto.lowCreditThreshold,
    });
  }

  @Get('agency/audit')
  @ApiOperation({ summary: 'Quota policy audit log for agency' })
  async audit(
    @CurrentAgencyId() agencyId: string | null,
    @CurrentUser() user: SessionUser,
    @Query('tenantId') tenantId?: string,
    @Query('limit') limitStr?: string,
  ) {
    if (!agencyId) throw new BadRequestException('Agency context required');
    const limit = limitStr ? parseInt(limitStr, 10) : 50;
    return this.quotasService.getQuotaAuditLog(agencyId, user.id, { tenantId, limit });
  }

  @Get('agency/settings')
  @ApiOperation({ summary: 'Read agency quota default setting' })
  async agencySettings(@CurrentAgencyId() agencyId: string | null, @CurrentUser() user: SessionUser) {
    if (!agencyId) throw new BadRequestException('Agency context required');
    return this.quotasService.getAgencyQuotaSettings(agencyId, user.id);
  }

  /** Tenant-scoped users may only act on their tenant; agency-only users are not restricted here (matches conversations). */
  private assertTenantScope(user: SessionUser, effectiveTenantId: string): void {
    if (user.tenantId && user.tenantId !== effectiveTenantId) {
      throw new NotFoundException('Not found');
    }
  }
}
