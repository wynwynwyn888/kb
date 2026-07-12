# Current Next Steps

Status: **CURRENT INDEX**

This file intentionally points to authoritative, scoped plans instead of
duplicating their task lists.

## Active security program

Continue tenant isolation using
`docs/security/TENANT_ISOLATION_ROADMAP.md`. The booking-settings caller-read and
manager-role cutover is the current phase. Select the following resource only
after production verification and the roadmap safety gates are complete.

## Production operations

Use `docs/AISBP_PRODUCTION_SMOKE_TEST.md` for live smoke testing and
`docs/VPS_DEPLOY.md` for deployment operations.

## Product and architecture

Use `docs/architecture.md` for current architecture and the applicable
OpenSpec change directory for proposed feature work. A proposal or archived
document is not evidence that code is deployed.

## Source-of-truth rule

When documentation conflicts, current code and migrations at the audited commit,
read-only production verification, and the current scoped roadmap take
precedence. Historical material is under `docs/archive/` or explicitly marked as
a dated snapshot.
