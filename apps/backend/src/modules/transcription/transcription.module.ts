import { Module } from '@nestjs/common';
import { AudioTranscriptionService } from './audio-transcription.service';
import { GhlVoiceRecordingFetchService } from './ghl-voice-recording-fetch.service';
import { GhlVoiceMessageDiscoveryService } from './ghl-voice-message-discovery.service';
import { GhlVoiceConversationDiscoveryService } from './ghl-voice-conversation-discovery.service';
import { GhlInboundImageFetchService } from './ghl-inbound-image-fetch.service';

@Module({
  providers: [
    AudioTranscriptionService,
    GhlVoiceRecordingFetchService,
    GhlVoiceMessageDiscoveryService,
    GhlVoiceConversationDiscoveryService,
    GhlInboundImageFetchService,
  ],
  exports: [
    AudioTranscriptionService,
    GhlVoiceRecordingFetchService,
    GhlVoiceMessageDiscoveryService,
    GhlVoiceConversationDiscoveryService,
    GhlInboundImageFetchService,
  ],
})
export class TranscriptionModule {}
