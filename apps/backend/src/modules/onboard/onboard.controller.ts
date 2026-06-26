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
import { CurrentUser } from '../auth/decorators/current-user.decorator';
import type { SessionUser } from '../../lib/supabase';
import { OnboardService } from './onboard.service';
import { CreateClientDto } from './dto/create-client.dto';
import { UpdateClientDto } from './dto/update-client.dto';
import { CreateProjectDto } from './dto/create-project.dto';
import { UpdateProjectDto } from './dto/update-project.dto';

@ApiTags('onboard')
@ApiBearerAuth()
@UseGuards(JwtAuthGuard)
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
}
