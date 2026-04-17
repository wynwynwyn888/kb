// GHL module - handles GoHighLevel Private Integration connection management

import { Module } from '@nestjs/common';
import { GhlController } from './ghl.controller';
import { GhlService } from './ghl.service';

@Module({
  controllers: [GhlController],
  providers: [GhlService],
  exports: [GhlService],
})
export class GhlModule {}