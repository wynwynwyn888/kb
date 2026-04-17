// Formatter controller

import { Controller, Post, Body } from '@nestjs/common';
import { ApiTags, ApiBearerAuth } from '@nestjs/swagger';
import { FormatterService } from './formatter.service';

@ApiTags('formatter')
@ApiBearerAuth()
@Controller('formatter')
export class FormatterController {
  constructor(private readonly formatterService: FormatterService) {}

  @Post('format')
  async format(@Body() dto: {
    content: string;
    format: 'bubble' | 'plain' | 'markdown';
    maxBubbleLength?: number;
  }) {
    // TODO: Implement
    throw new Error('Not implemented');
  }

  @Post('preview')
  async preview(@Body() dto: {
    content: string;
    format: 'bubble' | 'plain' | 'markdown';
  }) {
    // TODO: Return preview without saving
    throw new Error('Not implemented');
  }
}