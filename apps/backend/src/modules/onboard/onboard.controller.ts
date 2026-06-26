import {
  BadRequestException,
  Body,
  Controller,
  Get,
  Param,
  Patch,
  Post,
  UseGuards,
} from '@nestjs/common';
import { ApiTags, ApiBearerAuth, ApiOperation } from '@nestjs/swagger';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard';
import { OnboardOperatorGuard } from './guards/onboard-operator.guard';
import { CurrentUser } from '../auth/decorators/current-user.decorator';
import type { SessionUser } from '../../lib/supabase';
import { OnboardService } from './onboard.service';
import { CreateClientDto } from './dto/create-client.dto';
import { UpdateClientDto } from './dto/update-client.dto';
import { CreateProjectDto } from './dto/create-project.dto';
import { UpdateProjectDto } from './dto/update-project.dto';
import { ApproveSectionDto } from './dto/approve-section.dto';
import { RequestChangesDto } from './dto/request-changes.dto';
import { RejectProjectDto } from './dto/reject-project.dto';
import { ApproveProjectDto } from './dto/approve-project.dto';
import { KbDryRunDto } from './dto/kb-dry-run.dto';
import { KbApplyDto } from './dto/kb-apply.dto';
import { VALID_SECTION_NAMES } from './utils/approval';

@ApiTags('onboard')
@ApiBearerAuth()
@UseGuards(JwtAuthGuard, OnboardOperatorGuard)
@Controller('onboard')
export class OnboardController {
  constructor(private readonly onboardService: OnboardService) {}

  // ==========================================================================
  // CLIENTS
  // ==========================================================================

  @Get('clients')
  @ApiOperation({ summary: 'List all onboard clients (operator only)' })
  async listClients() {
    return this.onboardService.listClients();
  }

  @Post('clients')
  @ApiOperation({ summary: 'Create a new onboard client (operator only)' })
  async createClient(
    @CurrentUser() user: SessionUser,
    @Body() body: CreateClientDto,
  ) {
    if (!user?.id) throw new BadRequestException('Authentication required');
    return this.onboardService.createClient(body, user.id);
  }

  @Get('clients/:onboardClientId')
  @ApiOperation({ summary: 'Get onboard client by ID' })
  async getClient(@Param('onboardClientId') onboardClientId: string) {
    const client = await this.onboardService.getClient(onboardClientId);
    if (!client) {
      // Try by clientKey as fallback
      const byKey = await this.onboardService.getClientByKey(onboardClientId);
      if (!byKey) throw new BadRequestException('Client not found');
      return byKey;
    }
    return client;
  }

  @Patch('clients/:onboardClientId')
  @ApiOperation({ summary: 'Update onboard client (operator only)' })
  async updateClient(
    @Param('onboardClientId') onboardClientId: string,
    @CurrentUser() user: SessionUser,
    @Body() body: UpdateClientDto,
  ) {
    if (!user?.id) throw new BadRequestException('Authentication required');

    const client = await this.onboardService.getClient(onboardClientId);
    if (!client) {
      const byKey = await this.onboardService.getClientByKey(onboardClientId);
      if (!byKey) throw new BadRequestException('Client not found');
      return this.onboardService.updateClient(byKey.id, body, user.id);
    }
    return this.onboardService.updateClient(client.id, body, user.id);
  }

  // ==========================================================================
  // PROJECTS
  // ==========================================================================

  @Get('projects')
  @ApiOperation({ summary: 'List all onboarding projects (operator only)' })
  async listProjects() {
    return this.onboardService.listProjects();
  }

  @Post('projects')
  @ApiOperation({ summary: 'Create a new onboarding project (operator only)' })
  async createProject(
    @CurrentUser() user: SessionUser,
    @Body() body: CreateProjectDto,
  ) {
    if (!user?.id) throw new BadRequestException('Authentication required');
    return this.onboardService.createProject(body.onboardClientId, user.id);
  }

  @Get('projects/:onboardingProjectId')
  @ApiOperation({ summary: 'Get onboarding project by ID' })
  async getProject(@Param('onboardingProjectId') onboardingProjectId: string) {
    const project = await this.onboardService.getProject(onboardingProjectId);
    if (!project) throw new BadRequestException('Project not found');
    return project;
  }

  @Patch('projects/:onboardingProjectId')
  @ApiOperation({ summary: 'Update onboarding project (operator only). Foundation: metadata-only, no status changes.' })
  async updateProject(
    @Param('onboardingProjectId') onboardingProjectId: string,
    @CurrentUser() user: SessionUser,
    @Body() body: UpdateProjectDto,
  ) {
    if (!user?.id) throw new BadRequestException('Authentication required');
    return this.onboardService.updateProject(onboardingProjectId, body, user.id);
  }

  // ==========================================================================
  // REVIEW / APPROVAL (PR 6)
  // ==========================================================================

  @Post('projects/:onboardingProjectId/sections/:sectionName/approve')
  @ApiOperation({ summary: 'Approve a project section (operator only). Section must be COMPLETE.' })
  async approveSection(
    @Param('onboardingProjectId') onboardingProjectId: string,
    @Param('sectionName') sectionName: string,
    @CurrentUser() user: SessionUser,
    @Body() body: ApproveSectionDto,
  ) {
    if (!user?.id) throw new BadRequestException('Authentication required');
    if (!VALID_SECTION_NAMES.includes(sectionName as never)) {
      throw new BadRequestException(`Invalid section: ${sectionName}. Valid: ${VALID_SECTION_NAMES.join(', ')}`);
    }
    return this.onboardService.approveSection(onboardingProjectId, sectionName, user.id, body.comment);
  }

  @Post('projects/:onboardingProjectId/request-changes')
  @ApiOperation({ summary: 'Request changes on a project (operator only). Comment required.' })
  async requestChanges(
    @Param('onboardingProjectId') onboardingProjectId: string,
    @CurrentUser() user: SessionUser,
    @Body() body: RequestChangesDto,
  ) {
    if (!user?.id) throw new BadRequestException('Authentication required');
    return this.onboardService.requestChanges(onboardingProjectId, user.id, body.comment, body.rejectedSections);
  }

  @Post('projects/:onboardingProjectId/reject')
  @ApiOperation({ summary: 'Reject a project (operator only). Comment required.' })
  async rejectProject(
    @Param('onboardingProjectId') onboardingProjectId: string,
    @CurrentUser() user: SessionUser,
    @Body() body: RejectProjectDto,
  ) {
    if (!user?.id) throw new BadRequestException('Authentication required');
    return this.onboardService.rejectProject(onboardingProjectId, user.id, body.comment);
  }

  @Post('projects/:onboardingProjectId/approve')
  @ApiOperation({ summary: 'Approve a project (operator only). All required sections must be approved first.' })
  async approveProject(
    @Param('onboardingProjectId') onboardingProjectId: string,
    @CurrentUser() user: SessionUser,
    @Body() body: ApproveProjectDto,
  ) {
    if (!user?.id) throw new BadRequestException('Authentication required');
    return this.onboardService.approveProject(onboardingProjectId, user.id, body.comment);
  }

  @Get('projects/:onboardingProjectId/analysis')
  @ApiOperation({ summary: 'Get project workflow analysis (read-only)' })
  async getProjectAnalysis(@Param('onboardingProjectId') onboardingProjectId: string) {
    return this.onboardService.getProjectAnalysis(onboardingProjectId);
  }

  @Get('projects/:onboardingProjectId/recommendations')
  @ApiOperation({ summary: 'Get project automation recommendations (read-only)' })
  async getProjectRecommendations(@Param('onboardingProjectId') onboardingProjectId: string) {
    return this.onboardService.getProjectRecommendations(onboardingProjectId);
  }

  @Get('projects/:onboardingProjectId/approval-events')
  @ApiOperation({ summary: 'Get approval events for a project' })
  async getApprovalEvents(@Param('onboardingProjectId') onboardingProjectId: string) {
    return this.onboardService.getApprovalEvents(onboardingProjectId);
  }

  @Get('projects/:onboardingProjectId/audit')
  @ApiOperation({ summary: 'Get audit events for a project' })
  async getAuditEvents(@Param('onboardingProjectId') onboardingProjectId: string) {
    const project = await this.onboardService.getProject(onboardingProjectId);
    if (!project) throw new BadRequestException('Project not found');
    return this.onboardService.getAuditEvents(onboardingProjectId);
  }

  // ==========================================================================
  // KB SYNC DRY RUN (PR 9)
  // ==========================================================================

  @Post('projects/:onboardingProjectId/sync/kb/dry-run')
  @ApiOperation({ summary: 'KB sync dry run — preview only. No KB mutation.' })
  async kbDryRun(
    @Param('onboardingProjectId') onboardingProjectId: string,
    @CurrentUser() user: SessionUser,
    @Body() body: KbDryRunDto,
  ) {
    if (!user?.id) throw new BadRequestException('Authentication required');
    return this.onboardService.kbDryRun(onboardingProjectId, user.id, body.idempotencyKey);
  }

  @Get('projects/:onboardingProjectId/sync-runs')
  @ApiOperation({ summary: 'Get sync run history for a project' })
  async getSyncRuns(@Param('onboardingProjectId') onboardingProjectId: string) {
    return this.onboardService.getSyncRuns(onboardingProjectId);
  }

  // ==========================================================================
  // NOTIFICATIONS / REVIEW ALERTS (PR 11)
  // ==========================================================================

  @Get('projects/:onboardingProjectId/sync/kb/plan-preview')
  @ApiOperation({ summary: 'Preview mapped KB write plan (no-write)' })
  async kbPlanPreview(@Param('onboardingProjectId') onboardingProjectId: string) {
    return this.onboardService.kbPlanPreview(onboardingProjectId);
  }

  @Get('notifications/review-alerts')
  @ApiOperation({ summary: 'Get review alerts and in-app notification summary (operator only)' })
  async getReviewAlerts() {
    return this.onboardService.getReviewAlerts();
  }

  // ==========================================================================
  // GHL VALIDATION / DRY RUN (PR 12)
  // ==========================================================================

  @Post('projects/:onboardingProjectId/sync/ghl/validate')
  @ApiOperation({ summary: 'Validate GHL readiness — local checks only, no GHL API calls' })
  async ghlValidate(
    @Param('onboardingProjectId') onboardingProjectId: string,
    @CurrentUser() user: SessionUser,
  ) {
    if (!user?.id) throw new BadRequestException('Authentication required');
    return this.onboardService.ghlValidate(onboardingProjectId, user.id);
  }

  @Post('projects/:onboardingProjectId/sync/ghl/dry-run')
  @ApiOperation({ summary: 'Generate no-write GHL sync plan preview' })
  async ghlDryRun(
    @Param('onboardingProjectId') onboardingProjectId: string,
    @CurrentUser() user: SessionUser,
  ) {
    if (!user?.id) throw new BadRequestException('Authentication required');
    return this.onboardService.ghlDryRun(onboardingProjectId, user.id);
  }

  // ==========================================================================
  // KB SYNC APPLY (PR 10)
  // ==========================================================================

  @Post('projects/:onboardingProjectId/sync/kb/apply')
  @ApiOperation({ summary: 'Apply approved KB dry-run config. Requires feature flag, approval, and snapshot match.' })
  async kbApply(
    @Param('onboardingProjectId') onboardingProjectId: string,
    @CurrentUser() user: SessionUser,
    @Body() body: KbApplyDto,
  ) {
    if (!user?.id) throw new BadRequestException('Authentication required');
    return this.onboardService.kbApply(
      onboardingProjectId,
      body.syncRunId,
      user.id,
      user.agencyId,
      body.idempotencyKey,
      body.confirmApply,
      body.applyScope,
      body.operatorNote,
    );
  }
}
