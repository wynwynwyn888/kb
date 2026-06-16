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
import { TenantsService } from '../tenants/tenants.service';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard';
import { CurrentAgencyId, CurrentUser } from '../auth/decorators/current-user.decorator';
import type { SessionUser } from '../../lib/supabase';
import { CreditWarningsService } from '../credit-warnings/credit-warnings.service';
import { ALL_LOW_CREDIT_WARNING_THRESHOLDS } from '../credit-warnings/credit-warnings.constants';
import { CreditResetRemindersService } from '../credit-reset-reminders/credit-reset-reminders.service';
import { ALL_CREDIT_RESET_REMINDER_DAYS } from '../credit-reset-reminders/credit-reset-reminders.constants';

@ApiTags('quotas')
@ApiBearerAuth()
@UseGuards(JwtAuthGuard)
@Controller('quotas')
export class QuotasController {
  constructor(
    private readonly quotasService: QuotasService,
    private readonly tenantsService: TenantsService,
    private readonly creditWarnings: CreditWarningsService,
    private readonly creditResetReminders: CreditResetRemindersService,
  ) {}

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

    await this.assertTenantScope(user, dto.tenantId);

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
    await this.assertTenantScope(user, tenantId);
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
    await this.assertTenantScope(user, tenantId);
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
    this.creditResetReminders.processAgencyReminders(agencyId);
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
  @ApiOperation({
    summary: 'Save agency credit settings for new workspaces',
    description:
      'Updates one or more agency-wide credit defaults (new workspace starting credits, deduction method, default overage / low-credit warning). Send any subset of fields.',
  })
  async setAgencyDefault(
    @CurrentAgencyId() agencyId: string | null,
    @CurrentUser() user: SessionUser,
    @Body()
    dto: {
      defaultSubaccountQuota?: number;
      deductionMethod?: 'PER_LOGICAL_REPLY' | 'PER_MESSAGE_BUBBLE';
      defaultAllowOverage?: boolean;
      defaultOverageLimit?: number;
      defaultLowCreditWarningEnabled?: boolean;
      defaultLowCreditWarningLevel?: number;
    },
  ) {
    if (!agencyId) throw new BadRequestException('Agency context required');
    const hasAny =
      dto.defaultSubaccountQuota !== undefined ||
      dto.deductionMethod !== undefined ||
      dto.defaultAllowOverage !== undefined ||
      dto.defaultOverageLimit !== undefined ||
      dto.defaultLowCreditWarningEnabled !== undefined ||
      dto.defaultLowCreditWarningLevel !== undefined;
    if (!hasAny) {
      throw new BadRequestException('Provide at least one field to save');
    }
    return this.quotasService.saveAgencyCreditSettings(agencyId, user.id, {
      defaultSubaccountQuota: dto.defaultSubaccountQuota,
      deductionMethod: dto.deductionMethod,
      defaultAllowOverage: dto.defaultAllowOverage,
      defaultOverageLimit: dto.defaultOverageLimit,
      defaultLowCreditWarningEnabled: dto.defaultLowCreditWarningEnabled,
      defaultLowCreditWarningLevel: dto.defaultLowCreditWarningLevel,
    });
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

  @Post('agency/wallet-plan')
  @ApiOperation({ summary: 'Update plan-level wallet metadata for a workspace (next reset date / annual allowance)' })
  async updateWalletPlan(
    @CurrentAgencyId() agencyId: string | null,
    @CurrentUser() user: SessionUser,
    @Body()
    dto: { tenantId: string; periodEnd?: string | null; periodStart?: string | null; totalQuota?: number },
  ) {
    if (!agencyId) throw new BadRequestException('Agency context required');
    if (!dto.tenantId?.trim()) throw new BadRequestException('tenantId is required');
    if (dto.periodEnd === undefined && dto.periodStart === undefined && dto.totalQuota === undefined) {
      throw new BadRequestException('Provide at least one plan field');
    }
    return this.quotasService.updateWalletPlan(agencyId, user.id, dto.tenantId, {
      periodEnd: dto.periodEnd,
      periodStart: dto.periodStart,
      totalQuota: dto.totalQuota,
    });
  }

  @Get('agency/low-credit-warning-settings')
  @ApiOperation({ summary: 'Read agency low-credit warning settings (thresholds + message + send toggle)' })
  async getWarningSettings(@CurrentAgencyId() agencyId: string | null, @CurrentUser() user: SessionUser) {
    if (!agencyId) throw new BadRequestException('Agency context required');
    await this.assertAgencyStaffViaQuotas(agencyId, user.id);
    const s = await this.creditWarnings.getAgencyLowCreditWarningSettings(agencyId);
    return { ...s, allowedThresholds: [...ALL_LOW_CREDIT_WARNING_THRESHOLDS] };
  }

  @Post('agency/low-credit-warning-settings')
  @ApiOperation({ summary: 'Save agency low-credit warning settings' })
  async saveWarningSettings(
    @CurrentAgencyId() agencyId: string | null,
    @CurrentUser() user: SessionUser,
    @Body()
    dto: {
      enabled?: boolean;
      thresholds?: number[];
      messageTemplate?: string;
      sendViaAgencyWorkspace?: boolean;
    },
  ) {
    if (!agencyId) throw new BadRequestException('Agency context required');
    await this.assertAgencyStaffViaQuotas(agencyId, user.id);
    if (
      dto.enabled === undefined &&
      dto.thresholds === undefined &&
      dto.messageTemplate === undefined &&
      dto.sendViaAgencyWorkspace === undefined
    ) {
      throw new BadRequestException('Provide at least one warning setting to save');
    }
    if (dto.thresholds !== undefined) {
      if (!Array.isArray(dto.thresholds)) throw new BadRequestException('thresholds must be an array');
      const allowed = new Set<number>(ALL_LOW_CREDIT_WARNING_THRESHOLDS as readonly number[]);
      for (const v of dto.thresholds) {
        if (typeof v !== 'number' || !allowed.has(v)) {
          throw new BadRequestException(
            `Each threshold must be one of ${[...allowed].join(', ')} credits`,
          );
        }
      }
    }
    const saved = await this.creditWarnings.saveAgencyLowCreditWarningSettings(agencyId, dto);
    return { ...saved, allowedThresholds: [...ALL_LOW_CREDIT_WARNING_THRESHOLDS] };
  }

  @Get('agency/credit-reset-reminder-settings')
  @ApiOperation({ summary: 'Read agency credit reset / expiry reminder settings' })
  async getResetReminderSettings(@CurrentAgencyId() agencyId: string | null, @CurrentUser() user: SessionUser) {
    if (!agencyId) throw new BadRequestException('Agency context required');
    await this.assertAgencyStaffViaQuotas(agencyId, user.id);
    const s = await this.creditResetReminders.getAgencySettings(agencyId);
    return { ...s, allowedDaysBefore: [...ALL_CREDIT_RESET_REMINDER_DAYS] };
  }

  @Post('agency/credit-reset-reminder-settings')
  @ApiOperation({ summary: 'Save agency credit reset / expiry reminder settings' })
  async saveResetReminderSettings(
    @CurrentAgencyId() agencyId: string | null,
    @CurrentUser() user: SessionUser,
    @Body()
    dto: {
      enabled?: boolean;
      daysBefore?: number[];
      messageTemplate?: string;
      sendViaAgencyWorkspace?: boolean;
    },
  ) {
    if (!agencyId) throw new BadRequestException('Agency context required');
    await this.assertAgencyStaffViaQuotas(agencyId, user.id);
    if (
      dto.enabled === undefined &&
      dto.daysBefore === undefined &&
      dto.messageTemplate === undefined &&
      dto.sendViaAgencyWorkspace === undefined
    ) {
      throw new BadRequestException('Provide at least one reset reminder setting to save');
    }
    if (dto.daysBefore !== undefined) {
      if (!Array.isArray(dto.daysBefore)) throw new BadRequestException('daysBefore must be an array');
      const allowed = new Set<number>(ALL_CREDIT_RESET_REMINDER_DAYS as readonly number[]);
      for (const v of dto.daysBefore) {
        if (typeof v !== 'number' || !allowed.has(v)) {
          throw new BadRequestException(`Each reminder day must be one of ${[...allowed].join(', ')}`);
        }
      }
    }
    const saved = await this.creditResetReminders.saveAgencySettings(agencyId, dto);
    return { ...saved, allowedDaysBefore: [...ALL_CREDIT_RESET_REMINDER_DAYS] };
  }

  /**
   * Reuse the existing agency-staff guard in quotas (avoids double-membership round-trip).
   * Wraps `getAgencyQuotaSettings` since it already throws ForbiddenException on non-members.
   */
  private async assertAgencyStaffViaQuotas(agencyId: string, profileId: string): Promise<void> {
    await this.quotasService.getAgencyQuotaSettings(agencyId, profileId);
  }

  /** Tenant-scoped routes require tenant membership or same-agency staff. */
  private async assertTenantScope(user: SessionUser, effectiveTenantId: string): Promise<void> {
    const ok = await this.tenantsService.checkTenantAccess(effectiveTenantId, user.id);
    if (!ok) {
      throw new NotFoundException('Not found');
    }
  }
}
