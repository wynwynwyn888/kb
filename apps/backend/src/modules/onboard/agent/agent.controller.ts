import {
  BadRequestException,
  Body,
  Controller,
  Get,
  Param,
  Post,
  Req,
  UseGuards,
} from '@nestjs/common';
import { ApiTags, ApiBearerAuth, ApiOperation } from '@nestjs/swagger';
import { AgentTokenGuard } from './agent-token.guard';
import { OnboardService } from '../onboard.service';
import { CreateSessionDto } from './dto/create-session.dto';
import { SubmitAnswersDto } from './dto/submit-answers.dto';
import { SubmitAnalysisDto } from './dto/submit-analysis.dto';
import type { Request } from 'express';

@ApiTags('onboard-agent')
@ApiBearerAuth()
@UseGuards(AgentTokenGuard)
@Controller('onboard/agent')
export class AgentController {
  constructor(private readonly onboardService: OnboardService) {}

  private getAgentId(req: Request): string {
    const agentId = (req as unknown as Record<string, unknown>)['agentId'];
    return typeof agentId === 'string' ? agentId : 'whatsapp-onboarding-agent';
  }

  @Post('sessions')
  @ApiOperation({ summary: 'Create or resume an agent interview session' })
  async createSession(
    @Req() req: Request,
    @Body() body: CreateSessionDto,
  ) {
    const agentId = this.getAgentId(req);
    return this.onboardService.agentCreateSession(body.projectId, body.agentType || 'whatsapp_ai', agentId);
  }

  @Get('sessions/:sessionId')
  @ApiOperation({ summary: 'Get agent interview session details' })
  async getSession(@Param('sessionId') sessionId: string) {
    const session = await this.onboardService.agentGetSession(sessionId);
    if (!session) throw new BadRequestException('Session not found');
    return session;
  }

  @Post('sessions/:sessionId/answers')
  @ApiOperation({ summary: 'Submit interview answers for a session' })
  async submitAnswers(
    @Req() req: Request,
    @Param('sessionId') sessionId: string,
    @Body() body: SubmitAnswersDto,
  ) {
    const agentId = this.getAgentId(req);
    return this.onboardService.agentSubmitAnswers(sessionId, body.answers, agentId, body.idempotencyKey);
  }

  @Get('projects/:projectId/missing-fields')
  @ApiOperation({ summary: 'Get missing required fields for a project' })
  async getMissingFields(@Param('projectId') projectId: string) {
    return this.onboardService.agentGetMissingFields(projectId);
  }

  @Post('projects/:projectId/request-review')
  @ApiOperation({ summary: 'Request operator review of a project' })
  async requestReview(
    @Req() req: Request,
    @Param('projectId') projectId: string,
  ) {
    const agentId = this.getAgentId(req);
    return this.onboardService.agentRequestReview(projectId, agentId);
  }

  @Post('projects/:projectId/analysis')
  @ApiOperation({ summary: 'Submit AI workflow analysis and automation recommendations' })
  async submitAnalysis(
    @Req() req: Request,
    @Param('projectId') projectId: string,
    @Body() body: SubmitAnalysisDto,
  ) {
    const agentId = this.getAgentId(req);
    return this.onboardService.agentSubmitAnalysis(projectId, body, agentId);
  }

  @Get('projects/:projectId/status')
  @ApiOperation({ summary: 'Get project status for agent' })
  async getProjectStatus(@Param('projectId') projectId: string) {
    const project = await this.onboardService.getProject(projectId);
    if (!project) throw new BadRequestException('Project not found');
    const sections = await this.onboardService.agentGetMissingFields(projectId);
    return {
      projectId: project.id,
      status: project.status,
      currentPhase: project.currentPhase,
      completeness: sections.completeness,
      sectionsStatus: Object.fromEntries(
        sections.sections.map((s: { name: string; status: string }) => [s.name, s.status]),
      ),
    };
  }
}
