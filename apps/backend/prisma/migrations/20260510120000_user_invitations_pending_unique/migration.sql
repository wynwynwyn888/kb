-- Prevent duplicate active pending invites for the same recipient + scope.
-- Tenant_id is nullable for AGENCY-scoped invites; COALESCE to '' so the index
-- treats "no workspace" as a single distinct value rather than NULL (which
-- Postgres would otherwise consider non-equal to itself).

CREATE UNIQUE INDEX IF NOT EXISTS "user_invitations_pending_unique"
  ON "user_invitations" (
    "agency_id",
    COALESCE("tenant_id", ''),
    "scope",
    "email_normalized"
  )
  WHERE "status" = 'PENDING';
