# Tasks: Add RAG Shadow Lane

## 1. Staging/Local Database Foundation (additive, no prod)

- [x] 1.1 Add version-controlled Prisma raw-SQL migration: enable `vector` idempotently.
- [x] 1.2 Add nullable `embedding vector(1536)` and lifecycle columns (`embedding_model`, `embedding_input_hash`, `embedding_status`, `embedding_updated_at`, `embedding_error`) to `knowledge_chunks`; no existing column changes.
- [x] 1.3 Add CHECK constraint for `embedding_status` in (`pending`,`embedded`,`failed`,`skipped`).
- [x] 1.4 Add partial cosine vector index for non-null embeddings; prefer HNSW, else IVFFlat with ANALYZE/lists/probes guidance.
- [x] 1.5 Update Prisma `KnowledgeChunk` with `Unsupported("vector(1536)")?` and lifecycle fields.
- [x] 1.6 Add RPC `check_pgvector_available`.
- [x] 1.7 Add RPC `set_knowledge_chunk_embedding` (tenant-scoped `p_tenant_id`, text vector param, SQL cast, stale input-hash guard via stored-column compare, stamp captured hash on success).
- [x] 1.8 Add RPC `mark_knowledge_chunk_embedding_failed` (tenant-scoped `p_tenant_id`, stale input-hash guard, stamp/preserve captured hash so a stale failing job cannot clobber a newer embedding).
- [x] 1.9 Add RPC `match_knowledge_chunks` (text vector param, SQL cast, tenant + READY + non-null embedding + parenthesized allowlist).
- [x] 1.10 Revoke execute from `anon`/`authenticated`; grant only to `service_role` for all RPCs (incl. tenant-scoped write signatures).
- [x] 1.11 Add follow-up migration `20260708000000_kb_shadow_embeddings_tenant_scoped_rpc` replacing the chunk-id-only write RPCs with tenant-scoped signatures (Codex blocker: `service_role` bypasses RLS). Apply/verify on staging/local only.

## 2. Embedding Pipeline (no reply-path impact)

- [x] 2.1 Create OpenAI embedding client (`text-embedding-3-small`, 1536 dims, 5s timeout).
- [x] 2.2 Add 8000-char truncation with `...` suffix.
- [x] 2.3 Add SHA-256 `embedding_input_hash` helper over the exact truncated/normalized input; reuse in worker and write paths.
- [x] 2.4 Add agency OpenAI key resolver (tenant→agency→`agency_model_providers` OPENAI), reusing `isUsableOpenAiFallbackKey`; honor `endpoint`.
- [x] 2.5 Add pgvector text serializer (`number[]` → `'[...]'`).
- [x] 2.6 Implement a real embedding processor (dedicated processor or a real KB embedding job path; do not leave it acknowledgement-only).
- [x] 2.7 Batch embedding inputs per OpenAI request with bounded concurrency.
- [x] 2.8 Add transient retry/backoff for 429/5xx/network; treat missing docs/chunks as benign no-ops.
- [x] 2.9 Store via tenant-scoped `set_knowledge_chunk_embedding` (pass `p_tenant_id`); mark permanent failures via tenant-scoped `mark_knowledge_chunk_embedding_failed`.
- [x] 2.10 Add safe structured logs for embedding jobs (no raw content/secrets).

## 3. Staging Backfill (tenant-limited, idempotent)

- [x] 3.1 Add `scripts/backfill-kb-embeddings.ts` requiring `--tenant` (allow `--all-tenants` only in non-prod).
- [x] 3.2 Skip already-embedded chunks; process `pending`/`failed`/`skipped` when requested.
- [x] 3.3 Rate-limit calls, continue on single-chunk failure, log approximate tokens.
- [x] 3.4 Add `KB_EMBEDDING_BACKFILL_ALLOW` guard so it refuses to run against prod without acknowledgement.
- [ ] 3.5 Print embedded/skipped/failed summary; run for the staging test tenant.

## 4. Shadow Queue and Retrieval (log-only)

- [x] 4.1 Add `KB_VECTOR_SHADOW` queue name + config in `queue.constants.ts`.
- [x] 4.2 Register the shadow queue and processor in `queues.module.ts` (producer registered in `orchestration.module.ts`).
- [x] 4.3 Implement `vectorSearchShadow()` wrapper around `match_knowledge_chunks` (empty allowlist short-circuits without RPC; ignores legacy `metadata.embedding`).
- [x] 4.4 Implement RRF (k=60) + keyword-vs-vector comparison helper (`kb-hybrid-merge.ts`).
- [x] 4.5 Implement the shadow processor (`kb-vector-shadow.processor.ts`): resolve key, embed query (with LRU cache max 100, no error caching), run vector + hybrid, compute comparison, log only.
- [x] 4.6 Guarantee the processor returns void, mutates nothing, and swallows all errors with a structured fallback reason.

> Reconciliation (Codex blocker #2): the earlier inline fire-and-forget runner
> invoked directly from `orchestration.service.ts` has been REPLACED by a
> dedicated BullMQ `KB_VECTOR_SHADOW` queue + processor. All OpenAI/RPC work now
> happens in the worker, never inline on the reply request. `runKbVectorShadow`
> is retained as the log-only engine invoked by the processor and now performs
> LRU query-embedding caching (max 100) and hybrid/RRF comparison.

## 5. Reply-Path Enqueue (single guarded touch)

- [x] 5.1 Add flags `KB_VECTOR_SHADOW_ENABLED` (default false) and `KB_VECTOR_SHADOW_TENANT_IDS` (fail-closed if empty/unset); do not read/write `KB_VECTOR_RETRIEVAL_ENABLED`.
- [x] 5.2 In `orchestration.service.ts`, after the existing keyword `retrieve()` result, if the flag is on and the tenant is allowlisted, enqueue a `KB_VECTOR_SHADOW` job via `void queue.add(...).catch(() => undefined)`; never await, never inline.
- [x] 5.3 Include tenant ID, conversation ID, the effective KB retrieval query (for the query embedding), intent hint, `documentIdAllowlist`, and keyword chunk IDs/scores in the payload; exclude the unrelated raw conversation transcript and secrets; logs use safe previews only.
- [x] 5.4 Verify no other reply-path code changes; keyword-only live retrieval (per PR #47) untouched.

## 6. Observability

- [x] 6.1 Emit shadow comparison log fields (keyword vs vector/hybrid candidates, scores, RRF ranks, overlap, latency breakdown, fallback reason, "no reply impact").
- [x] 6.2 Use `safeTextPreviewForLog` for query-derived text; never log raw chunk content/secrets.
- [x] 6.3 Do not add a new metrics backend dependency.

## 7. Tests (before enabling any flag)

- [x] 7.1 Flag off → zero shadow enqueues and identical `retrieveKbContext` result.
- [x] 7.2 Shadow enqueue failure cannot propagate to the reply path.
- [x] 7.3 Shadow candidates are never injected into reply context.
- [x] 7.4 Tenant allowlist fails closed when empty/unset.
- [ ] 7.5 `match_knowledge_chunks` tenant + READY + allowlist filtering; cross-tenant probe returns nothing (staging DB integration).
- [x] 7.6 Empty allowlist short-circuits without calling RPC.
- [ ] 7.7 Allowlist `OR` cannot bypass tenant/status filters (staging DB integration; enforced by parenthesized SQL).
- [ ] 7.8 Vector RPCs not executable by `anon`/`authenticated` (staging DB integration; enforced by migration grants).
- [x] 7.9 pgvector text param casts correctly inside RPC.
- [x] 7.10 Embedding input truncation; timeout/rate-limit handling.
- [x] 7.11 Key resolver returns safely on missing/unusable key.
- [x] 7.12 Stale success no-op and stale failure no-op (no clobber of newer embedding).
- [x] 7.13 Backfill idempotency and tenant scoping.
- [x] 7.14 RRF merge for vector-only, keyword-only, hybrid, and duplicate chunks.
- [x] 7.15 Run existing backend retrieval/orchestration tests to confirm no regression.

## 8. Staging Validation and Canary Gates (no prod DB until approved)

- [x] 8.0 Add a staging/local-only RAG context evaluation harness (`scripts/evaluate-kb-rag-context.ts` + pure helpers in `kb-rag-eval.ts`): env guard refuses prod, forces the vector-context flags for one tenant, compares `runKbVectorContext` vs keyword `KbService.retrieve`, supports a kill-switch check mode, and logs ids/scores/previews only.
- [x] 8.0a Add staging-only automatic embedding maintenance for KB writes: `KB_INGEST` now embeds pending/failed chunks for one document when `KB_EMBEDDING_JOBS_ENABLED=true` and the tenant is allowlisted.
- [x] 8.0b Add production-canary code guards for vector context and embedding jobs: production-like envs require the normal flag, tenant allowlist, and an exact canary acknowledgement env var before they can run.
- [ ] 8.1 Complete the staging/local validation checklist (migration idempotency, index used, backfill no-op rerun, RPC isolation, safe logs, latency parity, kill switch, cost).
- [ ] 8.2 Obtain explicit approval before any production additive migration.
- [ ] 8.3 Apply prod additive migration in a low-traffic window; confirm existing KB reads/writes unaffected and `KB_VECTOR_RETRIEVAL_ENABLED=false`.
- [ ] 8.4 Backfill exactly one canary tenant in prod; enable shadow only for that tenant.
- [ ] 8.5 Monitor reply latency/error rate/queue depth/OpenAI spend; confirm replies remain 100% keyword-sourced.
- [x] 8.5a Document production canary, NO-GO, and rollback steps in `production-canary-runbook.md`.
- [ ] 8.6 Document rollback (disable flags, drain queue, optional column/RPC drop) and confirm NO-GO conditions are wired into monitoring.
