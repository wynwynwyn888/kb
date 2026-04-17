// Handover module - manages conversation handover to human agents
// Pauses AI replies during handover, tracks handover events

import { Module } from '@nestjs/common';
import { HandoverController } from './handover.controller';
import { HandoverService } from './handover.service';

@Module({
  controllers: [HandoverController],
  providers: [HandoverService],
  exports: [HandoverService],
})
export class HandoverModule {}