// Action Intents module - inspect action intents

import { Module } from '@nestjs/common';
import { ActionIntentsController } from './action-intents.controller';
import { ActionIntentsService } from './action-intents.service';

@Module({
  controllers: [ActionIntentsController],
  providers: [ActionIntentsService],
  exports: [ActionIntentsService],
})
export class ActionIntentsModule {}
