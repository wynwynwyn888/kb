import { Module } from '@nestjs/common';
import { AudioTranscriptionService } from './audio-transcription.service';
import { GhlVoiceRecordingFetchService } from './ghl-voice-recording-fetch.service';
import { GhlVoiceMessageDiscoveryService } from './ghl-voice-message-discovery.service';

@Module({
  providers: [
    AudioTranscriptionService,
    GhlVoiceRecordingFetchService,
    GhlVoiceMessageDiscoveryService,
  ],
  exports: [
    AudioTranscriptionService,
    GhlVoiceRecordingFetchService,
    GhlVoiceMessageDiscoveryService,
  ],
})
export class TranscriptionModule {}
