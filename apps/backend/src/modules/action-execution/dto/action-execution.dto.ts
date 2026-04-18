// Action execution DTOs

// Note: params.tags from SuggestedAction maps to tags in execution (add-only in this pass)
export interface TagContactParams {
  tags: string[];
  contactId?: string;
}

export interface ExecutionResult {
  id: string;
  status: 'EXECUTED' | 'FAILED';
  executedAt?: string;
  errorNote?: string;
}

export interface ExecutionConditions {
  succeeded: number;
  planStatus: string;
}

// BookSlot required and optional params
// Required fields must be present for execution to proceed
export interface BookSlotParams {
  calendarId: string;
  startTime: string;
  endTime: string;
  title?: string;
  contactId?: string;
  timezone?: string;
  appointmentStatus?: string;
}
