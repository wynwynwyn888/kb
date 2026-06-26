import { Injectable, CanActivate, ExecutionContext, UnauthorizedException } from '@nestjs/common';

@Injectable()
export class AgentTokenGuard implements CanActivate {
  canActivate(context: ExecutionContext): boolean {
    const request = context.switchToHttp().getRequest();
    const authHeader = request.headers.authorization;

    if (!authHeader) {
      throw new UnauthorizedException('Missing agent authorization token');
    }

    const bearerMatch = /^Bearer\s+/i.exec(authHeader);
    if (!bearerMatch) {
      throw new UnauthorizedException('Invalid agent authorization format. Use: Bearer <token>');
    }

    const token = authHeader.slice(bearerMatch[0].length).trim();
    if (!token) {
      throw new UnauthorizedException('Empty agent token');
    }

    const expectedToken = process.env['ONBOARD_AGENT_API_TOKEN'];
    if (!expectedToken) {
      throw new UnauthorizedException('ONBOARD_AGENT_API_TOKEN not configured');
    }

    if (!this.timingSafeEqual(token, expectedToken)) {
      throw new UnauthorizedException('Invalid agent token');
    }

    request['agentId'] = 'whatsapp-onboarding-agent';
    return true;
  }

  private timingSafeEqual(a: string, b: string): boolean {
    if (a.length !== b.length) return false;
    let result = 0;
    for (let i = 0; i < a.length; i++) {
      result |= a.charCodeAt(i) ^ b.charCodeAt(i);
    }
    return result === 0;
  }
}
