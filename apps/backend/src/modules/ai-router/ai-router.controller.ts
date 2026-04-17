// AI Router controller

import { Controller, Post, Body } from '@nestjs/common';
import { ApiTags, ApiBearerAuth } from '@nestjs/swagger';
import { AiRouterService } from './ai-router.service';

@ApiTags('ai-router')
@ApiBearerAuth()
@Controller('ai-router')
export class AiRouterController {
  constructor(private readonly aiRouterService: AiRouterService) {}

  @Post('route')
  async route(@Body() dto: {
    tenantId: string;
    conversationId: string;
    prompt: string;
    context?: {
      recentMessages?: unknown[];
      kbResults?: unknown[];
      systemPrompt?: string;
    };
  }) {
    // TODO: Implement - decide model and route
    throw new Error('Not implemented');
  }

  @Post('generate')
  async generate(@Body() dto: {
    tenantId: string;
    conversationId: string;
    messages: Array<{ role: string; content: string }>;
    model?: string;
    temperature?: number;
    maxTokens?: number;
  }) {
    // TODO: Implement - generate AI response
    throw new Error('Not implemented');
  }
}