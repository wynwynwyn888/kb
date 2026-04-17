// GHL module - handles GoHighLevel API integration
// Manages OAuth flow, token refresh, and API calls to GHL

import { Module } from '@nestjs/common';
import { GhlController } from './ghl.controller';
import { GhlService } from './ghl.service';

@Module({
  controllers: [GhlController],
  providers: [GhlService],
  exports: [GhlService],
})
export class GhlModule {}