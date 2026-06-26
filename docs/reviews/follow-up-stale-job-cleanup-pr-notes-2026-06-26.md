# Follow-Up Stale Job Cleanup — PR Notes

## Summary

Adds a periodic cleanup cron for stale/orphaned follow-up jobs. Previously, PENDING, FAILED, and SKIPPED rows accumulated indefinitely in `conversation_follow_up_jobs` with no automatic purging mechanism.

## Files Changed

| File | Change |
|------|--------|
| `src/modules/follow-up-engine/follow-up-engine.service.ts` | Add `OnModuleInit`/`OnModuleDestroy`, `cleanupStaleFollowUpJobs()` method |
| `src/modules/follow-up-engine/follow-up-engine-cleanup.spec.ts` | New: 7 tests for cleanup behavior |

## Stale Cleanup Definition

| Status | Threshold | Condition | Action |
|--------|-----------|-----------|--------|
| FAILED | 7 days since `created_at` | — | Set to `EXPIRED` |
| SKIPPED | 30 days since `created_at` | — | Set to `EXPIRED` |
| PENDING | 7 days since `due_at` | BullMQ job does NOT exist in Redis | Set to `EXPIRED` |
| PENDING | 7 days since `due_at` | BullMQ job STILL exists in Redis | **Skip** (don't touch) |

## Safety Rules

- **Never touches recent PENDING jobs** (within the 7-day window)
- **Checks BullMQ before expiring PENDING jobs** — if the delayed job still exists in Redis, it's left alone
- **Updates to `EXPIRED` instead of deleting** — preserves audit trail
- **Batch limit of 500 per status** — prevents long-running DB queries
- **Individual row failures don't stop the batch** — try/catch per row for PENDING
- **`BYPASS_FOLLOW_UP_CLEANUP_CRON=true`** skips cron timer (used in tests)
- **Runs once on startup** (60s delay) + **every 24 hours** thereafter via `setInterval`
- **No new npm dependencies** — uses `OnModuleInit` + `setInterval` pattern

## Test Coverage

| # | Scenario | Result |
|---|----------|--------|
| 1 | Zero stale jobs → returns 0 | Pass |
| 2 | 2 stale FAILED jobs → expired | Pass |
| 3 | PENDING with existing BullMQ job → skipped | Pass |
| 4 | Orphaned PENDING (no Bull job) → expired | Pass |
| 5 | Idempotent (second run finds nothing) | Pass |
| 6 | DB error → doesn't throw, returns 0 | Pass |
| 7 | All existing follow-up tests still pass | Pass (15 existing + 6 new = 21) |

## Rollback

- Revert the commit. `setInterval` is stopped on `onModuleDestroy`. No DB migration to reverse.
- Jobs already marked `EXPIRED` remain expired. This is harmless — they were already definitively resolved.

## What Was NOT Changed

- No DB schema changes
- No migrations
- No env changes (uses existing `BYPASS_FOLLOW_UP_CLEANUP_CRON` pattern)
- No runtime flag changes
- No frontend changes
- No message sending behavior changes
- No new npm dependencies
