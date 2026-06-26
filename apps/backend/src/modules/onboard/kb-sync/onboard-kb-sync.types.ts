export interface KbSyncWriteOp {
  table: string;
  operation: 'CREATE' | 'UPDATE' | 'UPSERT';
  fields: Record<string, unknown>;
  notes?: string;
}

export interface KbSyncPlan {
  phase: number;
  phaseName: string;
  operations: KbSyncWriteOp[];
  preconditions: string[];
  rollbackNotes: string;
}
