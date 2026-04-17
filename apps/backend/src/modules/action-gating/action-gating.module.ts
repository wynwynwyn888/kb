// Action gating module — gates suggested actions and persists intent records

import { Module } from '@nestjs/common';
import { ActionGatingService } from './action-gating.service';

@Module({
  providers: [ActionGatingService],
  exports: [ActionGatingService],
})
export class ActionGatingModule {}
