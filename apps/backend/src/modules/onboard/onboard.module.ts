import { Module } from '@nestjs/common';
import { OnboardController } from './onboard.controller';
import { OnboardService } from './onboard.service';
import { OnboardAuditService } from './utils/audit';
import { OnboardOperatorGuard } from './guards/onboard-operator.guard';
import { AuthModule } from '../auth/auth.module';

@Module({
  imports: [AuthModule],
  controllers: [OnboardController],
  providers: [OnboardService, OnboardAuditService, OnboardOperatorGuard],
  exports: [OnboardService],
})
export class OnboardModule {}
