# Codex Review Prompt — RAG Shadow Lane (Phase 1–5)

Reusable prompt to send to Codex to review/challenge OpenSpec `add-rag-shadow-lane`
and produce the final OpenCode implementation prompt for **Phase 1–5 only**.

Do NOT start OpenCode implementation until Codex returns:
1. BLOCKERS / SHOULD-FIX / NITS
2. the improved final OpenCode prompt
3. the explicit Phase 1–5 safety gates
4. confirmation that Phase 6+ / live canary / production backfill are excluded

---

```text
ROLE
You are a senior staff engineer + adversarial spec reviewer. Your job is TWO things,
in order:
  (A) Review and CHALLENGE the OpenSpec change `add-rag-shadow-lane` for the KB RAG
      shadow lane, hunting for anything that could break production replies or leak
      across tenants.
  (B) Output a single, final, copy-paste OpenCode implementation prompt that covers
      PHASE 1–5 ONLY (staging/local build of the shadow lane), with hard safety rails.

Do not write application code yourself. Produce the review findings, then the
OpenCode prompt.

════════════════════════════════════════════════════════════════════════
FROZEN PRODUCTION BASELINE — DO NOT REGRESS
════════════════════════════════════════════════════════════════════════
- Repo: KB backend (pnpm monorepo, `@aisbp/backend`, NestJS + BullMQ + Prisma +
  Supabase JS/PostgREST).
- Safe baseline: PR #47 (merge 76bd511) is merged & deployed. Branch
  `fix/kb-rag-production-safety`, HEAD 5180d09. Build from THIS baseline.
- Live KB reply retrieval is KEYWORD-ONLY. `KbService.retrieve()` and
  `KbService.searchKnowledge()` return retrievalMode='keyword'.
- The legacy 64-dim `metadata.embedding` pseudo-vector branch has been REMOVED from
  live retrieve()/searchKnowledge(); legacy arrays are counted/logged for
  observability only (mode=keyword legacyMetadataEmbeddingsIgnored=N). Keep it that way.
- AISBP tenant `34c62859-95b1-49a8-911c-cc44ced05452` still has 61 chunks carrying
  legacy metadata.embedding. That data is PRESERVED. Rollback SQL exists but is
  approval-gated and MUST NOT run.
- ALL RAG/vector/embedding flags are OFF and stay off in this phase:
  KB_VECTOR_RETRIEVAL_ENABLED, KB_VECTOR_SHADOW_ENABLED, KB_VECTOR_CONTEXT_ENABLED,
  KB_EMBEDDING_JOBS_ENABLED. No prod-canary ACK vars set.
- NO live RAG canary has been started. NO production DB migration/backfill has run.

════════════════════════════════════════════════════════════════════════
HARD GUARDRAILS FOR THE OUTPUT PROMPT (non-negotiable)
════════════════════════════════════════════════════════════════════════
1. STAGING/LOCAL ONLY. No production migration, no production backfill, no flag flips
   in prod. Additive, nullable schema only; existing columns untouched.
2. DO NOT live-test RAG. DO NOT enable vector context. Shadow lane is LOG-ONLY and
   fire-and-forget; it can NEVER inject/reorder/substitute chunks, add latency, or
   surface an error to the reply path.
3. Keyword retrieval remains the ONLY source of reply KB context. The single reply-path
   touch is a non-awaited, try/catch-wrapped enqueue AFTER the keyword result:
   `void enqueue(...).catch(()=>{})`. Flag-off ⇒ zero enqueues + byte-identical
   `retrieveKbContext` result.
4. Fail-closed flags, independent of the prod RAG flag: `KB_VECTOR_SHADOW_ENABLED`
   (default false) + `KB_VECTOR_SHADOW_TENANT_IDS` (empty/unset ⇒ nobody runs). Shadow
   code MUST NOT read or write `KB_VECTOR_RETRIEVAL_ENABLED`.
5. Do NOT touch the legacy pseudo-vector removal, prompt content, no-reply/debounce,
   provider gate, scanner, AI-off/handover, send-bubble, or GHL dedupe logic.
6. Vector ops go through `service_role`-only Postgres RPCs; vectors cross PostgREST as
   TEXT `'[...]'` and are cast to vector inside SQL. Shadow ignores metadata.embedding
   entirely (real `knowledge_chunks.embedding` column only).
7. No new metrics backend dependency. Use `safeTextPreviewForLog`; never log raw chunk
   content, full customer text, secrets, or raw embedding vectors.

════════════════════════════════════════════════════════════════════════
SCOPE = PHASE 1–5 ONLY (from openspec/changes/add-rag-shadow-lane/tasks.md)
════════════════════════════════════════════════════════════════════════
Phase 1 — Staging/Local DB foundation (additive): enable `vector` idempotently;
  nullable `embedding vector(1536)` + lifecycle cols (embedding_model,
  embedding_input_hash, embedding_status, embedding_updated_at, embedding_error);
  CHECK on embedding_status in (pending,embedded,failed,skipped); partial cosine index
  (HNSW preferred, else IVFFlat + ANALYZE/lists/probes); Prisma model update; RPCs
  check_pgvector_available, set_knowledge_chunk_embedding (text param, SQL cast, stale
  input-hash guard), mark_knowledge_chunk_embedding_failed (stale guard),
  match_knowledge_chunks (tenant + READY + non-null + parenthesized allowlist); REVOKE
  from anon/authenticated, GRANT service_role only; apply/verify on staging/local +
  idempotent rerun.
Phase 2 — Embedding pipeline (no reply-path impact): OpenAI client (text-embedding-3-small,
  1536 dims, 5s timeout); 8000-char truncation; SHA-256 input-hash helper; agency OpenAI
  key/endpoint resolver (tenant→agency→agency_model_providers OPENAI, reuse
  isUsableOpenAiFallbackKey); pgvector text serializer; REAL embedding processor (not
  ack-only); batched inputs + bounded concurrency; retry/backoff on 429/5xx/network;
  benign no-op on missing docs/chunks; store via RPCs; safe structured logs.
Phase 3 — Staging backfill (tenant-limited, idempotent): scripts/backfill-kb-embeddings.ts
  requires --tenant (--all-tenants only non-prod); skip already-embedded; rate-limit;
  continue on single-chunk failure; KB_EMBEDDING_BACKFILL_ALLOW guard; print
  embedded/skipped/failed summary; run for staging test tenant only.
Phase 4 — Shadow queue + retrieval (log-only): KB_VECTOR_SHADOW queue + processor in
  queue.constants.ts / queues.module.ts; vectorSearchShadow() over match_knowledge_chunks
  (empty allowlist short-circuits WITHOUT RPC; ignores metadata.embedding); RRF (k=60) +
  keyword-vs-vector comparison helper (kb-hybrid-merge.ts); processor resolves key, embeds
  query (LRU max 100, no error caching), runs vector+hybrid, computes comparison, LOGS
  ONLY; processor returns void, mutates nothing, swallows all errors with structured
  fallback reason.
  NOTE current state: a safe inline runner path exists instead of the BullMQ queue; some
  files (kb-vector-shadow.runner.ts, kb-vector-search-shadow.ts, kb-embedding-store.ts,
  kb-embedding-backfill.ts) are NOT present on the fix/kb-rag-production-safety baseline —
  they live on feat/rag-shadow-lane-phase1. Codex MUST first reconcile: decide whether to
  (a) cherry-pick/rebuild the queue path or (b) keep the inline fire-and-forget runner and
  add LRU + hybrid/RRF inside it. State the choice explicitly and keep it log-only either way.
Phase 5 — Reply-path enqueue (single guarded touch): add the two shadow flags; in
  orchestration.service.ts, AFTER the keyword retrieve() result, if flag on AND tenant
  allowlisted, start shadow via non-awaited `void run/enqueue(...).catch(()=>{})`; payload =
  tenant id, conversation id, effective KB retrieval query, intent hint, documentIdAllowlist,
  keyword chunk ids/scores; EXCLUDE raw transcript + secrets; verify no other reply-path
  changes and legacy branch untouched.

OUT OF SCOPE (do NOT include): Phase 6 observability polish, Phase 7 test-gating beyond
what's needed to prove Phase 1–5 safety, Phase 8 prod canary/migration/backfill, enabling
vector context, flipping KB_VECTOR_RETRIEVAL_ENABLED, and the AISBP rollback SQL.

════════════════════════════════════════════════════════════════════════
PART A — REVIEW & CHALLENGE (do this first)
════════════════════════════════════════════════════════════════════════
Read: openspec/changes/add-rag-shadow-lane/{proposal,design,tasks}.md, its
specs/rag-shadow-lane/spec.md, production-canary-runbook.md, staging-validation-2026-07-06.md,
and openspec/changes/fix-legacy-pseudo-vector-removal/*. Then answer:
  1. Any path where shadow work can touch reply content/latency/errors? Prove it can't.
  2. Any tenant-isolation or allowlist-bypass gap in match_knowledge_chunks (OR precedence,
     status filter, empty-allowlist short-circuit)?
  3. Stale-embedding clobber correctness on BOTH success and failure RPCs.
  4. PostgREST text→vector cast correctness and role grants (anon/authenticated blocked).
  5. Inline-runner vs BullMQ-queue decision: which is safer for zero reply impact, and what
     are the trade-offs?
  6. Cost blast radius (backfill + per-request query embeddings) and how it's bounded.
  7. Any spec/tasks inconsistency, missing task, or task that secretly touches prod.
  8. Concrete correctness/safety tests required before ANY flag is enabled.
Output findings as: BLOCKERS, SHOULD-FIX, NITS, plus proposed spec/tasks edits.

════════════════════════════════════════════════════════════════════════
PART B — FINAL OPENCODE IMPLEMENTATION PROMPT (output last)
════════════════════════════════════════════════════════════════════════
Produce ONE self-contained prompt I can paste into OpenCode that:
  - States the frozen baseline + all hard guardrails above.
  - Implements Phase 1–5 ONLY, staging/local only, in dependency order.
  - Specifies exact files, flags, RPC names/signatures, and the single reply-path touch.
  - Ends each phase with a verification gate: `pnpm --filter @aisbp/backend exec tsc
    --noEmit`, targeted jest for the touched area, `run build`, `run lint`, plus the
    flag-off invariant test (zero enqueues + identical retrieveKbContext) and the
    empty-allowlist-no-RPC test.
  - Explicitly forbids: prod migration/backfill, enabling vector context, flipping the
    prod RAG flag, live RAG testing, and modifying the legacy-removal/reply logic.
  - Requires a short STOP/checkpoint after Phase 5 for human review before any Phase 6+.

REQUIRED RETURN FORMAT (Codex must return all four, in order):
  1. BLOCKERS / SHOULD-FIX / NITS (with proposed spec/tasks edits)
  2. The improved final OpenCode implementation prompt (fenced, copy-paste ready)
  3. The explicit Phase 1–5 safety gates
  4. Confirmation that Phase 6+, live canary, and production backfill are EXCLUDED
```
