// Action Execution Module — executes deferred ActionIntents safely and idempotently

import { Module } from '@nestjs/common';
import { ActionIntentExecutorService } from './action-intent-executor.service';

@Module({
  providers: [ActionIntentExecutorService],
  exports: [ActionIntentExecutorService],
})
export class ActionExecutionModule {}
