import { Module } from '@nestjs/common';
import { BookingSettingsModule } from '../booking-settings/booking-settings.module';
import { GhlModule } from '../ghl/ghl.module';
import { PromptsModule } from '../prompts/prompts.module';
import { BookingPostConfirmService } from './booking-post-confirm.service';
import { ConversationBookingFlowService } from './conversation-booking-flow.service';
import { BookingNluInterpreterService } from './booking-nlu-interpreter.service';
import { BookingReplyComposerService } from './booking-reply-composer.service';

@Module({
  imports: [BookingSettingsModule, GhlModule, PromptsModule],
  providers: [
    ConversationBookingFlowService,
    BookingPostConfirmService,
    BookingNluInterpreterService,
    BookingReplyComposerService,
  ],
  exports: [ConversationBookingFlowService],
})
export class BookingFlowModule {}
