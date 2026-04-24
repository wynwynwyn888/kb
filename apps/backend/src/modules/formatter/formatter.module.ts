// Formatter module - handles message formatting and bubble splitting
// Converts AI responses to chat-friendly format

import { Module } from '@nestjs/common';
import { AuthModule } from '../auth/auth.module';
import { FormatterController } from './formatter.controller';
import { FormatterService } from './formatter.service';

@Module({
  imports: [AuthModule],
  controllers: [FormatterController],
  providers: [FormatterService],
  exports: [FormatterService],
})
export class FormatterModule {}