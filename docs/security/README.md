# Security Documentation Index

This file is the authoritative entry point for tenant-isolation work.

## Current documents

- `TENANT_ISOLATION_ROADMAP.md` — production position, sequencing, safety gates,
  and next approved candidate.
- `tenant-data-catalogue.md` — table-by-table ownership and deployed database
  boundary inventory.
- `database-client-boundary.md` — caller-JWT versus internal service-role rules.
- `single-agency-access-contract.md` — founder agency and customer workspace
  access model.
- `authenticated-endpoint-inventory.md` — application endpoint inventory.

## Completed implementation records

- `tenant-roster-rls-cutover-2026-07-12.md`
- `tenant-team-security-audit-and-fix-2026-07-12.md`

These records explain deployed changes and rollback. They are evidence, not the
source of current policy counts or future sequencing.

## Historical documents

Superseded security plans and point-in-time audits are stored in
`docs/archive/security/`. They must not be used to infer current production
state. Historical documents are retained so decisions and rollback context are
not lost.

Documents under `docs/reviews/` are dated review snapshots. A newer review or
the current roadmap takes precedence when statements conflict.

## Rules for future audits

1. Start from the commit under audit, this index, the roadmap, the data
   catalogue, and actual migration SQL.
2. Verify production state read-only before claiming a migration or policy is
   deployed.
3. Never treat an archived report, proposal, or branch worktree as current code.
4. Never edit or delete an applied migration to reduce file count.
5. Update the catalogue and roadmap in the same pull request as a security
   boundary change.
