import { Processor, WorkerHost } from '@nestjs/bullmq';
import { Injectable } from '@nestjs/common';
import type { Job } from 'bullmq';
import { QUEUES } from '../queue.constants';
import { AudioTranscriptionService } from '../../modules/transcription/audio-transcription.service';

export type MediaTranscriptionJobData =
  | {
      kind: 'remote';
      tenantId: string;
      mediaUrl: string;
      conversationId: string;
      webhookEventId?: string;
    }
  | {
      kind: 'buffer';
      tenantId: string;
      conversationId: string;
      webhookEventId?: string;
      sourceLabel: string;
      bufferBase64: string;
      contentType: string | null;
    };

@Processor(QUEUES.MEDIA_TRANSCRIPTION, { concurrency: 2 })
@Injectable()
export class MediaTranscriptionProcessor extends WorkerHost {
  constructor(private readonly audioTranscription: AudioTranscriptionService) {
    super();
  }

  async process(job: Job<MediaTranscriptionJobData>) {
    const data = job.data;
    if (data.kind === 'remote') {
      return this.audioTranscription.transcribeRemoteMedia({
        tenantId: data.tenantId,
        mediaUrl: data.mediaUrl,
        conversationId: data.conversationId,
        webhookEventId: data.webhookEventId,
      });
    }
    return this.audioTranscription.transcribeAudioBuffer({
      tenantId: data.tenantId,
      buffer: Buffer.from(data.bufferBase64, 'base64'),
      contentType: data.contentType,
      conversationId: data.conversationId,
      webhookEventId: data.webhookEventId,
      sourceLabel: data.sourceLabel,
    });
  }
}
