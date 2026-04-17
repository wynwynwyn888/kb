// AI Router service - handles model routing decisions

import { Injectable } from '@nestjs/common';
import { ModelRouter, RoutingDecision, RouteContext } from '@aisbp/ai-router';

@Injectable()
export class AiRouterService {
  // TODO: Implement AI routing logic
  // - Get tenant config and agency provider
  // - Apply routing rules (channel, tenant, time, etc.)
  // - Consider cost optimization
  // - Fallback handling
  // - Call actual AI provider

  private router!: ModelRouter;

  async route(context: RouteContext): Promise<RoutingDecision> {
    throw new Error('Not implemented');
  }

  async generate(
    decision: RoutingDecision,
    messages: Array<{ role: 'system' | 'user' | 'assistant'; content: string }>,
    options: { temperature?: number; maxTokens?: number }
  ) {
    throw new Error('Not implemented');
  }

  async estimateCost(tenantId: string, promptLength: number): Promise<number> {
    throw new Error('Not implemented');
  }
}