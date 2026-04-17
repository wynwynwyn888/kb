// Auth controller - handles authentication endpoints
// POST /auth/register, POST /auth/login, POST /auth/refresh

import { Controller, Post, Body, HttpCode, HttpStatus } from '@nestjs/common';
import { ApiTags, ApiOperation } from '@nestjs/swagger';
import { AuthService } from './auth.service';
import { LoginDto, RegisterDto } from '@aisbp/types';

@ApiTags('auth')
@Controller('auth')
export class AuthController {
  constructor(private readonly authService: AuthService) {}

  @Post('register')
  @ApiOperation({ summary: 'Register new user and agency' })
  async register(@Body() dto: RegisterDto) {
    // TODO: Implement registration
    throw new Error('Not implemented');
  }

  @Post('login')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: 'Login with email and password' })
  async login(@Body() dto: LoginDto) {
    // TODO: Implement login
    throw new Error('Not implemented');
  }

  @Post('refresh')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: 'Refresh access token' })
  async refresh(@Body() { refreshToken }: { refreshToken: string }) {
    // TODO: Implement token refresh
    throw new Error('Not implemented');
  }

  @Post('logout')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: 'Logout and invalidate token' })
  async logout() {
    // TODO: Implement logout
    throw new Error('Not implemented');
  }
}