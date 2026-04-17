// Current user decorator - extracts authenticated user from request

import { createParamDecorator, ExecutionContext } from '@nestjs/common';
import type { SessionUser } from '../../../lib/supabase';

export const CurrentUser = createParamDecorator(
  (data: keyof SessionUser | undefined, ctx: ExecutionContext) => {
    const request = ctx.switchToHttp().getRequest();
    const user = request.user as SessionUser;

    if (!user) {
      return null;
    }

    return data ? user[data] : user;
  },
);

// Decorator for extracting tenant context
export const CurrentTenantId = createParamDecorator(
  (data: unknown, ctx: ExecutionContext) => {
    const request = ctx.switchToHttp().getRequest();
    const user = request.user as SessionUser;
    return user?.tenantId || null;
  },
);

// Decorator for extracting agency context
export const CurrentAgencyId = createParamDecorator(
  (data: unknown, ctx: ExecutionContext) => {
    const request = ctx.switchToHttp().getRequest();
    const user = request.user as SessionUser;
    return user?.agencyId || null;
  },
);