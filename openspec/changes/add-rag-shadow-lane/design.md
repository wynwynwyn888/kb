## Context

KB retrieval for customer replies currently runs keyword-only in `KbService.retrieve` (`apps/backend/src/modules/kb/kb.service.ts`), called from `OrchestrationService.retrieveKbContext` (~`orchestration.service.ts:1257`). A legacy 64-dim `metadata.embedding` pseudo-vector branch also exists in `retrieve()` and `searchKnowledge()`; it is not real semantic retrieval and must be left untouched during this phase.

The full RAG change (`add-rag-vector-retrieval`) would let embeddings influence replies. Before taking that risk, we need real-traffic evidence and safety proof. This design specifies a **shadow lane**: it computes vector + hybrid retrieval and logs how it compares to the keyword result the reply actually used, without touching the reply.

Key existing facts this design relies on:
- KB data access uses Supabase JS/PostgREST; no `.rpc()` is used anywhere today, so the RPC boundary is new.
- `agency_model_providers` stores a plaintext OpenAI `api_key` and optional `endpoint`; `isUsableOpenAiFallbackKey` (`lib/ai-live-model-resolve`) and the tenant→agency lookup pattern in `generation.service.ts` are reusable.
- `KbIngestProcessor` is an acknowledgement-only stub.
- BullMQ queues are registered in `queues.module.ts` / `queue.constants.ts`.

## Goals / Non-Goals

**Goals:**
- Measure vector/hybrid vs keyword retrieval on real (allowlisted) traffic with structured, safe logs.
- Guarantee zero impact on reply content, reply latency, and reply errors.
- Prove tenant isolation, READY filtering, and allowlist safety of the vector RPC.
- Keep all DB changes additive and validated in staging/local before any production step.
- Provide an instant kill switch and a clean rollback.

**Non-Goals:**
- Using vector/hybrid results in generated replies (owned by `add-rag-vector-retrieval`).
- Flipping or reading `KB_VECTOR_RETRIEVAL_ENABLED`.
- Removing or modifying the legacy pseudo-vector branch in live `retrieve()`/`searchKnowledge()`.
- Production migration/backfill in this change without explicit, separate approval.
- Full-text/keyword scaling work.

## Decisions

### Decision 1: Isolate shadow work on a dedicated queue (not inline)
Shadow retrieval runs in a new `KB_VECTOR_SHADOW` BullMQ queue/processor. The reply path only performs a single **non-awaited, try/catch-wrapped enqueue** after the keyword result is computed. When the flag/allowlist check is off, only that lightweight check runs — no enqueue, no shadow worker, no RAG retrieval.
- **Why:** an inline "await with timeout" still shares the reply's event loop, CPU budget, and failure surface. A separate worker makes the worst case a dropped shadow log, never a delayed/broken reply.
- **Alternative considered:** inline fire-and-forget promise — rejected because unhandled rejection and CPU contention risk remain closer to the reply path.
- **Payload note:** the shadow job may include the effective KB retrieval query needed to compute a query embedding, but it must not include unrelated raw conversation transcript or secrets; logs use safe previews only.

### Decision 2: Fail-closed flags, independent of production RAG flag
`KB_VECTOR_SHADOW_ENABLED` (default false) gates the enqueue. `KB_VECTOR_SHADOW_TENANT_IDS` is a CSV allowlist; empty/unset ⇒ no tenant runs shadow. `KB_VECTOR_RETRIEVAL_ENABLED` is neither read nor written by shadow code.
- **Why:** two independent flags prevent shadow work from being mistaken for a step toward reply enablement; fail-closed avoids accidental fleet-wide activation.

### Decision 3: Additive schema + `service_role`-only RPCs, text vector params
Add nullable `embedding vector(1536)` and lifecycle columns; four RPCs with `REVOKE EXECUTE FROM anon, authenticated` + `GRANT EXECUTE TO service_role`. Vectors cross the PostgREST boundary as text (`'[...]'`) and are cast to `vector` inside SQL.
- **Why:** additive/nullable changes cannot break existing reads/writes even if RAG code never runs. RPCs that trust `p_tenant_id` must not be callable by untrusted roles. PostgREST cannot reliably coerce a JS array to `vector`.
- **Alternative considered:** Prisma raw queries for vector ops — rejected because runtime KB access is Supabase JS and `loadTenantChunks` already avoids complex PostgREST joins; a typed RPC is safer and testable.

### Decision 4: Stale-embedding guard on both success and failure RPCs
The write path stamps `embedding_input_hash` atomically with content changes. `set_knowledge_chunk_embedding` **and** `mark_knowledge_chunk_embedding_failed` compare the job's captured hash to the row's stored `embedding_input_hash` and no-op on mismatch (no SQL-side hashing).
- **Why:** prevents an out-of-order job from writing a stale vector, and prevents a stale *failing* job from nulling a newer valid embedding.

### Decision 5: Shadow ignores the legacy pseudo-vector path
Shadow retrieval reads only the real `knowledge_chunks.embedding` column via `match_knowledge_chunks`. It never reads `metadata.embedding` and never calls `pseudoEmbedFromText`/`readEmbeddingVector`.
- **Why:** the 64-dim metadata path is not semantic retrieval; mixing it in would corrupt the comparison and defeat the experiment.

### Decision 6: Reuse existing key resolution + safe logging helpers
Resolve tenant→agency→`agency_model_providers` OPENAI row, reuse `isUsableOpenAiFallbackKey`, honor `endpoint`. Use `safeTextPreviewForLog` for any query-derived text.
- **Why:** consistency with generation; no new secret handling; no raw content/keys in logs.

### Decision 7: Staging/local first, tenant-limited idempotent backfill
All migrations, RPCs, grants, and backfill land in staging/local first. Backfill requires `--tenant` (or explicit `--all-tenants` in non-prod), skips already-embedded chunks, processes `pending`, rate-limits, and continues on single-chunk failure.
- **Why:** contain cost and blast radius; make reruns safe.

## Risks / Trade-offs

- **Shadow adds CPU/OpenAI cost** → tenant allowlist + dedicated queue with bounded concurrency; cost logged; kill switch.
- **Enqueue accidentally awaited or throwing on reply path** → spec mandates non-awaited `void enqueue().catch(()=>{})`; test asserts flag-off yields zero enqueues and identical return value, and that enqueue failure cannot propagate.
- **Cross-tenant/allowlist leakage in logs** → RPC enforces tenant + parenthesized allowlist; empty allowlist short-circuits without calling RPC; tests probe cross-tenant.
- **PostgREST vector coercion failure** → text param + SQL cast; dedicated round-trip test.
- **Stale/failed embedding clobber** → hash guard on both RPCs; tests for both.
- **Accidental production migration/backfill** → additive-only, staging-first, backfill env guard (`KB_EMBEDDING_BACKFILL_ALLOW`), prod steps gated on explicit approval.
- **IVFFlat poor recall on small/empty tables** → prefer HNSW when available; if IVFFlat, ANALYZE after backfill and tune lists/probes.

## Migration Plan

Phased rollout:
1. **Staging/local schema + RPCs** (additive columns, four RPCs, `service_role` grants) via version-controlled Prisma raw-SQL migration.
2. **Staging embedding pipeline** (client, resolver, processor) + **staging backfill** for a test tenant.
3. **Staging shadow lane** (queue + processor + guarded enqueue) enabled for the test tenant; validate logs, latency parity, cost, isolation.
4. **Prod additive migration** — separate, explicitly approved; nullable columns ⇒ behavior identical with flags off.
5. **Prod backfill for one canary tenant** only.
6. **Prod shadow canary** — `KB_VECTOR_SHADOW_ENABLED=true` + `KB_VECTOR_SHADOW_TENANT_IDS=<canary>`; `KB_VECTOR_RETRIEVAL_ENABLED` stays false.
7. **Decision gate** — evaluate shadow evidence before any reply-enablement change.

Kill switch: set `KB_VECTOR_SHADOW_ENABLED=false` (or clear the tenant list) → enqueue stops immediately; in-flight shadow jobs are log-only and harmless.

Rollback:
- **Code:** disable flags (instant); revert the shadow enqueue/processor deploy if needed.
- **Queue:** drain/obliterate `KB_VECTOR_SHADOW`.
- **Schema:** columns are nullable/additive and unused by live reads; they can be left in place safely or dropped in a follow-up migration once no code references them. RPCs can be `DROP FUNCTION`'d. No data migration to reverse.

## Open Questions

- Which concrete tenant is the canary (`34c62859` test tenant is a candidate)?
- Shadow processor concurrency and per-tenant rate caps for cost control.
- Sampling rate: log every allowlisted request vs a percentage, to bound cost on chatty tenants.
- HNSW availability on the target Supabase pgvector version (determines index type).
