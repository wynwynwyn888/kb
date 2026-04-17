// Auth controller - handles authentication endpoints
// GET /auth/me - returns current user info

import { Controller, Get, Req, UseGuards, HttpCode, HttpStatus } from '@nestjs/common';
import { ApiTags, ApiBearerAuth, ApiOperation } from '@nestjs/swagger';
import { Request } from 'express';
import { AuthService } from './auth.service';
import { JwtAuthGuard } from './guards/jwt-auth.guard';
import { CurrentUser } from './decorators/current-user.decorator';
import type { SessionUser } from '../../lib/supabase';

@ApiTags('auth')
@Controller('auth')
export class AuthController {
  constructor(private readonly authService: AuthService) {}

  @Get('me')
  @UseGuards(JwtAuthGuard)
  @ApiBearerAuth()
  @ApiOperation({ summary: 'Get current authenticated user' })
  async getMe(@CurrentUser() user: SessionUser) {
    return {
      id: user.id,
      email: user.email,
      profile: user.profile,
      agencyRole: user.agencyRole,
      tenantRole: user.tenantRole,
      agencyId: user.agencyId,
      tenantId: user.tenantId,
    };
  }

  @Get('agencies')
  @UseGuards(JwtAuthGuard)
  @ApiBearerAuth()
  @ApiOperation({ summary: 'Get agencies for current user' })
  async getAgencies(@CurrentUser() user: SessionUser) {
    // Return user's agency memberships
    const agencyMembership = await this.authService.getAgencyMembership(user.id);
    if (!agencyMembership) {
      return [];
    }
    return [{ agencyId: agencyMembership.agencyId, role: agencyMembership.role }];
  }
}