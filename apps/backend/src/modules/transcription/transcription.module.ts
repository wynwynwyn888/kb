import { Module } from '@nestjs/common';
import { AudioTranscriptionService } from './audio-transcription.service';

@Module({
  providers: [AudioTranscriptionService],
  exports: [AudioTranscriptionService],
})
export class TranscriptionModule {}
