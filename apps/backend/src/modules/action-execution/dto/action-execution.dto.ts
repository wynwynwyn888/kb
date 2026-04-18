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
