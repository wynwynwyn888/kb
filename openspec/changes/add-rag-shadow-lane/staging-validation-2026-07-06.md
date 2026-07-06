# Staging Validation: RAG Vector Context

Date: 2026-07-06
Branch: `feat/rag-shadow-lane-phase1`
Tenant: `stg-rag-tenant`
Document: `stg-rag-doc-1`

## Scope

Validated the staging-only vector context path with the reusable evaluator:

```bash
pnpm --filter @aisbp/backend exec tsx scripts/evaluate-kb-rag-context.ts --tenant stg-rag-tenant ...
```

The run used staging env only. Production was not touched.

## Findings

- Default threshold `0.2` was too permissive for this tiny staging corpus.
- At `0.2`, all pricing questions worked, but several unrelated questions still entered vector context.
- Raising the default threshold to `0.3` kept all pricing/plans questions prompt-eligible and made unrelated questions fall back.

## Final 20-Question Result With Default Threshold

After changing the default `KB_VECTOR_CONTEXT_MIN_SCORE` to `0.3`:

- Pricing/plans questions: 10/10 vector prompt-eligible.
- Unrelated/control questions: 10/10 fallback, not vector prompt-eligible.
- Final summary: `queryCount=20`, `promptEligibleCount=10`.

Positive pricing/plans examples:

- `What are your prices?`
- `How much is the Pro plan?`
- `What does Basic cost?`
- `Tell me about enterprise pricing`
- `What are your plan tiers?`

Negative/control examples:

- `Do you sell cars?`
- `Can you repair my laptop?`
- `What is the weather today?`
- `What is your refund policy?`
- `What are your business hours?`

## Decision

Use `0.3` as the safer staging default for vector context.

Production remains blocked until the remaining canary gates are explicitly approved and completed.
