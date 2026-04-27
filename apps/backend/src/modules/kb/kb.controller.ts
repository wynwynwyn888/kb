// KB controller

import {
  Controller,
  Get,
  Post,
  Patch,
  Delete,
  Body,
  Param,
  Query,
  UseGuards,
  NotFoundException,
  BadRequestException,
  UseInterceptors,
  UploadedFile,
} from '@nestjs/common';
import { FileInterceptor } from '@nestjs/platform-express';
import { ApiTags, ApiBearerAuth, ApiOperation, ApiConsumes } from '@nestjs/swagger';
import { KbService } from './kb.service';
import { TenantsService } from '../tenants/tenants.service';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard';
import { CurrentUser } from '../auth/decorators/current-user.decorator';
import type { SessionUser } from '../../lib/supabase';
import {
  CreateKbFaqBodyDto,
  CreateKbRichTextBodyDto,
  KbFileUploadBodyDto,
  KbSearchBodyDto,
  UpdateKbFaqBodyDto,
} from './dto/kb-body.dto';

const KB_MAX_TOP_K = 50;

/** Map Supabase/PostgREST low-level errors to short operator text (no schema-cache jargon in UI). */
function mapKbError(e: unknown): string {
  const m = e instanceof Error ? e.message : String(e);
  const l = m.toLowerCase();
  if (l.includes('schema cache') || (l.includes('pgrst') && l.includes('schema'))) {
    return 'The knowledge service is updating. Please wait a minute and try again.';
  }
  if (l.includes('document_kind') && (l.includes('column') || l.includes('does not exist'))) {
    return 'Knowledge base could not be saved. Contact support if this continues.';
  }
  if (l.includes('row-level security') || l.includes('permission denied') || l.includes('rls')) {
    return 'You do not have access to change this knowledge base.';
  }
  if (/^(faq|rich) (doc|chunk):/i.test(m) || m.startsWith('Failed to save')) {
    return 'Could not save this entry. Check your connection and try again.';
  }
  if (m.length > 300) {
    return 'Could not complete this knowledge base action. Try again or contact support.';
  }
  return m;
}

@ApiTags('kb')
@ApiBearerAuth()
@UseGuards(JwtAuthGuard)
@Controller('kb')
export class KbController {
  constructor(
    private readonly kbService: KbService,
    private readonly tenantsService: TenantsService,
  ) {}

  @Get('documents/:tenantId')
  @ApiOperation({ summary: 'List knowledge documents (READY only, or all with ?all=1)' })
  async listDocuments(
    @Param('tenantId') tenantId: string,
    @Query('all') all: string | undefined,
    @CurrentUser() user: SessionUser,
  ) {
    await this.assertTenantScope(user, tenantId);
    return this.kbService.listDocuments(tenantId, {
      includeAllStatuses: all === '1' || all === 'true',
    });
  }

  @Post('documents/faq')
  @ApiOperation({ summary: 'Create FAQ entry (question + answer → chunks)' })
  async createFaq(
    @Body() dto: CreateKbFaqBodyDto,
    @CurrentUser() user: SessionUser,
  ) {
    if (!dto.tenantId?.trim()) throw new BadRequestException('tenantId is required');
    await this.assertTenantScope(user, dto.tenantId);
    try {
      return await this.kbService.createFaq(dto.tenantId, dto.question, dto.answer);
    } catch (e) {
      throw new BadRequestException(mapKbError(e));
    }
  }

  @Patch('documents/:documentId/faq')
  @ApiOperation({ summary: 'Update FAQ question and answer' })
  async updateFaq(
    @Param('documentId') documentId: string,
    @Body() dto: UpdateKbFaqBodyDto,
    @CurrentUser() user: SessionUser,
  ) {
    if (!dto.tenantId?.trim()) throw new BadRequestException('tenantId is required');
    await this.assertTenantScope(user, dto.tenantId);
    try {
      return await this.kbService.updateFaq(dto.tenantId, documentId, dto.question, dto.answer);
    } catch (e) {
      throw new BadRequestException(mapKbError(e));
    }
  }

  @Post('documents/rich')
  @ApiOperation({ summary: 'Create rich text entry' })
  async createRich(
    @Body() dto: CreateKbRichTextBodyDto,
    @CurrentUser() user: SessionUser,
  ) {
    if (!dto.tenantId?.trim()) throw new BadRequestException('tenantId is required');
    await this.assertTenantScope(user, dto.tenantId);
    try {
      return await this.kbService.createRichText(dto.tenantId, dto.title, dto.content);
    } catch (e) {
      throw new BadRequestException(mapKbError(e));
    }
  }

  @Post('documents/file')
  @ApiOperation({ summary: 'Upload a text file (.txt, plain text). PDF/Word return 400 until workers exist.' })
  @ApiConsumes('multipart/form-data')
  @UseInterceptors(FileInterceptor('file', { limits: { fileSize: 5 * 1024 * 1024 } }))
  async createFile(
    @UploadedFile() file: { buffer: Buffer; originalname: string; mimetype: string } | undefined,
    @Body() body: KbFileUploadBodyDto,
    @CurrentUser() user: SessionUser,
  ) {
    if (!body.tenantId?.trim()) throw new BadRequestException('tenantId is required');
    if (!file?.buffer) throw new BadRequestException('file is required');
    await this.assertTenantScope(user, body.tenantId);
    try {
      return await this.kbService.createFileFromBuffer(
        body.tenantId,
        file.originalname,
        file.buffer,
        file.mimetype,
      );
    } catch (e) {
      const me = e instanceof Error ? e.message : String(e);
      if (/pdf|word|extraction|not enabled|empty or unsupported/i.test(me) && me.length < 220) {
        throw new BadRequestException(me);
      }
      throw new BadRequestException(mapKbError(e));
    }
  }

  @Delete('documents/:documentId')
  @ApiOperation({ summary: 'Delete a document and chunks (tenantId query required)' })
  async deleteDocument(
    @Param('documentId') documentId: string,
    @Query('tenantId') tenantId: string | undefined,
    @CurrentUser() user: SessionUser,
  ) {
    if (!tenantId?.trim()) throw new BadRequestException('tenantId is required');
    await this.assertTenantScope(user, tenantId);
    try {
      await this.kbService.deleteDocument(tenantId, documentId);
    } catch (e) {
      throw new BadRequestException(mapKbError(e));
    }
    return { ok: true };
  }

  @Post('search')
  @ApiOperation({ summary: 'Keyword search across READY KB chunks for a tenant' })
  async search(
    @Body() dto: KbSearchBodyDto,
    @CurrentUser() user: SessionUser,
  ) {
    if (!dto.tenantId?.trim()) {
      throw new BadRequestException('tenantId is required');
    }
    if (dto.query === undefined || dto.query === null) {
      throw new BadRequestException('query is required');
    }

    await this.assertTenantScope(user, dto.tenantId);

    let topK: number | undefined = dto.topK;
    if (topK !== undefined) {
      if (!Number.isFinite(topK) || topK < 1) {
        throw new BadRequestException('topK must be a positive number');
      }
      topK = Math.min(KB_MAX_TOP_K, Math.floor(topK));
    }

    return this.kbService.retrieve({
      tenantId: dto.tenantId,
      conversationId: dto.conversationId ?? '',
      query: dto.query,
      topK,
    });
  }

  @Get('chunks/:documentId')
  @ApiOperation({
    summary: 'List chunks for a document (tenantId query required for access control)',
  })
  async getChunks(
    @Param('documentId') documentId: string,
    @Query('tenantId') tenantId: string | undefined,
    @CurrentUser() user: SessionUser,
  ) {
    if (!tenantId?.trim()) {
      throw new BadRequestException('tenantId query parameter is required');
    }

    await this.assertTenantScope(user, tenantId);

    const chunks = await this.kbService.getChunksForTenant(documentId, tenantId);
    if (chunks === null) {
      throw new NotFoundException('Document not found');
    }

    return chunks;
  }

  private async assertTenantScope(user: SessionUser, effectiveTenantId: string): Promise<void> {
    const ok = await this.tenantsService.checkTenantAccess(effectiveTenantId, user.id);
    if (!ok) {
      throw new NotFoundException('Not found');
    }
  }
}
