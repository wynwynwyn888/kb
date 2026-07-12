// Tenant Users controller — tenant membership (JWT, tenant-scoped)

import {
  BadRequestException,
  Body,
  Controller,
  Delete,
  Get,
  Headers,
  HttpCode,
  HttpStatus,
  Param,
  Patch,
  Post,
  Query,
  UnauthorizedException,
  UseGuards,
} from '@nestjs/common';
import { ApiTags, ApiBearerAuth, ApiOperation } from '@nestjs/swagger';
import { TenantUsersService } from './tenant-users.service';
import { InvitationsService } from '../invitations/invitations.service';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard';
import { CurrentUser } from '../auth/decorators/current-user.decorator';
import type { SessionUser } from '../../lib/supabase';
import type { TenantRole } from '../../lib/enums';

function bearerFromAuthHeader(authHeader: string | undefined): string {
  if (!authHeader) throw new UnauthorizedException('Missing authorization');
  const m = /^Bearer\s+/i.exec(authHeader);
  if (!m) throw new UnauthorizedException('Missing authorization');
  return authHeader.slice(m[0].length).trim();
}

@ApiTags('tenant-users')
@ApiBearerAuth()
@UseGuards(JwtAuthGuard)
@Controller('tenant-users')
export class TenantUsersController {
  constructor(
    private readonly service: TenantUsersService,
    private readonly invitations: InvitationsService,
  ) {}

  @Get()
  @ApiOperation({
    summary: 'List tenant members',
    description:
      'Requires Bearer JWT. Caller must be a member of `tenantId` or agency staff for that workspace. Returns `tenant_users` rows with profile email/full name when available.',
  })
  async findAll(
    @Query('tenantId') tenantId: string | undefined,
    @CurrentUser() user: SessionUser,
  ) {
    if (!tenantId?.trim()) {
      throw new BadRequestException('tenantId query parameter is required');
    }
    return this.service.listMembers(tenantId.trim(), user.id);
  }

  @Get('invites')
  @ApiOperation({ summary: 'List pending workspace invites' })
  async listInvites(@Query('tenantId') tenantId: string | undefined, @CurrentUser() user: SessionUser) {
    if (!tenantId?.trim()) {
      throw new BadRequestException('tenantId query parameter is required');
    }
    return this.invitations.listWorkspaceInvites(user.id, tenantId.trim());
  }

  @Post('invites')
  @ApiOperation({ summary: 'Create workspace invite link (Supabase Auth invite)' })
  async createInvite(
    @Body() dto: { tenantId: string; email: string; role: 'ADMIN' | 'USER' },
    @CurrentUser() user: SessionUser,
  ) {
    if (!dto.tenantId?.trim()) throw new BadRequestException('tenantId is required');
    if (!dto.email?.trim()) throw new BadRequestException('email is required');
    if (dto.role !== 'ADMIN' && dto.role !== 'USER') throw new BadRequestException('role must be ADMIN or USER');
    return this.invitations.createWorkspaceInvite(user.id, dto.tenantId.trim(), dto.email.trim(), dto.role);
  }

  @Post('invites/:inviteId/accept')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: 'Accept workspace invite (caller must be signed in as invited email)' })
  async acceptWorkspaceInvite(
    @Param('inviteId') inviteId: string,
    @Headers('authorization') authorization: string | undefined,
    @CurrentUser() user: SessionUser,
  ) {
    const token = bearerFromAuthHeader(authorization);
    return this.invitations.acceptWorkspaceInvite(user.id, inviteId, token);
  }

  @Post('invites/:inviteId/resend')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: 'Re-send a pending workspace invite email' })
  async resendWorkspaceInvite(
    @Param('inviteId') inviteId: string,
    @Body() dto: { tenantId: string },
    @CurrentUser() user: SessionUser,
  ) {
    if (!dto.tenantId?.trim()) throw new BadRequestException('tenantId is required');
    return this.invitations.resendWorkspaceInvite(user.id, dto.tenantId.trim(), inviteId);
  }

  @Delete('invites/:inviteId')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: 'Revoke a pending workspace invite. Only PENDING invites can be revoked.' })
  async revokeWorkspaceInvite(
    @Param('inviteId') inviteId: string,
    @Query('tenantId') tenantId: string | undefined,
    @CurrentUser() user: SessionUser,
  ) {
    if (!tenantId?.trim()) throw new BadRequestException('tenantId is required');
    return this.invitations.revokeWorkspaceInvite(user.id, tenantId.trim(), inviteId);
  }

  @Post('members/:membershipId/password-reset-link')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: 'Generate password reset link for a workspace member' })
  async workspaceMemberResetLink(
    @Param('membershipId') membershipId: string,
    @Body() dto: { tenantId: string },
    @CurrentUser() user: SessionUser,
  ) {
    if (!dto.tenantId?.trim()) throw new BadRequestException('tenantId is required');
    return this.invitations.generateTenantMemberRecoveryLink(user.id, dto.tenantId.trim(), membershipId);
  }

  @Post()
  @ApiOperation({
    summary: 'Add member to tenant',
    description:
      'Tenant ADMIN only. Only ADMIN may assign the ADMIN role. `profileId` must exist in `profiles`.',
  })
  async addUser(
    @Body() dto: { tenantId: string; profileId: string; role: TenantRole },
    @CurrentUser() user: SessionUser,
  ) {
    if (!dto.tenantId?.trim()) {
      throw new BadRequestException('tenantId is required');
    }
    if (!dto.profileId?.trim()) {
      throw new BadRequestException('profileId is required');
    }
    TenantUsersService.assertValidRole(dto.role);
    return this.service.addMember(user.id, {
      tenantId: dto.tenantId.trim(),
      profileId: dto.profileId.trim(),
      role: dto.role,
    });
  }

  @Patch(':id/role')
  @ApiOperation({
    summary: 'Update member role',
    description:
      'Tenant ADMIN only; only ADMIN may set role to ADMIN. Cannot demote the only ADMIN.',
  })
  async updateRole(
    @Param('id') id: string,
    @Body() dto: { role: TenantRole },
    @CurrentUser() user: SessionUser,
  ) {
    if (!dto.role) {
      throw new BadRequestException('role is required');
    }
    TenantUsersService.assertValidRole(dto.role);
    return this.service.updateRole(id, dto.role, user.id);
  }

  @Delete(':id')
  @HttpCode(HttpStatus.NO_CONTENT)
  @ApiOperation({
    summary: 'Remove member from tenant',
    description: 'Tenant ADMIN only. Cannot remove the sole ADMIN.',
  })
  async remove(@Param('id') id: string, @CurrentUser() user: SessionUser) {
    await this.service.removeMember(id, user.id);
  }
}
