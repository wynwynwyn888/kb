// AI Router - interfaces for model routing decisions

import type { AiProvider } from '@aisbp/types';

export interface RouteContext {
  tenantId: string;
  conversationId: string;
  prompt: string;
  systemPrompt?: string;
  temperature?: number;
  maxTokens?: number;
  recentMessages?: RoutableMessage[];
  kbResults?: KnowledgeSnippet[];
}

export interface RoutableMessage {
  role: 'user' | 'assistant' | 'system';
  content: string;
  createdAt: Date;
}

export interface KnowledgeSnippet {
  content: string;
  sourceDocId: string;
  score: number;
}

export interface RoutingDecision {
  provider: AiProvider;
  model: string;
  endpoint?: string;
  reasoning: string;
  costEstimate?: {
    inputTokens: number;
    outputTokens: number;
    estimatedCost: number;
  };
}

export interface AiResponse {
  content: string;
  usage: {
    promptTokens: number;
    completionTokens: number;
    totalTokens: number;
  };
  model: string;
  provider: AiProvider;
  finishReason: string;
}

// Model routing strategy interface
export interface ModelRouter {
  /**
   * Decide which model to use for a given request
   */
  route(context: RouteContext): Promise<RoutingDecision>;

  /**
   * Execute a prompt against the chosen model
   */
  generate(
    decision: RoutingDecision,
    context: RouteContext
  ): Promise<AiResponse>;

  /**
   * Estimate cost before making routing decision
   */
  estimateCost(context: RouteContext): Promise<number>;
}

// Provider adapters
export interface AiProviderAdapter {
  readonly provider: AiProvider;
  readonly supportedModels: string[];

  initialize(config: ProviderConfig): void;
  generate(options: GenerateOptions): Promise<AiResponse>;
  getTokenCount(text: string): Promise<number>;
}

export interface ProviderConfig {
  apiKey: string;
  endpoint?: string;
  defaultModel: string;
  maxTokens?: number;
  temperature?: number;
}

export interface GenerateOptions {
  model: string;
  messages: Array<{
    role: 'system' | 'user' | 'assistant';
    content: string;
  }>;
  temperature?: number;
  maxTokens?: number;
  stream?: boolean;
}

// Default router implementation placeholder
export class DefaultModelRouter implements ModelRouter {
  async route(context: RouteContext): Promise<RoutingDecision> {
    // TODO: Implement actual routing logic based on:
    // - tenant configuration
    // - conversation context
    // - cost optimization
    // - model availability
    throw new Error('Model router not yet implemented');
  }

  async generate(decision: RoutingDecision, context: RouteContext): Promise<AiResponse> {
    // TODO: Implement actual AI generation
    throw new Error('AI generation not yet implemented');
  }

  async estimateCost(context: RouteContext): Promise<number> {
    // TODO: Implement cost estimation
    return 0;
  }
}

// Routing rules interface for custom routing
export interface RoutingRule {
  id: string;
  name: string;
  priority: number;
  conditions: RoutingCondition[];
  action: RoutingAction;
}

export interface RoutingCondition {
  field: 'channel' | 'tenant_id' | 'hour' | 'message_length' | 'kb_available';
  operator: 'eq' | 'neq' | 'gt' | 'lt' | 'in';
  value: unknown;
}

export interface RoutingAction {
  type: 'route_to_model' | 'route_to_provider' | 'fallback';
  provider?: AiProvider;
  model?: string;
  fallbackModel?: string;
}