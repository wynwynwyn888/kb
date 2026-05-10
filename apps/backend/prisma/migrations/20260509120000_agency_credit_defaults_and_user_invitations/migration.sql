-- Agency-wide credit defaults for new workspaces + user invitations (Supabase Auth invite flow)

CREATE TYPE "CreditDeductionMethod" AS ENUM ('PER_LOGICAL_REPLY', 'PER_MESSAGE_BUBBLE');

ALTER TABLE "agencies"
  ADD COLUMN "credit_deduction_method" "CreditDeductionMethod" NOT NULL DEFAULT 'PER_LOGICAL_REPLY',
  ADD COLUMN "default_allow_temporary_overage" BOOLEAN NOT NULL DEFAULT false,
  ADD COLUMN "default_overage_limit_credits" INTEGER NOT NULL DEFAULT 0,
  ADD COLUMN "default_low_credit_warning_enabled" BOOLEAN NOT NULL DEFAULT false,
  ADD COLUMN "default_low_credit_warning_level_credits" INTEGER NOT NULL DEFAULT 0;

CREATE TYPE "InvitationScope" AS ENUM ('AGENCY', 'WORKSPACE');

CREATE TYPE "InvitationStatus" AS ENUM ('PENDING', 'ACCEPTED', 'REVOKED', 'EXPIRED');

CREATE TABLE "user_invitations" (
  "id" TEXT NOT NULL,
  "email_normalized" TEXT NOT NULL,
  "email_original" TEXT NOT NULL,
  "scope" "InvitationScope" NOT NULL,
  "agency_id" TEXT NOT NULL,
  "tenant_id" TEXT,
  "role" TEXT NOT NULL,
  "invited_by_profile_id" TEXT NOT NULL,
  "status" "InvitationStatus" NOT NULL DEFAULT 'PENDING',
  "expires_at" TIMESTAMP(3) NOT NULL,
  "accepted_at" TIMESTAMP(3),
  "accepted_profile_id" TEXT,
  "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updated_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

  CONSTRAINT "user_invitations_pkey" PRIMARY KEY ("id")
);

CREATE INDEX "user_invitations_agency_email_status_idx"
  ON "user_invitations" ("agency_id", "email_normalized", "status");

CREATE INDEX "user_invitations_tenant_email_status_idx"
  ON "user_invitations" ("tenant_id", "email_normalized", "status");

ALTER TABLE "user_invitations"
  ADD CONSTRAINT "user_invitations_agency_id_fkey"
  FOREIGN KEY ("agency_id") REFERENCES "agencies"("id") ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "user_invitations"
  ADD CONSTRAINT "user_invitations_tenant_id_fkey"
  FOREIGN KEY ("tenant_id") REFERENCES "tenants"("id") ON DELETE CASCADE ON UPDATE CASCADE;
