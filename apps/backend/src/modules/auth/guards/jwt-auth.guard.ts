// JWT Auth Guard - verifies Supabase JWT from Authorization header

import { Injectable, CanActivate, ExecutionContext, UnauthorizedException } from '@nestjs/common';
import { AuthService } from '../auth.service';
import type { SessionUser } from '../../../lib/supabase';

@Injectable()
export class JwtAuthGuard implements CanActivate {
  constructor(private readonly authService: AuthService) {}

  async canActivate(context: ExecutionContext): Promise<boolean> {
    const request = context.switchToHttp().getRequest();
    const authHeader = request.headers.authorization;

    if (!authHeader) {
      throw new UnauthorizedException('Missing or invalid authorization header');
    }

    const bearerMatch = /^Bearer\s+/i.exec(authHeader);
    if (!bearerMatch) {
      throw new UnauthorizedException('Missing or invalid authorization header');
    }

    const token = authHeader.slice(bearerMatch[0].length).trim();

    try {
      const user = await this.authService.verifyToken(token);
      if (!user) {
        throw new UnauthorizedException('Invalid or expired token');
      }

      // Attach user to request
      request.user = user;
      return true;
    } catch (e) {
      if (e instanceof UnauthorizedException) {
        throw e;
      }
      throw new UnauthorizedException('Invalid or expired token');
    }
  }
}

// Extend Express Request to include user
declare global {
  namespace Express {
    interface Request {
      user?: SessionUser;
    }
  }
}
