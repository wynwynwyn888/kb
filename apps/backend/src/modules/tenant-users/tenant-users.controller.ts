// Tenant Users controller — tenant membership (JWT, tenant-scoped)

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
import { TenantUsersService } from './tenant-users.service';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard';
import { CurrentUser } from '../auth/decorators/current-user.decorator';
import type { SessionUser } from '../../lib/supabase';
import type { TenantRole } from '../../lib/enums';

@ApiTags('tenant-users')
@ApiBearerAuth()
@UseGuards(JwtAuthGuard)
@Controller('tenant-users')
export class TenantUsersController {
  constructor(private readonly service: TenantUsersService) {}

  @Get()
  @ApiOperation({
    summary: 'List tenant members',
    description:
      'Requires Bearer JWT. Caller must be a member of `tenantId`. Returns `tenant_users` rows with profile email/full name when available.',
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
