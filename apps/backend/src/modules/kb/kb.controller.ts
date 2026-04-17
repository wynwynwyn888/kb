// KB controller

import { Controller, Get, Post, Delete, Body, Param, Query } from '@nestjs/common';
import { ApiTags, ApiBearerAuth } from '@nestjs/swagger';
import { KbService } from './kb.service';

@ApiTags('kb')
@ApiBearerAuth()
@Controller('kb')
export class KbController {
  constructor(private readonly kbService: KbService) {}

  @Post('documents')
  async uploadDocument(@Body() dto: {
    tenantId: string;
    title: string;
    source: string;
    mimeType: string;
    content: string;
  }) {
    // TODO: Implement - enqueue kb-ingest job
    throw new Error('Not implemented');
  }

  @Get('documents/:tenantId')
  async listDocuments(@Param('tenantId') tenantId: string) {
    // TODO: Implement
    throw new Error('Not implemented');
  }

  @Delete('documents/:id')
  async deleteDocument(@Param('id') id: string) {
    // TODO: Implement
    throw new Error('Not implemented');
  }

  @Post('search')
  async search(@Body() dto: {
    tenantId: string;
    query: string;
    topK?: number;
  }) {
    // TODO: Implement - vector similarity search with pgvector
    throw new Error('Not implemented');
  }

  @Get('chunks/:documentId')
  async getChunks(@Param('documentId') documentId: string) {
    // TODO: Implement
    throw new Error('Not implemented');
  }
}