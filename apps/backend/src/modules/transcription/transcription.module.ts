import { Module } from '@nestjs/common';
import { AudioTranscriptionService } from './audio-transcription.service';
import { GhlVoiceRecordingFetchService } from './ghl-voice-recording-fetch.service';
import { GhlVoiceMessageDiscoveryService } from './ghl-voice-message-discovery.service';
import { GhlVoiceConversationDiscoveryService } from './ghl-voice-conversation-discovery.service';

@Module({
  providers: [
    AudioTranscriptionService,
    GhlVoiceRecordingFetchService,
    GhlVoiceMessageDiscoveryService,
    GhlVoiceConversationDiscoveryService,
  ],
  exports: [
    AudioTranscriptionService,
    GhlVoiceRecordingFetchService,
    GhlVoiceMessageDiscoveryService,
    GhlVoiceConversationDiscoveryService,
  ],
})
export class TranscriptionModule {}
