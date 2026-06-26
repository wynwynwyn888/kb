import { Injectable, CanActivate, ExecutionContext, ForbiddenException } from '@nestjs/common';
import type { SessionUser } from '../../../lib/supabase';

const ALLOWED_ROLES = new Set(['OWNER', 'ADMIN', 'OPERATOR']);

@Injectable()
export class OnboardOperatorGuard implements CanActivate {
  canActivate(context: ExecutionContext): boolean {
    const request = context.switchToHttp().getRequest();
    const user = request.user as SessionUser | undefined;

    if (!user) {
      throw new ForbiddenException('Authentication required for Onboard operator access');
    }

    if (!user.agencyRole || !ALLOWED_ROLES.has(user.agencyRole)) {
      throw new ForbiddenException(
        `Onboard operator access denied. Required role: OWNER, ADMIN, or OPERATOR. Current role: ${user.agencyRole ?? 'none'}.`,
      );
    }

    return true;
  }
}
