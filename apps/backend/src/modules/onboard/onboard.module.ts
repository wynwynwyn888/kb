import { Module, forwardRef } from '@nestjs/common';
import { OnboardController } from './onboard.controller';
import { OnboardService } from './onboard.service';
import { OnboardAuditService } from './utils/audit';
import { OnboardOperatorGuard } from './guards/onboard-operator.guard';
import { AgentController } from './agent/agent.controller';
import { AgentTokenGuard } from './agent/agent-token.guard';
import { AuthModule } from '../auth/auth.module';
import { TenantsModule } from '../tenants/tenants.module';
import { PromptsModule } from '../prompts/prompts.module';
import { KbModule } from '../kb/kb.module';
import { BookingSettingsModule } from '../booking-settings/booking-settings.module';
import { HumanEscalationModule } from '../human-escalation/human-escalation.module';
import { FollowUpSettingsModule } from '../follow-up-settings/follow-up-settings.module';

@Module({
  imports: [AuthModule, forwardRef(() => TenantsModule), PromptsModule, KbModule, BookingSettingsModule, HumanEscalationModule, FollowUpSettingsModule],
  controllers: [OnboardController, AgentController],
  providers: [OnboardService, OnboardAuditService, OnboardOperatorGuard, AgentTokenGuard],
  exports: [OnboardService],
})
export class OnboardModule {}
