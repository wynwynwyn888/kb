// Agency AI Config module

import { Module } from '@nestjs/common';
import { AgencyAiConfigController } from './agency-ai-config.controller';
import { AgencyAiConfigService } from './agency-ai-config.service';
import { AuthModule } from '../auth/auth.module';

@Module({
  imports: [AuthModule],
  controllers: [AgencyAiConfigController],
  providers: [AgencyAiConfigService],
  exports: [AgencyAiConfigService],
})
export class AgencyAiConfigModule {}
