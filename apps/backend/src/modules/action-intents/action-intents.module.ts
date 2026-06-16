// Action Intents module - inspect action intents

import { Module } from '@nestjs/common';
import { ActionIntentsController } from './action-intents.controller';
import { ActionIntentsService } from './action-intents.service';
import { AuthModule } from '../auth/auth.module';
import { TenantsModule } from '../tenants/tenants.module';

@Module({
  imports: [AuthModule, TenantsModule],
  controllers: [ActionIntentsController],
  providers: [ActionIntentsService],
  exports: [ActionIntentsService],
})
export class ActionIntentsModule {}
