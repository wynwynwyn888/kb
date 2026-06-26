-- AISBP-Onboard: Onboarding control app tables (PR 3)
-- Additive, idempotent. All tables use IF NOT EXISTS.
-- Uses onboard_ prefix to avoid collision with existing KB tables.
-- No backfill required — all new tables for new workflow.

-- ============================================================================
-- ENUMS
-- ============================================================================

DO $$ BEGIN
  CREATE TYPE "OnboardClientStatus" AS ENUM ('DRAFT', 'ACTIVE', 'PAUSED', 'ARCHIVED');
EXCEPTION WHEN duplicate_object THEN null;
END $$;

DO $$ BEGIN
  CREATE TYPE "OnboardProjectStatus" AS ENUM ('DRAFT', 'SUBMITTED', 'IN_REVIEW', 'CHANGES_REQUESTED', 'APPROVED', 'SYNCING', 'LIVE', 'PAUSED', 'ARCHIVED');
EXCEPTION WHEN duplicate_object THEN null;
END $$;

DO $$ BEGIN
  CREATE TYPE "OnboardProjectPhase" AS ENUM ('INTAKE', 'ANALYSIS', 'REVIEW', 'SYNC', 'LIVE');
EXCEPTION WHEN duplicate_object THEN null;
END $$;

DO $$ BEGIN
  CREATE TYPE "OnboardSectionStatus" AS ENUM ('EMPTY', 'PARTIAL', 'COMPLETE', 'APPROVED', 'REJECTED');
EXCEPTION WHEN duplicate_object THEN null;
END $$;

DO $$ BEGIN
  CREATE TYPE "OnboardAnswerSource" AS ENUM ('AGENT', 'CLIENT_DIRECT', 'OPERATOR_MANUAL');
EXCEPTION WHEN duplicate_object THEN null;
END $$;

DO $$ BEGIN
  CREATE TYPE "OnboardFaqStatus" AS ENUM ('DRAFT', 'APPROVED', 'REJECTED');
EXCEPTION WHEN duplicate_object THEN null;
END $$;

DO $$ BEGIN
  CREATE TYPE "OnboardFaqSource" AS ENUM ('AGENT', 'OPERATOR', 'CLIENT');
EXCEPTION WHEN duplicate_object THEN null;
END $$;

DO $$ BEGIN
  CREATE TYPE "OnboardFaqCategory" AS ENUM ('PRICING', 'SERVICES', 'BOOKING', 'OBJECTION', 'LOCATION_HOURS', 'PAYMENT', 'COMPETITOR', 'OTHER');
EXCEPTION WHEN duplicate_object THEN null;
END $$;

DO $$ BEGIN
  CREATE TYPE "OnboardRecommendationType" AS ENUM ('BOOKING', 'HANDOVER', 'FOLLOW_UP', 'TAGGING', 'PROMPT', 'KNOWLEDGE', 'OTHER');
EXCEPTION WHEN duplicate_object THEN null;
END $$;

DO $$ BEGIN
  CREATE TYPE "OnboardRecommendationRiskLevel" AS ENUM ('LOW', 'MEDIUM', 'HIGH');
EXCEPTION WHEN duplicate_object THEN null;
END $$;

DO $$ BEGIN
  CREATE TYPE "OnboardRecommendationStatus" AS ENUM ('SUGGESTED', 'ACCEPTED', 'REJECTED', 'MODIFIED');
EXCEPTION WHEN duplicate_object THEN null;
END $$;

DO $$ BEGIN
  CREATE TYPE "OnboardRecommendationSource" AS ENUM ('AI_ANALYSIS', 'OPERATOR_MANUAL');
EXCEPTION WHEN duplicate_object THEN null;
END $$;

DO $$ BEGIN
  CREATE TYPE "OnboardSessionAgentType" AS ENUM ('WHATSAPP_AI', 'WEB_CHAT', 'OTHER');
EXCEPTION WHEN duplicate_object THEN null;
END $$;

DO $$ BEGIN
  CREATE TYPE "OnboardSessionStatus" AS ENUM ('ACTIVE', 'PAUSED', 'COMPLETED', 'EXPIRED');
EXCEPTION WHEN duplicate_object THEN null;
END $$;

DO $$ BEGIN
  CREATE TYPE "OnboardApprovalAction" AS ENUM ('APPROVE_SECTION', 'REJECT_SECTION', 'REQUEST_CHANGES', 'APPROVE_PROJECT', 'REJECT_PROJECT', 'TRIGGER_SYNC');
EXCEPTION WHEN duplicate_object THEN null;
END $$;

DO $$ BEGIN
  CREATE TYPE "OnboardApprovalTargetType" AS ENUM ('SECTION', 'PROJECT');
EXCEPTION WHEN duplicate_object THEN null;
END $$;

DO $$ BEGIN
  CREATE TYPE "OnboardActorType" AS ENUM ('OPERATOR', 'AGENT', 'ADMIN', 'SERVICE', 'VIEWER');
EXCEPTION WHEN duplicate_object THEN null;
END $$;

DO $$ BEGIN
  CREATE TYPE "OnboardSyncTargetSystem" AS ENUM ('KB', 'GHL');
EXCEPTION WHEN duplicate_object THEN null;
END $$;

DO $$ BEGIN
  CREATE TYPE "OnboardSyncMode" AS ENUM ('DRY_RUN', 'APPLY', 'ROLLBACK');
EXCEPTION WHEN duplicate_object THEN null;
END $$;

DO $$ BEGIN
  CREATE TYPE "OnboardSyncStatus" AS ENUM ('PENDING', 'DRY_RUN_PASSED', 'DRY_RUN_FAILED', 'APPLIED', 'APPLY_FAILED', 'ROLLED_BACK');
EXCEPTION WHEN duplicate_object THEN null;
END $$;

DO $$ BEGIN
  CREATE TYPE "OnboardConversationGoal" AS ENUM ('BOOK_APPOINTMENT', 'COLLECT_LEAD', 'ANSWER_FAQS', 'QUALIFY_LEAD', 'ROUTE_TO_HUMAN', 'SEND_BOOKING_LINK', 'OTHER');
EXCEPTION WHEN duplicate_object THEN null;
END $$;

DO $$ BEGIN
  CREATE TYPE "OnboardChannelPreference" AS ENUM ('WHATSAPP', 'SMS', 'BOTH');
EXCEPTION WHEN duplicate_object THEN null;
END $$;

DO $$ BEGIN
  CREATE TYPE "OnboardToneOfVoice" AS ENUM ('FRIENDLY', 'PROFESSIONAL', 'CASUAL', 'FORMAL');
EXCEPTION WHEN duplicate_object THEN null;
END $$;

DO $$ BEGIN
  CREATE TYPE "OnboardHandoverMethod" AS ENUM ('SMS', 'WHATSAPP', 'CALL');
EXCEPTION WHEN duplicate_object THEN null;
END $$;

-- ============================================================================
-- TABLES
-- ============================================================================

-- 1. onboard_clients
CREATE TABLE IF NOT EXISTS "onboard_clients" (
  "id"              TEXT NOT NULL PRIMARY KEY,
  "client_key"      TEXT NOT NULL,
  "display_name"    TEXT NOT NULL,
  "contact_name"    TEXT,
  "contact_phone"   TEXT,
  "contact_email"   TEXT,
  "whatsapp_phone"  TEXT,
  "industry"        TEXT,
  "website_url"     TEXT,
  "timezone"        TEXT NOT NULL DEFAULT 'Asia/Singapore',
  "status"          "OnboardClientStatus" NOT NULL DEFAULT 'DRAFT',
  "created_at"      TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updated_at"      TIMESTAMP(3) NOT NULL
);

CREATE UNIQUE INDEX IF NOT EXISTS "onboard_clients_client_key_key" ON "onboard_clients"("client_key");
CREATE INDEX IF NOT EXISTS "onboard_clients_status_idx" ON "onboard_clients"("status");

-- 2. onboarding_projects
CREATE TABLE IF NOT EXISTS "onboarding_projects" (
  "id"                TEXT NOT NULL PRIMARY KEY,
  "client_id"         TEXT NOT NULL REFERENCES "onboard_clients"("id") ON DELETE CASCADE,
  "status"            "OnboardProjectStatus" NOT NULL DEFAULT 'DRAFT',
  "current_phase"     "OnboardProjectPhase" NOT NULL DEFAULT 'INTAKE',
  "submitted_at"      TIMESTAMP(3),
  "approved_at"       TIMESTAMP(3),
  "approved_by"       TEXT,
  "sync_started_at"   TIMESTAMP(3),
  "sync_completed_at" TIMESTAMP(3),
  "version"           INTEGER NOT NULL DEFAULT 1,
  "metadata"          JSONB NOT NULL DEFAULT '{}',
  "created_at"        TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updated_at"        TIMESTAMP(3) NOT NULL
);

CREATE INDEX IF NOT EXISTS "onboarding_projects_client_id_idx" ON "onboarding_projects"("client_id");
CREATE INDEX IF NOT EXISTS "onboarding_projects_status_idx" ON "onboarding_projects"("status");
CREATE INDEX IF NOT EXISTS "onboarding_projects_client_id_status_idx" ON "onboarding_projects"("client_id", "status");

-- 3. onboarding_identity_map
CREATE TABLE IF NOT EXISTS "onboarding_identity_map" (
  "id"                  TEXT NOT NULL PRIMARY KEY,
  "project_id"          TEXT NOT NULL REFERENCES "onboarding_projects"("id") ON DELETE CASCADE,
  "onboard_client_id"   TEXT NOT NULL REFERENCES "onboard_clients"("id") ON DELETE CASCADE,
  "kb_tenant_id"        TEXT,
  "ghl_location_id"     TEXT,
  "ghl_contact_id"      TEXT,
  "ghl_conversation_id" TEXT,
  "created_at"          TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updated_at"          TIMESTAMP(3) NOT NULL
);

CREATE UNIQUE INDEX IF NOT EXISTS "onboarding_identity_map_project_id_key" ON "onboarding_identity_map"("project_id");
CREATE INDEX IF NOT EXISTS "onboarding_identity_map_kb_tenant_id_idx" ON "onboarding_identity_map"("kb_tenant_id");

-- 4. business_profiles
CREATE TABLE IF NOT EXISTS "business_profiles" (
  "id"               TEXT NOT NULL PRIMARY KEY,
  "project_id"        TEXT NOT NULL REFERENCES "onboarding_projects"("id") ON DELETE CASCADE,
  "section_status"    "OnboardSectionStatus" NOT NULL DEFAULT 'EMPTY',
  "business_name"     TEXT NOT NULL,
  "description"       TEXT,
  "services"          JSONB NOT NULL DEFAULT '[]',
  "products"          JSONB NOT NULL DEFAULT '[]',
  "pricing_policy"    TEXT,
  "deposit_policy"    TEXT,
  "opening_hours"     JSONB NOT NULL DEFAULT '{}',
  "target_customer"   TEXT,
  "service_area"      TEXT,
  "forbidden_topics"  JSONB NOT NULL DEFAULT '[]',
  "forbidden_claims"  JSONB NOT NULL DEFAULT '[]',
  "created_at"        TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updated_at"        TIMESTAMP(3) NOT NULL
);

CREATE UNIQUE INDEX IF NOT EXISTS "business_profiles_project_id_key" ON "business_profiles"("project_id");

-- 5. sales_process_maps
CREATE TABLE IF NOT EXISTS "sales_process_maps" (
  "id"                          TEXT NOT NULL PRIMARY KEY,
  "project_id"                   TEXT NOT NULL REFERENCES "onboarding_projects"("id") ON DELETE CASCADE,
  "section_status"               "OnboardSectionStatus" NOT NULL DEFAULT 'EMPTY',
  "lead_sources"                 JSONB NOT NULL DEFAULT '[]',
  "conversation_goal"            "OnboardConversationGoal",
  "primary_cta"                  TEXT,
  "booking_link"                 TEXT,
  "lead_fields_to_collect"       JSONB NOT NULL DEFAULT '[]',
  "max_questions_before_booking" INTEGER,
  "channel_preference"           "OnboardChannelPreference",
  "pipeline_name"                TEXT,
  "pipeline_stages"              JSONB NOT NULL DEFAULT '[]',
  "conflicting_workflows"        JSONB NOT NULL DEFAULT '[]',
  "created_at"                   TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updated_at"                   TIMESTAMP(3) NOT NULL
);

CREATE UNIQUE INDEX IF NOT EXISTS "sales_process_maps_project_id_key" ON "sales_process_maps"("project_id");

-- 6. faq_items
CREATE TABLE IF NOT EXISTS "faq_items" (
  "id"          TEXT NOT NULL PRIMARY KEY,
  "project_id"  TEXT NOT NULL REFERENCES "onboarding_projects"("id") ON DELETE CASCADE,
  "category"    "OnboardFaqCategory" NOT NULL,
  "question"    TEXT NOT NULL,
  "answer"      TEXT NOT NULL,
  "sort_order"  INTEGER,
  "source"      "OnboardFaqSource" NOT NULL DEFAULT 'AGENT',
  "status"      "OnboardFaqStatus" NOT NULL DEFAULT 'DRAFT',
  "approved_by" TEXT,
  "created_at"  TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updated_at"  TIMESTAMP(3) NOT NULL
);

CREATE INDEX IF NOT EXISTS "faq_items_project_id_category_idx" ON "faq_items"("project_id", "category");
CREATE INDEX IF NOT EXISTS "faq_items_status_idx" ON "faq_items"("status");

-- 7. prompt_configs
CREATE TABLE IF NOT EXISTS "prompt_configs" (
  "id"                 TEXT NOT NULL PRIMARY KEY,
  "project_id"          TEXT NOT NULL REFERENCES "onboarding_projects"("id") ON DELETE CASCADE,
  "section_status"      "OnboardSectionStatus" NOT NULL DEFAULT 'EMPTY',
  "persona"             TEXT,
  "tone_of_voice"       "OnboardToneOfVoice",
  "conversation_goals"  JSONB NOT NULL DEFAULT '[]',
  "business_notes"      TEXT,
  "language"            TEXT,
  "use_singlish"        BOOLEAN NOT NULL DEFAULT false,
  "max_reply_length"    INTEGER,
  "example_good_reply"  TEXT,
  "example_bad_reply"   TEXT,
  "greetings"           JSONB NOT NULL DEFAULT '[]',
  "sign_offs"           JSONB NOT NULL DEFAULT '[]',
  "created_at"          TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updated_at"          TIMESTAMP(3) NOT NULL
);

CREATE UNIQUE INDEX IF NOT EXISTS "prompt_configs_project_id_key" ON "prompt_configs"("project_id");

-- 8. handover_rules
CREATE TABLE IF NOT EXISTS "handover_rules" (
  "id"                     TEXT NOT NULL PRIMARY KEY,
  "project_id"              TEXT NOT NULL REFERENCES "onboarding_projects"("id") ON DELETE CASCADE,
  "section_status"          "OnboardSectionStatus" NOT NULL DEFAULT 'EMPTY',
  "handover_contact_name"   TEXT,
  "handover_contact_phone"  TEXT,
  "handover_method"         "OnboardHandoverMethod",
  "handover_availability"   TEXT,
  "emergency_contact"       TEXT,
  "triggers"                JSONB NOT NULL DEFAULT '[]',
  "created_at"              TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updated_at"              TIMESTAMP(3) NOT NULL
);

CREATE UNIQUE INDEX IF NOT EXISTS "handover_rules_project_id_key" ON "handover_rules"("project_id");

-- 9. follow_up_rules
CREATE TABLE IF NOT EXISTS "follow_up_rules" (
  "id"                   TEXT NOT NULL PRIMARY KEY,
  "project_id"            TEXT NOT NULL REFERENCES "onboarding_projects"("id") ON DELETE CASCADE,
  "section_status"        "OnboardSectionStatus" NOT NULL DEFAULT 'EMPTY',
  "enabled"               BOOLEAN NOT NULL DEFAULT false,
  "goal"                  TEXT,
  "tone"                  TEXT,
  "cadence_hours"         INTEGER,
  "stop_conditions"       JSONB NOT NULL DEFAULT '[]',
  "do_not_message_rules"  JSONB NOT NULL DEFAULT '[]',
  "dormant_reactivation"  BOOLEAN NOT NULL DEFAULT false,
  "created_at"            TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updated_at"            TIMESTAMP(3) NOT NULL
);

CREATE UNIQUE INDEX IF NOT EXISTS "follow_up_rules_project_id_key" ON "follow_up_rules"("project_id");

-- 10. automation_recommendations
CREATE TABLE IF NOT EXISTS "automation_recommendations" (
  "id"                  TEXT NOT NULL PRIMARY KEY,
  "project_id"           TEXT NOT NULL REFERENCES "onboarding_projects"("id") ON DELETE CASCADE,
  "recommendation_type"  "OnboardRecommendationType" NOT NULL,
  "title"                TEXT NOT NULL,
  "description"          TEXT NOT NULL,
  "rationale"            TEXT,
  "risk_level"           "OnboardRecommendationRiskLevel" NOT NULL,
  "suggested_config"     JSONB NOT NULL DEFAULT '{}',
  "status"               "OnboardRecommendationStatus" NOT NULL DEFAULT 'SUGGESTED',
  "reviewed_by"          TEXT,
  "reviewed_at"          TIMESTAMP(3),
  "source"               "OnboardRecommendationSource" NOT NULL DEFAULT 'AI_ANALYSIS',
  "created_at"           TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updated_at"           TIMESTAMP(3) NOT NULL
);

CREATE INDEX IF NOT EXISTS "automation_recommendations_project_id_type_idx" ON "automation_recommendations"("project_id", "recommendation_type");
CREATE INDEX IF NOT EXISTS "automation_recommendations_status_idx" ON "automation_recommendations"("status");

-- 11. agent_interview_sessions
CREATE TABLE IF NOT EXISTS "agent_interview_sessions" (
  "id"           TEXT NOT NULL PRIMARY KEY,
  "project_id"   TEXT NOT NULL REFERENCES "onboarding_projects"("id") ON DELETE CASCADE,
  "agent_type"   "OnboardSessionAgentType" NOT NULL DEFAULT 'WHATSAPP_AI',
  "status"       "OnboardSessionStatus" NOT NULL DEFAULT 'ACTIVE',
  "current_step" TEXT,
  "total_steps"  INTEGER,
  "expires_at"   TIMESTAMP(3),
  "metadata"     JSONB NOT NULL DEFAULT '{}',
  "created_at"   TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updated_at"   TIMESTAMP(3) NOT NULL
);

CREATE INDEX IF NOT EXISTS "agent_interview_sessions_project_id_status_idx" ON "agent_interview_sessions"("project_id", "status");

-- 12. agent_interview_answers
CREATE TABLE IF NOT EXISTS "agent_interview_answers" (
  "id"              TEXT NOT NULL PRIMARY KEY,
  "session_id"      TEXT NOT NULL REFERENCES "agent_interview_sessions"("id") ON DELETE CASCADE,
  "project_id"      TEXT NOT NULL REFERENCES "onboarding_projects"("id") ON DELETE CASCADE,
  "section"         TEXT NOT NULL,
  "question_key"    TEXT NOT NULL,
  "question_label"  TEXT,
  "answer_value"    JSONB NOT NULL,
  "confidence"      DOUBLE PRECISION,
  "source"          "OnboardAnswerSource" NOT NULL DEFAULT 'AGENT',
  "idempotency_key" TEXT,
  "created_at"      TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updated_at"      TIMESTAMP(3) NOT NULL
);

CREATE UNIQUE INDEX IF NOT EXISTS "agent_interview_answers_project_id_section_question_key_key" ON "agent_interview_answers"("project_id", "section", "question_key");
CREATE UNIQUE INDEX IF NOT EXISTS "agent_interview_answers_idempotency_key_key" ON "agent_interview_answers"("idempotency_key");
CREATE INDEX IF NOT EXISTS "agent_interview_answers_session_id_section_idx" ON "agent_interview_answers"("session_id", "section");

-- 13. approval_events
CREATE TABLE IF NOT EXISTS "approval_events" (
  "id"              TEXT NOT NULL PRIMARY KEY,
  "project_id"      TEXT NOT NULL REFERENCES "onboarding_projects"("id") ON DELETE CASCADE,
  "actor_id"        TEXT NOT NULL,
  "actor_type"      "OnboardActorType" NOT NULL,
  "action"          "OnboardApprovalAction" NOT NULL,
  "target_type"     "OnboardApprovalTargetType" NOT NULL,
  "target_id"       TEXT NOT NULL,
  "comment"         TEXT,
  "previous_status" TEXT,
  "new_status"      TEXT,
  "created_at"      TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE INDEX IF NOT EXISTS "approval_events_project_id_created_at_idx" ON "approval_events"("project_id", "created_at");
CREATE INDEX IF NOT EXISTS "approval_events_actor_id_idx" ON "approval_events"("actor_id");

-- 14. sync_runs
CREATE TABLE IF NOT EXISTS "sync_runs" (
  "id"               TEXT NOT NULL PRIMARY KEY,
  "project_id"        TEXT NOT NULL REFERENCES "onboarding_projects"("id") ON DELETE CASCADE,
  "target_system"     "OnboardSyncTargetSystem" NOT NULL,
  "mode"              "OnboardSyncMode" NOT NULL,
  "status"            "OnboardSyncStatus" NOT NULL DEFAULT 'PENDING',
  "idempotency_key"   TEXT NOT NULL,
  "request_payload"   JSONB,
  "response_payload"  JSONB,
  "error_message"     TEXT,
  "triggered_by"      TEXT NOT NULL,
  "version"           INTEGER NOT NULL DEFAULT 1,
  "duration_ms"       INTEGER,
  "created_at"        TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "completed_at"      TIMESTAMP(3)
);

CREATE UNIQUE INDEX IF NOT EXISTS "sync_runs_idempotency_key_key" ON "sync_runs"("idempotency_key");
CREATE INDEX IF NOT EXISTS "sync_runs_project_id_idx" ON "sync_runs"("project_id");
CREATE INDEX IF NOT EXISTS "sync_runs_target_system_status_idx" ON "sync_runs"("target_system", "status");

-- 15. audit_events
CREATE TABLE IF NOT EXISTS "audit_events" (
  "id"             TEXT NOT NULL PRIMARY KEY,
  "project_id"      TEXT REFERENCES "onboarding_projects"("id") ON DELETE SET NULL,
  "actor_id"        TEXT NOT NULL,
  "actor_type"      "OnboardActorType" NOT NULL,
  "action"          TEXT NOT NULL,
  "resource_type"   TEXT NOT NULL,
  "resource_id"     TEXT NOT NULL,
  "changes"         JSONB NOT NULL DEFAULT '{}',
  "ip_address"      TEXT,
  "user_agent"      TEXT,
  "correlation_id"  TEXT,
  "created_at"      TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE INDEX IF NOT EXISTS "audit_events_project_id_created_at_idx" ON "audit_events"("project_id", "created_at");
CREATE INDEX IF NOT EXISTS "audit_events_actor_id_idx" ON "audit_events"("actor_id");
CREATE INDEX IF NOT EXISTS "audit_events_action_idx" ON "audit_events"("action");
