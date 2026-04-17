// Reply Planning module — produces structured reply plans from orchestration context

import { Module } from '@nestjs/common';
import { ReplyPlannerService } from './reply-planner.service';

@Module({
  providers: [ReplyPlannerService],
  exports: [ReplyPlannerService],
})
export class ReplyPlanningModule {}
