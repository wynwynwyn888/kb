## Why

Live booking conversations showed contradictory steps: slots offered before contact details, one-by-one name/phone after a slot pick, slot lists repeated, and "yes" on a chosen time re-opening a 3-option list. Root cause was split ask priorities (`CORE_ASK_PRIORITY` vs `PRE_SCHEDULING` vs batch) and batch gating that ignored time-window intake.

## What Changes

- Introduce `booking-flow-guards.ts` with explicit phase checks: pre-scheduling complete, contact batch allowed, may offer live slots.
- Treat `preferredTimeWindow` (e.g. morning) as sufficient scheduling intake for batch contact ask.
- Block GHL slot fetch until contact/custom batch is complete.
- `selectNextAskFieldId` only asks pre-scheduling fields (never required custom one-by-one before batch).
- Clear stale `offeredSlots` when returning to `collecting_details` for field asks.
- Multi-slot affirmative / time reply maps to `selected_slot` when it matches `preferredTime`.

## Test Plan

- Unit: `booking-batch-details.spec.ts`, `booking-flow-guards` morning-window case.
- Unit: `conversation-booking-flow.service.spec.ts` batch + offered_slots paths.
- Manual: date → morning → batch bullets → slots → pick 1 → book (no name/phone loop).
