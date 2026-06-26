import { Module } from '@nestjs/common';
import { OnboardController } from './onboard.controller';
import { OnboardService } from './onboard.service';
import { OnboardAuditService } from './utils/audit';
import { AuthModule } from '../auth/auth.module';

@Module({
  imports: [AuthModule],
  controllers: [OnboardController],
  providers: [OnboardService, OnboardAuditService],
  exports: [OnboardService],
})
export class OnboardModule {}
