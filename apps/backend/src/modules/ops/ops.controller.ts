import { Controller, Get, Post, Param, Query, UseGuards, ForbiddenException, Req, NotFoundException, HttpCode, HttpStatus } from '@nestjs/common';
import { ApiBearerAuth, ApiOperation, ApiTags } from '@nestjs/swagger';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard';
import { OpsService } from './ops.service';
import type { Request } from 'express';
import type { SessionUser } from '../../lib/supabase';

@ApiTags('ops')
@ApiBearerAuth()
@UseGuards(JwtAuthGuard)
@Controller('ops')
export class OpsController {
  constructor(private readonly opsService: OpsService) {}

  private assertAgency(req: Request): SessionUser {
    const user = req.user as SessionUser | undefined;
    if (!user?.agencyRole || !user.agencyId) {
      throw new ForbiddenException('Agency membership required');
    }
    return user;
  }

  private assertPlatformAdmin(req: Request): SessionUser {
    const user = req.user as SessionUser | undefined;
    const allowed = new Set(
      (process.env['PLATFORM_ADMIN_PROFILE_IDS'] ?? '')
        .split(',')
        .map(value => value.trim())
        .filter(Boolean),
    );
    if (!user?.id || !allowed.has(user.id)) {
      throw new ForbiddenException('Platform admin access required');
    }
    return user;
  }

  @Get('health')
  @ApiOperation({ summary: 'System health overview' })
  async getHealth(@Req() req: Request) {
    this.assertPlatformAdmin(req);
    return this.opsService.getHealth();
  }

  @Get('flags')
  @ApiOperation({ summary: 'Read-only runtime feature flags (no secrets)' })
  getFlags(@Req() req: Request) {
    this.assertPlatformAdmin(req);
    return this.opsService.getFlags();
  }

  @Get('outbound-sends')
  @ApiOperation({ summary: 'Outbound send ledger — paginated' })
  async getOutboundSends(
    @Req() req: Request,
    @Query('tenantId') tenantId?: string,
    @Query('status') status?: string,
    @Query('page') page?: number,
    @Query('pageSize') pageSize?: number,
  ) {
    const user = this.assertAgency(req);
    return this.opsService.getOutboundSends({
      agencyId: user.agencyId!,
      tenantId,
      status,
      page: Math.max(1, page ?? 1),
      pageSize: Math.min(100, Math.max(1, pageSize ?? 20)),
    });
  }

  @Get('conversations')
  @ApiOperation({ summary: 'Conversation health overview — paginated' })
  async getConversations(
    @Req() req: Request,
    @Query('tenantId') tenantId?: string,
    @Query('page') page?: number,
    @Query('pageSize') pageSize?: number,
  ) {
    const user = this.assertAgency(req);
    return this.opsService.getConversations({
      agencyId: user.agencyId!,
      tenantId,
      page: Math.max(1, page ?? 1),
      pageSize: Math.min(100, Math.max(1, pageSize ?? 20)),
    });
  }

  @Get('ghl-sync')
  @ApiOperation({ summary: 'GHL pre-reply context sync events — paginated' })
  async getGhlSync(
    @Req() req: Request,
    @Query('conversationId') conversationId?: string,
    @Query('page') page?: number,
    @Query('pageSize') pageSize?: number,
  ) {
    const user = this.assertAgency(req);
    return this.opsService.getGhlSync({
      agencyId: user.agencyId!,
      conversationId,
      page: Math.max(1, page ?? 1),
      pageSize: Math.min(250, Math.max(1, pageSize ?? 20)),
    });
  }

  @Get('errors')
  @ApiOperation({ summary: 'Recent error/warn events — paginated' })
  async getErrors(
    @Req() req: Request,
    @Query('tenantId') tenantId?: string,
    @Query('severity') severity?: string,
    @Query('page') page?: number,
    @Query('pageSize') pageSize?: number,
  ) {
    const user = this.assertAgency(req);
    return this.opsService.getErrors({
      agencyId: user.agencyId!,
      tenantId,
      severity,
      page: Math.max(1, page ?? 1),
      pageSize: Math.min(100, Math.max(1, pageSize ?? 20)),
    });
  }

  @Get('audit-events')
  @ApiOperation({ summary: 'Recent metrics/audit events — paginated' })
  async getAuditEvents(
    @Req() req: Request,
    @Query('tenantId') tenantId?: string,
    @Query('page') page?: number,
    @Query('pageSize') pageSize?: number,
  ) {
    const user = this.assertAgency(req);
    return this.opsService.getAuditEvents({
      agencyId: user.agencyId!,
      tenantId,
      page: Math.max(1, page ?? 1),
      pageSize: Math.min(100, Math.max(1, pageSize ?? 20)),
    });
  }

  @Get('tenants')
  @ApiOperation({ summary: 'Tenant readiness overview' })
  async getTenants(@Req() req: Request) {
    const user = this.assertAgency(req);
    return this.opsService.getTenants(user.agencyId!);
  }

  @Get('queues')
  @ApiOperation({ summary: 'BullMQ queue health' })
  async getQueues(@Req() req: Request) {
    this.assertPlatformAdmin(req);
    return this.opsService.getQueueHealth();
  }

  @Post('conversations/:id/clear-handover')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: 'Internal: clear active handover for a conversation (no outbound sent)' })
  async clearHandover(
    @Req() req: Request,
    @Param('id') conversationId: string,
  ) {
    const user = this.assertAgency(req);
    return this.opsService.clearHandover(conversationId, user.agencyId!, user.id);
  }
}
