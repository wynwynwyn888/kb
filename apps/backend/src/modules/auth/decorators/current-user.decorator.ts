// Current user decorator - extracts authenticated user from request

import { createParamDecorator, ExecutionContext, UnauthorizedException } from '@nestjs/common';
import type { SessionUser } from '../../../lib/supabase';

const MAX_ACCESS_TOKEN_LENGTH = 16_384;

export function rawBearerToken(authorization: unknown): string {
  if (typeof authorization !== 'string') {
    throw new UnauthorizedException('Missing or invalid authorization header');
  }
  const match = /^Bearer\s+/i.exec(authorization);
  if (!match) throw new UnauthorizedException('Missing or invalid authorization header');
  const token = authorization.slice(match[0].length).trim();
  if (!token || token.length > MAX_ACCESS_TOKEN_LENGTH || /\s/.test(token)) {
    throw new UnauthorizedException('Missing or invalid authorization header');
  }
  return token;
}

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

/** Request-scoped raw JWT for caller-scoped database access. Never persist or log it. */
export const CurrentAccessToken = createParamDecorator(
  (_data: unknown, ctx: ExecutionContext) => {
    const request = ctx.switchToHttp().getRequest();
    return rawBearerToken(request.headers?.authorization);
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
