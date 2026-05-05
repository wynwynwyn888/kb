import { Module } from '@nestjs/common';
import { AudioTranscriptionService } from './audio-transcription.service';
import { GhlVoiceRecordingFetchService } from './ghl-voice-recording-fetch.service';

@Module({
  providers: [AudioTranscriptionService, GhlVoiceRecordingFetchService],
  exports: [AudioTranscriptionService, GhlVoiceRecordingFetchService],
})
export class TranscriptionModule {}
