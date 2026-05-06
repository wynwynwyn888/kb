// Lightweight runtime/debug endpoint — proves which build is running.
// Tied to JwtAuthGuard so only authenticated users can hit it; never returns secrets.

import { Body, Controller, Get, Post, UseGuards, BadRequestException, ForbiddenException, Logger } from '@nestjs/common';
import { ApiBearerAuth, ApiOperation, ApiTags } from '@nestjs/swagger';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard';
import { getRuntimeBuildMarker } from '../../lib/runtime-build-marker';
import { FollowUpEngineService } from '../follow-up-engine/follow-up-engine.service';

@ApiTags('debug')
@Controller('debug')
export class DebugController {
  private readonly logger = new Logger(DebugController.name);

  constructor(private readonly followUpEngine: FollowUpEngineService) {}

  @Get('runtime')
  @UseGuards(JwtAuthGuard)
  @ApiBearerAuth()
  @ApiOperation({
    summary:
      'Build/runtime marker (gitSha, appVersion, NODE_ENV, bootedAt) and which KB routes are mounted. No secrets.',
  })
  getRuntime() {
    const marker = getRuntimeBuildMarker();
    return {
      gitSha: marker.gitSha,
      appVersion: marker.appVersion,
      nodeEnv: marker.nodeEnv,
      bootedAtIso: marker.bootedAtIso,
      uptimeMs: Date.now() - marker.bootedAtMs,
      uptimeSec: Math.floor((Date.now() - marker.bootedAtMs) / 1000),
      // Static route registry — these endpoints are mounted in this build.
      routes: {
        kbRichSourceRoute: 'GET /kb/documents/:documentId/rich-source',
        kbRichPatchRoute: 'PATCH /kb/documents/:documentId/rich',
        kbSearchRoute: 'POST /kb/search',
      },
      featureFlags: {
        sectionAwareChunking: true,
        kbRichTextContentMetadata: true,
        derivedConversationKey: true,
        genericOptionMemory: true,
      },
    };
  }

  @Post('follow-up/smoke')
  @UseGuards(JwtAuthGuard)
  @ApiBearerAuth()
  @ApiOperation({
    summary:
      'Prod-safe follow-up smoke path: schedules follow-up for a conversation. Does NOT send unless explicitly allowed by env.',
  })
  async followUpSmoke(
    @Body()
    body: {
      tenantId: string;
      conversationId: string;
      contactId: string;
      ghlLocationId: string;
      delayMinutes?: number;
      mode?: 'fixed_message' | 'ai_decides';
      fixedMessage?: string;
      aiInstruction?: string;
    },
  ) {
    const allow = (process.env['ALLOW_FOLLOWUP_SMOKE'] ?? '').trim().toLowerCase();
    if (allow !== 'true') {
      throw new ForbiddenException(
        'Follow-up smoke is disabled. Set ALLOW_FOLLOWUP_SMOKE=true on the server to enable it.',
      );
    }
    const tenantId = body.tenantId?.trim();
    const conversationId = body.conversationId?.trim();
    const contactId = body.contactId?.trim();
    const ghlLocationId = body.ghlLocationId?.trim();
    if (!tenantId || !conversationId || !contactId || !ghlLocationId) {
      throw new BadRequestException('tenantId, conversationId, contactId, ghlLocationId are required');
    }
    const delayMinutes =
      typeof body.delayMinutes === 'number' && Number.isFinite(body.delayMinutes) && body.delayMinutes > 0
        ? Math.floor(body.delayMinutes)
        : 1;
    // This schedules based on whatever follow-up settings are currently configured.
    // For smoke verification, temporarily configure one enabled step at 1 minute in the UI.
    this.logger.warn(
      `followUpSmokeRequested ${JSON.stringify({ tenantId, conversationId, contactId, ghlLocationId, delayMinutes })}`,
    );
    await this.followUpEngine.scheduleAfterOutboundSend({
      tenantId,
      conversationId,
      contactId,
      ghlLocationId,
      sentAtIso: new Date(Date.now() - delayMinutes * 60_000).toISOString(),
    });

    return {
      ok: true,
      scheduledAtIso: new Date().toISOString(),
      note:
        'Scheduled follow-up jobs using the current workspace follow-up settings. Check logs for followUpScheduled/followUpDue/followUpSent/followUpSkipped.',
    };
  }
}
