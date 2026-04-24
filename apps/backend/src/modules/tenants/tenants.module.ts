// Tenants module - manages tenant entities
// Tenant maps 1:1 to GHL subaccount/location

import { Module, forwardRef } from '@nestjs/common';
import { TenantsController } from './tenants.controller';
import { TenantsService } from './tenants.service';
import { AuthModule } from '../auth/auth.module';
import { GenerationModule } from '../generation/generation.module';
import { KbModule } from '../kb/kb.module';
import { AgencyAiConfigModule } from '../agency-ai-config/agency-ai-config.module';
import { BotTestService } from './bot-test.service';

@Module({
  imports: [AuthModule, forwardRef(() => KbModule), GenerationModule, AgencyAiConfigModule],
  controllers: [TenantsController],
  providers: [TenantsService, BotTestService],
  exports: [TenantsService],
})
export class TenantsModule {}