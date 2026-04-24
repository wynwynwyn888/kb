// Formatter controller

import {
  Controller,
  Post,
  Body,
  UseGuards,
  BadRequestException,
  HttpCode,
  HttpStatus,
} from '@nestjs/common';
import { ApiTags, ApiBearerAuth, ApiOperation } from '@nestjs/swagger';
import { FormatterService } from './formatter.service';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard';
import type {
  FormatterInput,
  ReplyBubbleDraft,
  ReplyDecision,
} from '../reply-planning/dto';

@ApiTags('formatter')
@ApiBearerAuth()
@UseGuards(JwtAuthGuard)
@Controller('formatter')
export class FormatterController {
  constructor(private readonly formatterService: FormatterService) {}

  /**
   * Optional formatting path — not used by queue/outbound send (live send uses ReplyPlanner output).
   * Body must match {@link FormatterInput}: `conversationId`, `channel`, `replyPlan`.
   */
  @Post('format')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({
    summary: 'Format a ReplyDecision into bubbles (tooling / optional)',
    description:
      'Uses FormatterService.formatReplyDecision — separate from live GHL send formatting in ReplyPlannerService. `maxBubbleLength` is not configurable (1024 in service).',
  })
  async format(@Body() dto: FormatterInput) {
    this.assertFormatterInput(dto);
    return this.formatterService.formatReplyDecision(dto);
  }

  /**
   * Split raw text into bubbles (markdown stripped, WhatsApp-oriented max length).
   * Only `content` is used; legacy `format` on the body is ignored.
   */
  @Post('preview')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({
    summary: 'Preview bubble split for raw text',
    description:
      'Uses FormatterService.formatRawText. Optional `format` field is accepted for API compatibility but not used.',
  })
  async preview(
    @Body() dto: { content: string; format?: 'bubble' | 'plain' | 'markdown' },
  ) {
    if (dto.content === undefined || dto.content === null) {
      throw new BadRequestException('content is required');
    }
    if (typeof dto.content !== 'string') {
      throw new BadRequestException('content must be a string');
    }
    return this.formatterService.formatRawText(dto.content);
  }

  private assertFormatterInput(dto: FormatterInput): void {
    if (!dto.conversationId?.trim()) {
      throw new BadRequestException('conversationId is required');
    }
    if (!dto.channel?.trim()) {
      throw new BadRequestException('channel is required');
    }
    if (!dto.replyPlan || typeof dto.replyPlan !== 'object') {
      throw new BadRequestException('replyPlan is required');
    }
    const rp = dto.replyPlan as ReplyDecision;
    if (typeof rp.planStatus !== 'string') {
      throw new BadRequestException('replyPlan.planStatus is required');
    }
    if (!Array.isArray(rp.bubbles)) {
      throw new BadRequestException('replyPlan.bubbles must be an array');
    }
    for (let i = 0; i < rp.bubbles.length; i++) {
      const b = rp.bubbles[i] as ReplyBubbleDraft | undefined;
      if (!b || typeof b !== 'object') {
        throw new BadRequestException(`replyPlan.bubbles[${i}] must be an object`);
      }
      if (typeof b.index !== 'number' || !Number.isFinite(b.index)) {
        throw new BadRequestException(`replyPlan.bubbles[${i}].index must be a number`);
      }
      if (typeof b.text !== 'string') {
        throw new BadRequestException(`replyPlan.bubbles[${i}].text must be a string`);
      }
    }
  }
}
