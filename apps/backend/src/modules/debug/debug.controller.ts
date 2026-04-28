// Lightweight runtime/debug endpoint — proves which build is running.
// Tied to JwtAuthGuard so only authenticated users can hit it; never returns secrets.

import { Controller, Get, UseGuards } from '@nestjs/common';
import { ApiBearerAuth, ApiOperation, ApiTags } from '@nestjs/swagger';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard';
import { getRuntimeBuildMarker } from '../../lib/runtime-build-marker';

@ApiTags('debug')
@Controller('debug')
export class DebugController {
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
}
