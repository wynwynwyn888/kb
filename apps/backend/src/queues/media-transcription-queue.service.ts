import { Injectable } from '@nestjs/common';
import { InjectQueue } from '@nestjs/bullmq';
import type { Queue } from 'bullmq';
import { QueueEvents } from 'bullmq';
import { ConfigService } from '@nestjs/config';
import { QUEUES } from './queue.constants';
import type { MediaTranscriptionJobData } from './processors/media-transcription.processor';
import { AudioTranscriptionService } from '../modules/transcription/audio-transcription.service';

type TranscribeRemoteMediaResult = Awaited<ReturnType<AudioTranscriptionService['transcribeRemoteMedia']>>;
type TranscribeAudioBufferResult = Awaited<ReturnType<AudioTranscriptionService['transcribeAudioBuffer']>>;

@Injectable()
export class MediaTranscriptionQueueService {
  private queueEvents: QueueEvents | null = null;

  constructor(
    @InjectQueue(QUEUES.MEDIA_TRANSCRIPTION) private readonly queue: Queue,
    private readonly audioTranscription: AudioTranscriptionService,
    private readonly config: ConfigService,
  ) {}

  private async getQueueEvents(): Promise<QueueEvents> {
    if (!this.queueEvents) {
      const tlsRaw = (this.config.get<string>('REDIS_TLS') ?? '').trim().toLowerCase();
      const useTls = ['1', 'true', 'yes'].includes(tlsRaw);
      const password = this.config.get<string>('REDIS_PASSWORD')?.trim();
      const username = this.config.get<string>('REDIS_USER')?.trim();
      this.queueEvents = new QueueEvents(QUEUES.MEDIA_TRANSCRIPTION, {
        connection: {
          host: this.config.get<string>('REDIS_HOST', 'localhost'),
          port: this.config.get<number>('REDIS_PORT', 6379),
          ...(username ? { username } : {}),
          ...(password ? { password } : {}),
          ...(useTls ? { tls: {} } : {}),
        },
      });
    }
    return this.queueEvents;
  }

  async transcribeRemoteMedia(
    params: Omit<Extract<MediaTranscriptionJobData, { kind: 'remote' }>, 'kind'>,
  ): Promise<TranscribeRemoteMediaResult> {
    const inline = String(process.env['MEDIA_TRANSCRIPTION_INLINE'] ?? '').trim().toLowerCase() === 'true';
    if (inline) {
      return this.audioTranscription.transcribeRemoteMedia(params);
    }
    const job = await this.queue.add('remote', { kind: 'remote', ...params });
    const events = await this.getQueueEvents();
    return job.waitUntilFinished(events) as Promise<TranscribeRemoteMediaResult>;
  }

  async transcribeAudioBuffer(
    params: Omit<Extract<MediaTranscriptionJobData, { kind: 'buffer' }>, 'kind' | 'bufferBase64'> & {
      buffer: Buffer;
    },
  ): Promise<TranscribeAudioBufferResult> {
    const inline = String(process.env['MEDIA_TRANSCRIPTION_INLINE'] ?? '').trim().toLowerCase() === 'true';
    if (inline) {
      return this.audioTranscription.transcribeAudioBuffer(params);
    }
    const job = await this.queue.add('buffer', {
      kind: 'buffer',
      tenantId: params.tenantId,
      conversationId: params.conversationId,
      webhookEventId: params.webhookEventId,
      sourceLabel: params.sourceLabel,
      contentType: params.contentType,
      bufferBase64: params.buffer.toString('base64'),
    });
    const events = await this.getQueueEvents();
    return job.waitUntilFinished(events) as Promise<TranscribeAudioBufferResult>;
  }
}
