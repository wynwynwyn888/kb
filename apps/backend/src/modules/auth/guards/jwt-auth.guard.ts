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

    if (!authHeader || !authHeader.startsWith('Bearer ')) {
      throw new UnauthorizedException('Missing or invalid authorization header');
    }

    const token = authHeader.substring(7);

    try {
      const user = await this.authService.verifyToken(token);
      if (!user) {
        throw new UnauthorizedException('Invalid or expired token');
      }

      // Attach user to request
      request.user = user;
      return true;
    } catch {
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