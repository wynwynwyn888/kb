import { Module } from '@nestjs/common';
import { FollowUpSettingsController } from './follow-up-settings.controller';
import { FollowUpSettingsService } from './follow-up-settings.service';
import { GhlModule } from '../ghl/ghl.module';
import { AuthModule } from '../auth/auth.module';

@Module({
  imports: [AuthModule, GhlModule],
  controllers: [FollowUpSettingsController],
  providers: [FollowUpSettingsService],
  exports: [FollowUpSettingsService],
})
export class FollowUpSettingsModule {}
