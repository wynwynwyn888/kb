// Action gating module — gates suggested actions and persists intent records

import { Module } from '@nestjs/common';
import { ActionGatingService } from './action-gating.service';
import { ActionExecutionModule } from '../action-execution/action-execution.module';

@Module({
  imports: [ActionExecutionModule],
  providers: [ActionGatingService],
  exports: [ActionGatingService, ActionExecutionModule],
})
export class ActionGatingModule {}
