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
  StreamableFile,
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
  ImportWebsiteBodyDto,
  KbFileUploadBodyDto,
  KbSearchBodyDto,
  UpdateKbFaqBodyDto,
  UpdateKbRichTextBodyDto,
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

  @Get('documents/:documentId/rich-source')
  @ApiOperation({
    summary: 'Authoritative note text for View/Edit (stored metadata; chunk reconstruction fallback)',
  })
  async getRichNoteSource(
    @Param('documentId') documentId: string,
    @Query('tenantId') tenantId: string | undefined,
    @CurrentUser() user: SessionUser,
  ) {
    if (!tenantId?.trim()) {
      throw new BadRequestException('tenantId query parameter is required');
    }
    await this.assertTenantScope(user, tenantId);
    const row = await this.kbService.getRichNoteSourceForEdit(tenantId, documentId);
    if (!row) {
      throw new NotFoundException('Not found');
    }
    return row;
  }

  @Get('vaults/:tenantId')
  @ApiOperation({ summary: 'List knowledge vaults for a workspace' })
  async listVaults(@Param('tenantId') tenantId: string, @CurrentUser() user: SessionUser) {
    if (!tenantId?.trim()) throw new BadRequestException('tenantId is required');
    await this.assertTenantScope(user, tenantId);
    return this.kbService.listVaults(tenantId.trim());
  }

  @Post('vaults')
  @ApiOperation({ summary: 'Create a knowledge vault' })
  async createVault(
    @Body() dto: { tenantId: string; name: string; description?: string | null },
    @CurrentUser() user: SessionUser,
  ) {
    if (!dto.tenantId?.trim()) throw new BadRequestException('tenantId is required');
    await this.assertTenantScope(user, dto.tenantId);
    try {
      return await this.kbService.createVault(dto.tenantId.trim(), dto.name, dto.description);
    } catch (e) {
      throw new BadRequestException(mapKbError(e));
    }
  }

  @Patch('vaults/:vaultId')
  @ApiOperation({ summary: 'Rename or update a knowledge vault' })
  async updateVault(
    @Param('vaultId') vaultId: string,
    @Query('tenantId') tenantId: string | undefined,
    @Body() dto: { name?: string; description?: string | null },
    @CurrentUser() user: SessionUser,
  ) {
    if (!tenantId?.trim()) throw new BadRequestException('tenantId query parameter is required');
    await this.assertTenantScope(user, tenantId);
    try {
      return await this.kbService.updateVault(tenantId.trim(), vaultId.trim(), dto);
    } catch (e) {
      throw new BadRequestException(mapKbError(e));
    }
  }

  @Post('vaults/:vaultId/duplicate')
  @ApiOperation({ summary: 'Duplicate vault shell (name + description); does not copy documents' })
  async duplicateVault(
    @Param('vaultId') vaultId: string,
    @Query('tenantId') tenantId: string | undefined,
    @CurrentUser() user: SessionUser,
  ) {
    if (!tenantId?.trim()) throw new BadRequestException('tenantId query parameter is required');
    await this.assertTenantScope(user, tenantId);
    try {
      return await this.kbService.duplicateVault(tenantId.trim(), vaultId.trim());
    } catch (e) {
      throw new BadRequestException(mapKbError(e));
    }
  }

  @Delete('vaults/:vaultId')
  @ApiOperation({ summary: 'Delete an empty non-default vault (must have zero documents)' })
  async deleteVault(
    @Param('vaultId') vaultId: string,
    @Query('tenantId') tenantId: string | undefined,
    @Query('reassignToVaultId') reassignToVaultId: string | undefined,
    @CurrentUser() user: SessionUser,
  ) {
    if (!tenantId?.trim()) throw new BadRequestException('tenantId query parameter is required');
    await this.assertTenantScope(user, tenantId);
    try {
      return await this.kbService.deleteVault(tenantId.trim(), vaultId.trim(), {
        reassignToVaultId: reassignToVaultId?.trim(),
      });
    } catch (e) {
      throw new BadRequestException(mapKbError(e));
    }
  }

  @Patch('documents/:documentId/vault')
  @ApiOperation({ summary: 'Assign a document to a knowledge vault' })
  async setDocumentVault(
    @Param('documentId') documentId: string,
    @Body() dto: { tenantId: string; vaultId: string },
    @CurrentUser() user: SessionUser,
  ) {
    if (!dto.tenantId?.trim()) throw new BadRequestException('tenantId is required');
    if (!dto.vaultId?.trim()) throw new BadRequestException('vaultId is required');
    await this.assertTenantScope(user, dto.tenantId);
    try {
      return await this.kbService.setDocumentVault(dto.tenantId.trim(), documentId.trim(), dto.vaultId.trim());
    } catch (e) {
      throw new BadRequestException(mapKbError(e));
    }
  }

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
      return await this.kbService.createFaq(dto.tenantId, dto.question, dto.answer, dto.vaultId);
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
      return await this.kbService.createRichText(dto.tenantId, dto.title, dto.content, dto.vaultId);
    } catch (e) {
      throw new BadRequestException(mapKbError(e));
    }
  }

  @Patch('documents/:documentId/rich')
  @ApiOperation({ summary: 'Update note / rich text (same document id; replaces indexed chunks)' })
  async updateRich(
    @Param('documentId') documentId: string,
    @Body() dto: UpdateKbRichTextBodyDto,
    @CurrentUser() user: SessionUser,
  ) {
    if (!dto.tenantId?.trim()) throw new BadRequestException('tenantId is required');
    await this.assertTenantScope(user, dto.tenantId);
    try {
      return await this.kbService.updateRichText(dto.tenantId, documentId, dto.title, dto.content);
    } catch (e) {
      const me = e instanceof Error ? e.message : String(e);
      if (/not a note|document not found/i.test(me)) {
        throw new NotFoundException('Not found');
      }
      throw new BadRequestException(mapKbError(e));
    }
  }

  @Get('documents/:documentId/download')
  @ApiOperation({
    summary: 'Download original file when stored in object storage (tenantId query required)',
  })
  async downloadOriginal(
    @Param('documentId') documentId: string,
    @Query('tenantId') tenantId: string | undefined,
    @CurrentUser() user: SessionUser,
  ): Promise<StreamableFile> {
    if (!tenantId?.trim()) throw new BadRequestException('tenantId query parameter is required');
    await this.assertTenantScope(user, tenantId);
    const file = await this.kbService.getOriginalFileForDownload(tenantId, documentId);
    if (!file) {
      throw new NotFoundException(
        'Original file download is not available for this document. Parsed text is available from the chunks endpoint.',
      );
    }
    const safeName = file.filename.replace(/[^\w.\- ()\[\]]+/g, '_').slice(0, 180) || 'download';
    return new StreamableFile(file.buffer, {
      type: file.mimeType || 'application/octet-stream',
      disposition: `attachment; filename="${safeName}"`,
    });
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
        body.vaultId,
      );
    } catch (e) {
      const me = e instanceof Error ? e.message : String(e);
      if (/pdf|word|extraction|not enabled|empty or unsupported/i.test(me) && me.length < 220) {
        throw new BadRequestException(me);
      }
      throw new BadRequestException(mapKbError(e));
    }
  }

  @Post('documents/website')
  @ApiOperation({ summary: 'Import same-domain website pages into a knowledge vault' })
  async importWebsite(
    @Body() dto: ImportWebsiteBodyDto,
    @CurrentUser() user: SessionUser,
  ) {
    if (!dto.tenantId?.trim()) throw new BadRequestException('tenantId is required');
    if (!dto.url?.trim()) throw new BadRequestException('url is required');
    await this.assertTenantScope(user, dto.tenantId);
    try {
      return await this.kbService.importWebsite(dto.tenantId.trim(), {
        url: dto.url.trim(),
        requestedVaultId: dto.vaultId?.trim(),
        crawlMode: dto.crawlMode,
        maxPages: dto.maxPages,
      });
    } catch (e) {
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

    return this.kbService.searchKnowledge({
      tenantId: dto.tenantId,
      query: dto.query,
      topK,
      intentHint: dto.intentHint?.trim() || undefined,
      vaultId: dto.vaultId?.trim() || undefined,
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

    return chunks.map(({ id, content, tokenCount, metadata }) => ({
      id,
      content,
      tokenCount,
      metadata: this.kbService.sanitizeChunkMetadataForClient(metadata),
    }));
  }

  private async assertTenantScope(user: SessionUser, effectiveTenantId: string): Promise<void> {
    const ok = await this.tenantsService.checkTenantAccess(effectiveTenantId, user.id);
    if (!ok) {
      throw new NotFoundException('Not found');
    }
  }
}
