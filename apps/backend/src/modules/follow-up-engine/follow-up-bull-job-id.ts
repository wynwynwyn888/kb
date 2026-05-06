/** BullMQ custom job IDs must not contain ":" (Redis stream key restriction). Prefer DB row id prefix only. */
export function toBullSafeFollowUpJobId(followUpJobId: string): string {
  return `followup-${followUpJobId.replace(/[^a-zA-Z0-9_-]/g, '-')}`;
}
