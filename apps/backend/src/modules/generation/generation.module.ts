// Generation module — owns LLM generation for reply planning

import { Module } from '@nestjs/common';
import { GenerationService } from './generation.service';
import { TranscriptionModule } from '../transcription/transcription.module';

@Module({
  imports: [TranscriptionModule],
  providers: [GenerationService],
  exports: [GenerationService],
})
export class GenerationModule {}
