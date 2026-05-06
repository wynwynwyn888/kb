-- Follow-up engine: persistent scheduled jobs per conversation

CREATE TABLE IF NOT EXISTS "conversation_follow_up_jobs" (
  "id" TEXT NOT NULL,
  "tenant_id" TEXT NOT NULL,
  "conversation_id" TEXT NOT NULL,
  "contact_id" TEXT NOT NULL,
  "ghl_location_id" TEXT NOT NULL,
  "step_number" INTEGER NOT NULL,
  "schedule_version" INTEGER NOT NULL DEFAULT 1,
  "scheduled_at" TIMESTAMP(3) NOT NULL,
  "due_at" TIMESTAMP(3) NOT NULL,
  "status" TEXT NOT NULL DEFAULT 'PENDING',
  "decided_at" TIMESTAMP(3),
  "sent_at" TIMESTAMP(3),
  "decision_reason" TEXT,
  "decision_meta" JSONB NOT NULL DEFAULT '{}'::jsonb,
  "last_defer_reason" TEXT,
  "last_defer_meta" JSONB NOT NULL DEFAULT '{}'::jsonb,
  "step_snapshot_json" JSONB NOT NULL DEFAULT '{}'::jsonb,
  "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updated_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

  CONSTRAINT "conversation_follow_up_jobs_pkey" PRIMARY KEY ("id")
);

CREATE INDEX IF NOT EXISTS "conversation_follow_up_jobs_tenant_id_idx" ON "conversation_follow_up_jobs"("tenant_id");
CREATE INDEX IF NOT EXISTS "conversation_follow_up_jobs_conversation_id_idx" ON "conversation_follow_up_jobs"("conversation_id");
CREATE INDEX IF NOT EXISTS "conversation_follow_up_jobs_status_idx" ON "conversation_follow_up_jobs"("status");
CREATE INDEX IF NOT EXISTS "conversation_follow_up_jobs_due_at_idx" ON "conversation_follow_up_jobs"("due_at");

