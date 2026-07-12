# Multi-option burst routing fix — 2026-07-12

## User-visible problem

When a customer sent several menu choices in a short burst, for example `2`, `3`, then `4`, the two-second trailing debounce correctly collected all three messages. The downstream deterministic option handler nevertheless used only the final message and sent the hardcoded single-choice fallback for option 4.

## Intended behaviour

- Every inbound reply resets the two-second trailing debounce.
- After two quiet seconds, all collected replies form one customer turn.
- If the turn contains two or more valid choices from the current tenant-configured menu, preserve every distinct choice in arrival order and generate one contextual reply covering all of them.
- A genuine single choice may continue to use the existing deterministic single-choice fallback.
- If any burst item is not a resolvable single menu choice, do not force multi-choice handling; retain the normal combined-message path.
- No industry-specific wording is introduced globally. The generated reply follows the tenant's Sales Playbook and prompt configuration.

## Implementation boundary

The option resolver now validates the complete debounced batch against the same current menu. Orchestration expands all resolved choices into retrieval, policy, routing, and generation context. The single-choice hardcoded template is explicitly disabled for a validated multi-choice burst. Generation receives a system-level constraint to cover every choice rather than silently reducing the turn to the last item.

The debounce timing, webhook ingestion, ordinary conversation generation, and tenant settings are unchanged.

## Safety and regression coverage

- Exact `2` → `3` → `4` burst resolves all three configured choices in order.
- Mixed bursts are rejected by the multi-choice resolver and use the existing combined-message flow.
- Duplicate choices are collapsed without reordering.
- Single-choice behaviour remains unchanged.
- Generation prompt coverage verifies every resolved choice is present and the generic single-choice fallback is prohibited.
- Full backend tests, backend build/typecheck, frontend tests, and frontend typecheck must pass before deployment.

## Rollback

Revert the deployment commit containing this document and the multi-option routing changes, redeploy the prior production commit `08b6de55db7455b1af494e80abc00e38757b7aeb`, and verify backend/frontend health. No database migration, data rewrite, secret, or tenant-setting rollback is required.

