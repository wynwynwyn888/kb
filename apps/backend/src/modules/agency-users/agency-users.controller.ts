// Agency Users controller — agency membership (JWT, agency-scoped)

import {
  BadRequestException,
  Body,
  Controller,
  Delete,
  Get,
  HttpCode,
  HttpStatus,
  Param,
  Patch,
  Post,
  Query,
  UseGuards,
} from '@nestjs/common';
import { ApiTags, ApiBearerAuth, ApiOperation } from '@nestjs/swagger';
import { AgencyUsersService } from './agency-users.service';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard';
import { CurrentUser } from '../auth/decorators/current-user.decorator';
import type { SessionUser } from '../../lib/supabase';
import type { AgencyRole } from '../../lib/enums';

@ApiTags('agency-users')
@ApiBearerAuth()
@UseGuards(JwtAuthGuard)
@Controller('agency-users')
export class AgencyUsersController {
  constructor(private readonly service: AgencyUsersService) {}

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
