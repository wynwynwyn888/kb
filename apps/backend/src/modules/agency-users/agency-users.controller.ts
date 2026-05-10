// Agency Users controller — agency membership (JWT, agency-scoped)

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
import { AgencyUsersService } from './agency-users.service';
import { InvitationsService } from '../invitations/invitations.service';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard';
import { CurrentUser } from '../auth/decorators/current-user.decorator';
import type { SessionUser } from '../../lib/supabase';
import type { AgencyRole } from '../../lib/enums';

function bearerFromAuthHeader(authHeader: string | undefined): string {
  if (!authHeader) throw new UnauthorizedException('Missing authorization');
  const m = /^Bearer\s+/i.exec(authHeader);
  if (!m) throw new UnauthorizedException('Missing authorization');
  return authHeader.slice(m[0].length).trim();
}

@ApiTags('agency-users')
@ApiBearerAuth()
@UseGuards(JwtAuthGuard)
@Controller('agency-users')
export class AgencyUsersController {
  constructor(
    private readonly service: AgencyUsersService,
    private readonly invitations: InvitationsService,
  ) {}

  @Get()
  @ApiOperation({
    summary: 'List agency members',
    description:
      'Requires Bearer JWT. Caller must be a member of `agencyId`. Returns `agency_users` rows with profile email/full name when available.',
  })
  async findAll(
    @Query('agencyId') agencyId: string | undefined,
    @CurrentUser() user: SessionUser,
  ) {
    if (!agencyId?.trim()) {
      throw new BadRequestException('agencyId query parameter is required');
    }
    return this.service.listMembers(agencyId.trim(), user.id);
  }

  @Get('invites')
  @ApiOperation({ summary: 'List pending agency invites (admin)' })
  async listInvites(@Query('agencyId') agencyId: string | undefined, @CurrentUser() user: SessionUser) {
    if (!agencyId?.trim()) throw new BadRequestException('agencyId query parameter is required');
    return this.invitations.listAgencyInvites(user.id, agencyId.trim());
  }

  @Post('invites')
  @ApiOperation({ summary: 'Create agency team invite link (Supabase Auth invite)' })
  async createInvite(
    @Body() dto: { agencyId: string; email: string; role: 'ADMIN' | 'USER' },
    @CurrentUser() user: SessionUser,
  ) {
    if (!dto.agencyId?.trim()) throw new BadRequestException('agencyId is required');
    if (!dto.email?.trim()) throw new BadRequestException('email is required');
    if (dto.role !== 'ADMIN' && dto.role !== 'USER') throw new BadRequestException('role must be ADMIN or USER');
    return this.invitations.createAgencyInvite(user.id, dto.agencyId.trim(), dto.email.trim(), dto.role);
  }

  @Post('invites/:inviteId/accept')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: 'Accept agency invite (caller must be signed in as invited email)' })
  async acceptAgencyInvite(
    @Param('inviteId') inviteId: string,
    @Headers('authorization') authorization: string | undefined,
    @CurrentUser() user: SessionUser,
  ) {
    const token = bearerFromAuthHeader(authorization);
    return this.invitations.acceptAgencyInvite(user.id, inviteId, token);
  }

  @Post('members/:membershipId/password-reset-link')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: 'Generate password reset link for an agency member (admin)' })
  async agencyMemberResetLink(
    @Param('membershipId') membershipId: string,
    @Body() dto: { agencyId: string },
    @CurrentUser() user: SessionUser,
  ) {
    if (!dto.agencyId?.trim()) throw new BadRequestException('agencyId is required');
    return this.invitations.generateAgencyMemberRecoveryLink(user.id, dto.agencyId.trim(), membershipId);
  }

  @Post()
  @ApiOperation({
    summary: 'Add member to agency',
    description:
      'OWNER or ADMIN only. Only OWNER may assign the OWNER role. Send either `email` (user must already have a profile) or `profileId`, not both.',
  })
  async addUser(
    @Body() dto: { agencyId: string; role: AgencyRole; profileId?: string; email?: string },
    @CurrentUser() user: SessionUser,
  ) {
    if (!dto.agencyId?.trim()) {
      throw new BadRequestException('agencyId is required');
    }
    const pid = dto.profileId?.trim();
    const em = dto.email?.trim();
    if (pid && em) {
      throw new BadRequestException('Send either email or profileId, not both');
    }
    if (!pid && !em) {
      throw new BadRequestException('email or profileId is required');
    }
    AgencyUsersService.assertValidRole(dto.role);
    const profileId = pid ?? (await this.service.resolveProfileIdByEmail(em!));
    return this.service.addMember(user.id, {
      agencyId: dto.agencyId.trim(),
      profileId,
      role: dto.role,
    });
  }

  @Patch(':id/role')
  @ApiOperation({
    summary: 'Update member role',
    description:
      'OWNER or ADMIN only; only OWNER may set role to OWNER. Cannot demote the only OWNER.',
  })
  async updateRole(
    @Param('id') id: string,
    @Body() dto: { role: AgencyRole },
    @CurrentUser() user: SessionUser,
  ) {
    if (!dto.role) {
      throw new BadRequestException('role is required');
    }
    AgencyUsersService.assertValidRole(dto.role);
    return this.service.updateRole(id, dto.role, user.id);
  }

  @Delete(':id')
  @HttpCode(HttpStatus.NO_CONTENT)
  @ApiOperation({
    summary: 'Remove member from agency',
    description:
      'OWNER or ADMIN only. Cannot remove the sole OWNER.',
  })
  async remove(@Param('id') id: string, @CurrentUser() user: SessionUser) {
    await this.service.removeMember(id, user.id);
  }
}
