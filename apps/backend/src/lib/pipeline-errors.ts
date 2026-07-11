/** Stable technical pipeline failures that may safely be retried by BullMQ. */
export class RetryablePipelineError extends Error {
  constructor(
    message: string,
    readonly code: string,
    readonly cause?: unknown,
  ) {
    super(message);
    this.name = 'RetryablePipelineError';
  }
}

export const PIPELINE_ERROR_CODES = {
  SEND_TENANT_CAPACITY: 'SEND_TENANT_CAPACITY',
  SEND_CONVERSATION_LOCK: 'SEND_CONVERSATION_LOCK',
  SEND_PRIOR_BUBBLE_PENDING: 'SEND_PRIOR_BUBBLE_PENDING',
  ORCHESTRATION_FAILED: 'ORCHESTRATION_FAILED',
} as const;
