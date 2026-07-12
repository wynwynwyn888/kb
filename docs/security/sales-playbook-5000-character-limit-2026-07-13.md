# Sales Playbook 5,000-character limit

Date: 2026-07-13

## Change

The shared Sales Playbook character limit is increased from 3,000 to 5,000. The shared constant is consumed by:

- the frontend editor, expanded editor, character counter, and helper text;
- backend create/update validation;
- the runtime tenant-section prompt budget used for live AI replies and preview parity.

The database column is PostgreSQL `TEXT`, so no schema migration or data rewrite is required.

## Runtime guarantee

Sales Playbook content of exactly 5,000 characters is preserved in full. Content is rejected by the write API above 5,000 characters; the runtime compactor independently preserves 5,000 and marks/truncates only oversized legacy data above that limit. Sales Playbook has its own section budget and does not compete with the legacy combined tenant-prompt cap.

## Verification

- frontend shared limit equals 5,000;
- backend accepts exactly 5,000 and rejects 5,001;
- runtime compaction preserves exactly 5,000 without a truncation marker;
- backend and frontend typechecks pass;
- backend and frontend production builds pass.

## Rollback

Revert the deployment commit and redeploy production commit `40068c2a87be76a3c3deeebf9f0fccc752a8821e`. Any Sales Playbook already saved above 3,000 characters should be shortened before rollback, otherwise the former frontend/backend limit will reject subsequent edits even though PostgreSQL will retain the stored text.

