// Formatter module - handles message formatting and bubble splitting
// Converts AI responses to chat-friendly format

import { Module } from '@nestjs/common';
import { FormatterController } from './formatter.controller';
import { FormatterService } from './formatter.service';

@Module({
  controllers: [FormatterController],
  providers: [FormatterService],
  exports: [FormatterService],
})
export class FormatterModule {}