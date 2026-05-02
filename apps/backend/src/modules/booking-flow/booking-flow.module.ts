import { Module } from '@nestjs/common';
import { BookingSettingsModule } from '../booking-settings/booking-settings.module';
import { GhlModule } from '../ghl/ghl.module';
import { BookingPostConfirmService } from './booking-post-confirm.service';
import { ConversationBookingFlowService } from './conversation-booking-flow.service';
import { BookingNluInterpreterService } from './booking-nlu-interpreter.service';

@Module({
  imports: [BookingSettingsModule, GhlModule],
  providers: [ConversationBookingFlowService, BookingPostConfirmService, BookingNluInterpreterService],
  exports: [ConversationBookingFlowService],
})
export class BookingFlowModule {}
