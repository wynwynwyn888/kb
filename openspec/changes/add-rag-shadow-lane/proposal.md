## Why

We want evidence that embedding-based retrieval improves KB recall on real traffic before we ever let it influence customer replies. KB is currently stable on keyword retrieval, so we need a shadow/test lane that measures vector and hybrid retrieval against the live keyword path with **zero risk** to reply content, reply latency, or reply errors. This de-risks the full RAG change (`add-rag-vector-retrieval`) by validating quality, tenant/allowlist safety, latency, and cost in isolation first.

## What Changes

- Add a **shadow retrieval lane** that runs vector + hybrid retrieval **off the reply critical path**, on a dedicated queue, and **logs a comparison** against the keyword result the reply actually used.
- Shadow work is **fire-and-forget, log-only**, and can never inject chunks into a reply, delay a reply, or surface an error to the reply path.
- Add additive schema for embeddings: nullable `embedding` (pgvector) + lifecycle columns on `knowledge_chunks`. No existing column changes. **No production migration or backfill until explicitly approved.**
- Add `service_role`-only Postgres RPCs for vector operations (store, mark-failed, match, capability check). Vectors cross the PostgREST boundary as text and are cast inside SQL.
- Add an embedding client (`text-embedding-3-small`), an agency OpenAI key/endpoint resolver, and a real embedding processor.
- Add a **tenant-limited, idempotent** backfill script, run in staging/local first.
- Add flags: `KB_VECTOR_SHADOW_ENABLED` (default false) and `KB_VECTOR_SHADOW_TENANT_IDS` (fail-closed if empty/unset). `KB_VECTOR_RETRIEVAL_ENABLED` remains false and is **not used** by shadow mode.
- Shadow retrieval **ignores the legacy 64-dim `metadata.embedding` pseudo-vector path** entirely.
- Live `KbService.retrieve` / `searchKnowledge` behavior — **including the existing legacy pseudo-vector branch — is left unchanged** during the shadow phase.

Out of scope (deferred to `add-rag-vector-retrieval`): using vector results in replies, flipping `KB_VECTOR_RETRIEVAL_ENABLED`, removing the legacy pseudo-vector branch, and any change to generated reply behavior.

## Capabilities

### New Capabilities
- `rag-shadow-lane`: A log-only shadow retrieval lane (embeddings, `service_role`-only vector RPCs, dedicated shadow queue/processor, keyword-vs-vector/hybrid comparison logging, additive schema, tenant-limited idempotent backfill, flags, kill switch, staging-first rollout, canary and rollback procedures) that provably cannot affect production replies.

### Modified Capabilities
<!-- None. This change deliberately does not alter any existing spec-level reply/retrieval behavior. -->

## Impact

- **Schema (additive only):** `knowledge_chunks` gains nullable `embedding` + `embedding_model`, `embedding_input_hash`, `embedding_status`, `embedding_updated_at`, `embedding_error`. Staging/local first; prod migration is a separate approved step.
- **New Postgres RPCs:** `check_pgvector_available`, `set_knowledge_chunk_embedding`, `mark_knowledge_chunk_embedding_failed`, `match_knowledge_chunks` — all `service_role`-only.
- **Reply path:** one guarded, non-awaited enqueue in `orchestration.service.ts` after the existing keyword retrieval; no behavioral change when flags are off.
- **New modules/libs:** embedding client, OpenAI key/endpoint resolver, pgvector text serializer, hybrid RRF + comparison helper, shadow queue processor, backfill script.
- **Queues:** new `KB_VECTOR_SHADOW` queue + processor; `queue.constants.ts` and `queues.module.ts` updated.
- **Cost:** OpenAI embedding spend for backfill + per-shadow-request query embeddings, bounded to allowlisted tenants.
- **Relationship:** complements and precedes `add-rag-vector-retrieval`; that change owns the eventual reply-path enablement.
