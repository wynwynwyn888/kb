import { Module } from '@nestjs/common';
import { BookingSettingsController } from './booking-settings.controller';
import { BookingSettingsService } from './booking-settings.service';
import { GhlModule } from '../ghl/ghl.module';
import { AuthModule } from '../auth/auth.module';

@Module({
  imports: [AuthModule, GhlModule],
  controllers: [BookingSettingsController],
  providers: [BookingSettingsService],
  exports: [BookingSettingsService],
})
export class BookingSettingsModule {}
