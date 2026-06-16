import { Module } from '@nestjs/common';
import { AppCacheModule } from '../../lib/app-cache.module';
import { BookingSettingsModule } from '../booking-settings/booking-settings.module';
import { GhlModule } from '../ghl/ghl.module';
import { PromptsModule } from '../prompts/prompts.module';
import { HumanEscalationModule } from '../human-escalation/human-escalation.module';
import { BookingPostConfirmService } from './booking-post-confirm.service';
import { ConversationBookingFlowService } from './conversation-booking-flow.service';
import { BookingNluInterpreterService } from './booking-nlu-interpreter.service';
import { BookingReplyComposerService } from './booking-reply-composer.service';

@Module({
  imports: [AppCacheModule, BookingSettingsModule, GhlModule, PromptsModule, HumanEscalationModule],
  providers: [
    ConversationBookingFlowService,
    BookingPostConfirmService,
    BookingNluInterpreterService,
    BookingReplyComposerService,
  ],
  exports: [ConversationBookingFlowService],
})
export class BookingFlowModule {}
