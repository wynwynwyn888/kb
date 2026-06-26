import { Module } from '@nestjs/common';
import { OnboardController } from './onboard.controller';
import { OnboardService } from './onboard.service';
import { OnboardAuditService } from './utils/audit';
import { OnboardOperatorGuard } from './guards/onboard-operator.guard';
import { AgentController } from './agent/agent.controller';
import { AgentTokenGuard } from './agent/agent-token.guard';
import { AuthModule } from '../auth/auth.module';

@Module({
  imports: [AuthModule],
  controllers: [OnboardController, AgentController],
  providers: [OnboardService, OnboardAuditService, OnboardOperatorGuard, AgentTokenGuard],
  exports: [OnboardService],
})
export class OnboardModule {}
