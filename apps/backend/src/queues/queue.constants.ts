// Queue definitions for BullMQ
// Defines all queues and their processing configuration

export const QUEUES = {
  // Inbound message processing from GHL webhooks
  INBOUND_MESSAGE_PROCESSOR: 'inbound-message-processor',

  // Send formatted message bubbles back to GHL
  SEND_BUBBLE: 'send-bubble',

  // Knowledge base document ingestion
  KB_INGEST: 'kb-ingest',

  // Notify agents when handover is requested
  HANDOVER_NOTIFY: 'handover-notify',

  // Alert when quota threshold is reached
  QUOTA_THRESHOLD_ALERT: 'quota-threshold-alert',

  // Periodic analytics rollup
  ANALYTICS_ROLLUP: 'analytics-rollup',

  // Follow-up automation (delayed jobs, due checks, sends)
  FOLLOW_UP: 'follow-up',
} as const;

export type QueueName = (typeof QUEUES)[keyof typeof QUEUES];

// Queue configuration for each queue
export const queueConfig: Record<QueueName, {
  defaultJobOptions: {
    attempts: number;
    backoff: { type: 'exponential' | 'fixed'; delay: number };
    removeOnComplete?: boolean;
    removeOnFail?: boolean;
  };
}> = {
  [QUEUES.INBOUND_MESSAGE_PROCESSOR]: {
    defaultJobOptions: {
      attempts: 3,
      backoff: { type: 'exponential', delay: 1000 },
      removeOnComplete: true,
      removeOnFail: false, // Keep for debugging
    },
  },
  [QUEUES.SEND_BUBBLE]: {
    defaultJobOptions: {
      attempts: 3,
      backoff: { type: 'exponential', delay: 2000 },
      removeOnComplete: true,
      removeOnFail: true,
    },
  },
  [QUEUES.KB_INGEST]: {
    defaultJobOptions: {
      attempts: 3,
      backoff: { type: 'exponential', delay: 5000 },
      removeOnComplete: false, // Need for retry
      removeOnFail: false,
    },
  },
  [QUEUES.HANDOVER_NOTIFY]: {
    defaultJobOptions: {
      attempts: 2,
      backoff: { type: 'fixed', delay: 1000 },
      removeOnComplete: true,
      removeOnFail: true,
    },
  },
  [QUEUES.QUOTA_THRESHOLD_ALERT]: {
    defaultJobOptions: {
      attempts: 1,
      backoff: { type: 'fixed', delay: 0 },
      removeOnComplete: true,
      removeOnFail: true,
    },
  },
  [QUEUES.ANALYTICS_ROLLUP]: {
    defaultJobOptions: {
      attempts: 1,
      backoff: { type: 'fixed', delay: 0 },
      removeOnComplete: true,
      removeOnFail: true,
    },
  },
  [QUEUES.FOLLOW_UP]: {
    defaultJobOptions: {
      attempts: 1,
      backoff: { type: 'fixed', delay: 0 },
      removeOnComplete: true,
      removeOnFail: false, // keep failures for debugging follow-up decisions
    },
  },
};