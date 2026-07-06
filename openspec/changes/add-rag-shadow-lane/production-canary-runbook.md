# Production Canary Runbook: KB RAG

Status: not approved, not executed.

This runbook exists so production rollout is boring and reversible. Do not run
any production step until the owner explicitly approves it in the current
session.

## Current Guarantees

- Default flags are off.
- Vector context requires tenant allowlist.
- Embedding jobs require tenant allowlist.
- Production-like envs require exact acknowledgement variables in addition to
  the normal flags and allowlists.
- Keyword KB remains the fallback.
- Disable `KB_VECTOR_CONTEXT_ENABLED` to stop RAG context immediately.

## Preflight

1. Rotate any staging/production service-role keys that were pasted into chat.
2. Confirm the deploy branch/commit.
3. Confirm a single canary tenant ID.
4. Confirm the tenant has an OpenAI provider key available through the agency
   provider resolver.
5. Confirm no broad tenant allowlists are set.
6. Confirm `KB_VECTOR_RETRIEVAL_ENABLED=false`; this legacy flag is not used by
   the new RAG path.

## Step 1: Production Additive Migration

Requires explicit owner approval.

Apply only the additive pgvector migration:

- `vector` extension
- nullable embedding/lifecycle columns on `knowledge_chunks`
- vector index
- service-role-only RPCs

After migration:

- Verify existing KB reads/writes still work.
- Verify `check_pgvector_available` with service role.
- Verify anon/authenticated roles cannot execute vector RPCs.

Rollback:

- Disable all RAG flags.
- Do not drop columns/RPCs unless there is a confirmed schema-level incident.

## Step 2: Shadow-Only Canary

Set only:

```env
KB_VECTOR_SHADOW_ENABLED=true
KB_VECTOR_SHADOW_TENANT_IDS=<one-canary-tenant-id>
```

Do not enable vector context yet.

Watch:

- reply latency
- error rate
- logs with `kb_vector_shadow`
- OpenAI embedding usage

NO-GO:

- customer replies change unexpectedly
- reply/no-reply behavior changes
- repeated OpenAI/RPC failures
- spend is higher than expected

Rollback:

```env
KB_VECTOR_SHADOW_ENABLED=false
KB_VECTOR_SHADOW_TENANT_IDS=
```

## Step 3: Backfill One Canary Tenant

Run tenant-limited backfill only:

```bash
pnpm --filter @aisbp/backend exec tsx scripts/backfill-kb-embeddings.ts \
  --tenant <one-canary-tenant-id> \
  --limit 100 \
  --batch-size 16 \
  --status pending
```

For production-like envs, the script requires:

```env
KB_EMBEDDING_BACKFILL_ALLOW=YES_RUN_KB_EMBEDDING_BACKFILL
```

Watch:

- embedded/skipped/failed summary
- OpenAI spend
- RPC failures

NO-GO:

- cross-tenant rows appear in logs
- failure count is non-trivial
- backfill touches more tenants than intended

## Step 4: Automatic Embedding Maintenance Canary

Set only for the canary tenant:

```env
KB_EMBEDDING_JOBS_ENABLED=true
KB_EMBEDDING_JOB_TENANT_IDS=<one-canary-tenant-id>
KB_EMBEDDING_JOBS_PROD_CANARY_ACK=YES_ENABLE_KB_EMBEDDING_JOBS_PROD_CANARY
```

Test by editing one non-critical KB document for that tenant.

Expected:

- KB save succeeds regardless of embedding outcome.
- `KB_INGEST` job embeds only that document's pending/failed chunks.
- No raw KB content or secrets are logged.

Rollback:

```env
KB_EMBEDDING_JOBS_ENABLED=false
KB_EMBEDDING_JOB_TENANT_IDS=
KB_EMBEDDING_JOBS_PROD_CANARY_ACK=
```

## Step 5: Vector Context Canary

Set only for the canary tenant:

```env
KB_VECTOR_CONTEXT_ENABLED=true
KB_VECTOR_CONTEXT_TENANT_IDS=<one-canary-tenant-id>
KB_VECTOR_CONTEXT_MIN_SCORE=0.3
KB_VECTOR_CONTEXT_PROD_CANARY_ACK=YES_ENABLE_KB_VECTOR_CONTEXT_PROD_CANARY
```

Watch:

- `kb_vector_context`
- selected chunk IDs
- fallback reasons
- reply latency
- no-reply outcomes
- human-visible reply quality

NO-GO:

- unrelated queries enter vector context
- wrong tenant/document appears
- reply latency materially worsens
- no-reply or handoff behavior changes unexpectedly
- customer-visible answer quality regresses

Immediate rollback:

```env
KB_VECTOR_CONTEXT_ENABLED=false
KB_VECTOR_CONTEXT_TENANT_IDS=
KB_VECTOR_CONTEXT_PROD_CANARY_ACK=
```

## Expansion Rule

Do not expand beyond one tenant until:

- at least one low-traffic observation window passes
- no NO-GO condition occurs
- fallback rate and cost are acceptable
- owner explicitly approves the next tenant
