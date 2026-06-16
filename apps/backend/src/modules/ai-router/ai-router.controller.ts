// AI Router controller

import {
  Controller,
  Post,
  Body,
  UseGuards,
  BadRequestException,
  NotFoundException,
  HttpCode,
  HttpStatus,
} from '@nestjs/common';
import { ApiTags, ApiBearerAuth, ApiOperation } from '@nestjs/swagger';
import { AiRouterService } from './ai-router.service';
import { TenantsService } from '../tenants/tenants.service';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard';
import { CurrentUser } from '../auth/decorators/current-user.decorator';
import type { SessionUser } from '../../lib/supabase';
import type { MemoryEntry, RoutingRequest } from '../orchestration/dto';
import type { RetrievalChunk } from '../kb/dto/retrieval.dto';

/** HTTP body — maps to orchestration `RoutingRequest` without running full orchestration. */
export interface AiRouterRouteBodyDto {
  tenantId: string;
  conversationId: string;
  /** Primary user message text (alias: `incomingMessage`). */
  prompt?: string;
  incomingMessage?: string;
  incomingMessageType?: 'text' | 'image' | 'audio' | 'video' | 'unknown';
  channel?: string;
  handoverRecommended?: boolean;
  bookingIntentDetected?: boolean;
  estimatedInputTokens?: number;
  /** When set, used instead of `context.recentMessages`. */
  memory?: unknown[];
  context?: {
    recentMessages?: unknown[];
    kbResults?: unknown[];
    systemPrompt?: string;
  };
}

@ApiTags('ai-router')
@ApiBearerAuth()
@UseGuards(JwtAuthGuard)
@Controller('ai-router')
export class AiRouterController {
  constructor(
    private readonly aiRouterService: AiRouterService,
    private readonly tenantsService: TenantsService,
  ) {}

  @Post('route')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({
    summary: 'Heuristic model + response mode routing',
    description:
      'Calls AiRouterService.route (no LLM). Maps `prompt` or `incomingMessage` to RoutingRequest.incomingMessage. ' +
      '`context.kbResults` / `systemPrompt` are accepted for API compatibility; the current router heuristic does not use KB text.',
  })
  async route(@Body() dto: AiRouterRouteBodyDto, @CurrentUser() user: SessionUser) {
    const fromIncoming = typeof dto.incomingMessage === 'string' ? dto.incomingMessage : '';
    const fromPrompt = typeof dto.prompt === 'string' ? dto.prompt : '';
    const incoming = (fromIncoming.trim() || fromPrompt.trim());

    if (!dto.tenantId?.trim()) {
      throw new BadRequestException('tenantId is required');
    }
    if (!dto.conversationId?.trim()) {
      throw new BadRequestException('conversationId is required');
    }
    if (!incoming) {
      throw new BadRequestException('prompt or incomingMessage is required');
    }

    const ok = await this.tenantsService.checkTenantAccess(dto.tenantId, user.id);
    if (!ok) {
      throw new NotFoundException('Not found');
    }

    const req: RoutingRequest = {
      tenantId: dto.tenantId,
      conversationId: dto.conversationId,
      incomingMessage: incoming,
      incomingMessageType: dto.incomingMessageType ?? 'text',
      systemPrompt: dto.context?.systemPrompt ?? '',
      memory: this.normalizeMemory(dto.memory ?? dto.context?.recentMessages),
      kbContext: this.normalizeKbContext(dto.context?.kbResults),
      channel: dto.channel ?? 'WHATSAPP',
      handoverRecommended: dto.handoverRecommended ?? false,
      bookingIntentDetected: dto.bookingIntentDetected ?? false,
      estimatedInputTokens:
        dto.estimatedInputTokens ??
        Math.max(1, Math.ceil(incoming.length / 4)),
    };

    return this.aiRouterService.route(req);
  }

  @Post('generate')
  @ApiOperation({
    summary: 'Generate (not supported here)',
    deprecated: true,
    description:
      'Not implemented (throws). AiRouterService does not call an LLM; use GenerationService / reply planning. This endpoint is reserved to avoid a misleading name alongside `route`.',
  })
  async generate(
    @Body()
    _dto: {
      tenantId: string;
      conversationId: string;
      messages: Array<{ role: string; content: string }>;
      model?: string;
      temperature?: number;
      maxTokens?: number;
    },
  ) {
    throw new Error(
      'Not implemented: AiRouterService does not perform generation; use agency AI config and GenerationService (e.g. via orchestration / reply planning).',
    );
  }

  private normalizeMemory(raw: unknown): MemoryEntry[] {
    if (!Array.isArray(raw)) {
      return [];
    }
    const out: MemoryEntry[] = [];
    for (const item of raw) {
      if (!item || typeof item !== 'object') {
        continue;
      }
      const r = item as Record<string, unknown>;
      const content = typeof r['content'] === 'string' ? r['content'] : '';
      const role =
        r['role'] === 'assistant' || r['role'] === 'system'
          ? r['role']
          : 'user';
      const sender = this.normalizeSender(r['sender']);
      const ts =
        typeof r['timestamp'] === 'string'
          ? r['timestamp']
          : new Date().toISOString();
      const mt =
        r['messageType'] === 'image' ||
        r['messageType'] === 'audio' ||
        r['messageType'] === 'video'
          ? r['messageType']
          : 'text';
      out.push({
        role,
        content,
        sender,
        timestamp: ts,
        messageType: mt,
      });
    }
    return out;
  }

  private normalizeSender(
    raw: unknown,
  ): MemoryEntry['sender'] {
    if (raw === 'AI' || raw === 'AGENT' || raw === 'SYSTEM' || raw === 'CONTACT') {
      return raw;
    }
    return 'CONTACT';
  }

  private normalizeKbContext(raw: unknown): RetrievalChunk[] {
    if (!Array.isArray(raw)) {
      return [];
    }
    const out: RetrievalChunk[] = [];
    for (const item of raw) {
      if (!item || typeof item !== 'object') {
        continue;
      }
      const r = item as Record<string, unknown>;
      const chunkId = typeof r['chunkId'] === 'string' ? r['chunkId'] : '';
      const documentId =
        typeof r['documentId'] === 'string' ? r['documentId'] : '';
      const content = typeof r['content'] === 'string' ? r['content'] : '';
      const title = typeof r['title'] === 'string' ? r['title'] : '';
      const source = typeof r['source'] === 'string' ? r['source'] : '';
      const relevanceScore =
        typeof r['relevanceScore'] === 'number' &&
        Number.isFinite(r['relevanceScore'])
          ? r['relevanceScore']
          : 0;
      if (!chunkId || !documentId) {
        continue;
      }
      out.push({
        chunkId,
        documentId,
        content,
        title,
        source,
        relevanceScore,
        metadata:
          r['metadata'] &&
          typeof r['metadata'] === 'object' &&
          !Array.isArray(r['metadata'])
            ? (r['metadata'] as Record<string, unknown>)
            : {},
      });
    }
    return out;
  }
}
