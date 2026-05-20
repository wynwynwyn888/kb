import { Module } from '@nestjs/common';
import { CreditResetRemindersService } from './credit-reset-reminders.service';

@Module({
  providers: [CreditResetRemindersService],
  exports: [CreditResetRemindersService],
})
export class CreditResetRemindersModule {}
