# RAG Shadow Lane Specification

## ADDED Requirements

### Requirement: Zero Reply Impact

Shadow RAG SHALL NOT affect reply content, reply latency, or reply errors under any condition.

#### Scenario: Shadow flag off

- **WHEN** `KB_VECTOR_SHADOW_ENABLED` is absent or false
- **THEN** no shadow enqueue SHALL occur and no shadow worker or RAG retrieval SHALL run (only the flag/allowlist check itself may execute)
- **AND** `OrchestrationService.retrieveKbContext` SHALL return the same result as before this change
- **AND** no query embedding or vector RPC call SHALL be made

#### Scenario: Shadow enqueue is fire-and-forget

- **WHEN** shadow is enabled for a tenant and the reply path computes its keyword result
- **THEN** the reply path SHALL enqueue a shadow job without awaiting it
- **AND** the enqueue SHALL be wrapped so any error is swallowed and never propagates to the reply
- **AND** the reply's returned chunks and ordering SHALL be identical whether or not the enqueue succeeds

#### Scenario: Shadow never injects chunks

- **WHEN** shadow retrieval produces vector or hybrid candidates
- **THEN** those candidates SHALL only be logged
- **AND** they SHALL NOT be added to, reordered within, or substituted into the reply's KB context

### Requirement: Shadow Feature Flags

The system SHALL gate shadow work behind dedicated, fail-closed flags that are independent of the production RAG flag.

#### Scenario: Independent flags

- **WHEN** shadow mode is configured
- **THEN** `KB_VECTOR_SHADOW_ENABLED` SHALL default to false
- **AND** `KB_VECTOR_RETRIEVAL_ENABLED` SHALL remain false
- **AND** shadow code SHALL NOT read or write `KB_VECTOR_RETRIEVAL_ENABLED`

#### Scenario: Tenant allowlist fails closed

- **WHEN** `KB_VECTOR_SHADOW_TENANT_IDS` is empty, unset, or unparseable
- **THEN** no tenant SHALL run shadow retrieval
- **AND** shadow SHALL run only for tenant IDs explicitly listed

#### Scenario: Instant kill switch

- **WHEN** `KB_VECTOR_SHADOW_ENABLED` is set to false or the tenant list is cleared
- **THEN** new shadow enqueues SHALL stop immediately
- **AND** any in-flight shadow jobs SHALL remain log-only and harmless

### Requirement: Queue Isolation

Shadow retrieval SHALL run on a dedicated queue and worker, separate from the reply path and from `KB_INGEST`.

#### Scenario: Dedicated shadow queue

- **WHEN** a shadow job is enqueued
- **THEN** it SHALL use a dedicated `KB_VECTOR_SHADOW` queue
- **AND** it SHALL be processed by a dedicated shadow processor
- **AND** shadow processing SHALL NOT share the reply request lifecycle

#### Scenario: Shadow job payload

- **WHEN** the reply path enqueues a shadow job
- **THEN** the payload SHALL include tenant ID, conversation ID, the effective KB retrieval query needed to compute the query embedding, intent hint, the `documentIdAllowlist` used by the reply, and the keyword result chunk IDs and scores
- **AND** the payload SHALL NOT include the unrelated raw conversation transcript or secrets
- **AND** downstream logs SHALL only use safe previews of the query, never the raw stored payload query verbatim

### Requirement: Shadow Ignores Legacy Pseudo-Vector Embeddings

Shadow retrieval SHALL use only real pgvector embeddings and SHALL NOT reuse the legacy 64-dimensional `metadata.embedding` pseudo-vector path.

#### Scenario: Only real embeddings are used

- **WHEN** shadow retrieval runs
- **THEN** it SHALL query real vectors via `match_knowledge_chunks` using `knowledge_chunks.embedding`
- **AND** it SHALL NOT read `metadata.embedding`
- **AND** it SHALL NOT call the legacy pseudo-vector scoring helpers

#### Scenario: Live retrieval is untouched

- **WHEN** this change is implemented
- **THEN** the legacy pseudo-vector branch in live `retrieve()` and `searchKnowledge()` SHALL remain unchanged
- **AND** live keyword retrieval SHALL remain the sole source of customer replies

### Requirement: Additive Vector Storage and Lifecycle

The system SHALL add embedding storage additively without altering existing columns or behavior.

#### Scenario: Additive migration

- **WHEN** the migration is applied
- **THEN** it SHALL enable `vector` idempotently
- **AND** add nullable `embedding vector(1536)`
- **AND** add `embedding_model`, `embedding_input_hash`, `embedding_status`, `embedding_updated_at`, and `embedding_error`
- **AND** constrain `embedding_status` to `pending`, `embedded`, `failed`, or `skipped`
- **AND** create a partial cosine vector index for rows where `embedding IS NOT NULL`, preferring HNSW when available, otherwise IVFFlat with `ANALYZE` and tuned lists/probes
- **AND** NOT modify or drop any existing column

#### Scenario: Migration is version controlled and staging-first

- **WHEN** vector storage and RPCs are added
- **THEN** all extension, index, function, grant, and revoke SQL SHALL live in version-controlled Prisma raw-SQL migrations
- **AND** they SHALL be applied to staging/local first
- **AND** production migration SHALL NOT run without explicit approval

### Requirement: Service-Role-Only Vector RPCs

The system SHALL perform pgvector operations through Postgres RPCs executable only by `service_role`.

#### Scenario: RPC execution is restricted

- **WHEN** vector RPC functions are created or replaced
- **THEN** execution SHALL be revoked from `anon` and `authenticated`
- **AND** execution SHALL be granted only to `service_role`
- **AND** functions that trust `p_tenant_id` SHALL NOT be callable by untrusted roles

#### Scenario: Vector values cross the boundary as text

- **WHEN** the backend calls `set_knowledge_chunk_embedding` or `match_knowledge_chunks`
- **THEN** the backend SHALL pass vectors as pgvector text, not a JavaScript JSON array
- **AND** the RPC SHALL cast the text to `vector` inside SQL

#### Scenario: Vector search enforces tenant, status, and allowlist filters

- **WHEN** `match_knowledge_chunks` runs
- **THEN** it SHALL filter by tenant ID, READY document status, and non-null embedding
- **AND** the allowlist SQL SHALL be parenthesized as:

```sql
AND (
  p_document_id_allowlist IS NULL
  OR kd.id = ANY(p_document_id_allowlist)
)
```

- **AND** an `OR` clause SHALL NOT be able to bypass tenant/status filters

#### Scenario: Empty allowlist short-circuits

- **WHEN** `documentIdAllowlist` is an empty array
- **THEN** the shadow vector wrapper SHALL return zero vector results without calling the RPC
- **AND** it SHALL NOT map the empty array to a null allowlist

### Requirement: Stale Embedding Guard

The system SHALL prevent out-of-order embedding jobs from writing stale state.

#### Scenario: Stale success no-ops

- **WHEN** `set_knowledge_chunk_embedding` runs
- **THEN** it SHALL no-op if the chunk's stored `embedding_input_hash` differs from the job's captured input hash
- **AND** otherwise it SHALL set the vector, model, input hash, `embedded` status, timestamp, and clear the error
- **AND** the input hash SHALL be a stable SHA-256 of the exact embedding input after truncation/normalization, compared against the stored column without SQL-side rehashing

#### Scenario: Stale failure no-ops

- **WHEN** `mark_knowledge_chunk_embedding_failed` runs
- **THEN** it SHALL no-op if the chunk's stored `embedding_input_hash` differs from the job's captured input hash
- **AND** otherwise it SHALL set `failed` status, store a sanitized short error, and update the timestamp
- **AND** a stale failing job SHALL NOT clear a newer valid embedding

### Requirement: Embedding Generation

The system SHALL generate embeddings asynchronously using the agency OpenAI configuration.

#### Scenario: Embedding input is prepared

- **WHEN** chunk content is embedded
- **THEN** the backend SHALL use OpenAI `text-embedding-3-small` at 1536 dimensions
- **AND** truncate embedding input over 8000 characters with a `...` suffix
- **AND** use a 5 second timeout per API attempt

#### Scenario: OpenAI key and endpoint are resolved

- **WHEN** an embedding job runs for a tenant
- **THEN** it SHALL resolve tenant to agency and load the agency `OPENAI` row from `agency_model_providers`
- **AND** use the key only when it passes existing OpenAI usability checks
- **AND** honor the provider row's custom `endpoint` when present
- **AND** skip or fail embedding safely when no usable key exists, without breaking keyword retrieval

#### Scenario: Embedding processor performs real work

- **WHEN** an embedding job is processed
- **THEN** the processor SHALL verify the document belongs to the tenant and load target chunks
- **AND** generate embeddings in batched OpenAI requests with bounded concurrency
- **AND** store results via `set_knowledge_chunk_embedding` and mark permanent failures via `mark_knowledge_chunk_embedding_failed`
- **AND** retry transient 429/5xx/network failures with backoff
- **AND** treat already-deleted documents or chunks as benign no-ops

### Requirement: Tenant-Limited Idempotent Backfill

The system SHALL provide a backfill script that is tenant-limited, idempotent, and staging-first.

#### Scenario: Backfill is safe and scoped

- **WHEN** the backfill script is invoked
- **THEN** it SHALL require an explicit tenant scope (`--tenant`, or `--all-tenants` only outside production)
- **AND** skip chunks already `embedded` with a non-null embedding
- **AND** process `pending`, `failed`, or `skipped` chunks when requested
- **AND** rate-limit OpenAI calls and continue after single-chunk failures
- **AND** estimate/log approximate tokens for large batches
- **AND** print embedded/skipped/failed counts

#### Scenario: Backfill guarded against accidental production runs

- **WHEN** the backfill script targets a production database
- **THEN** it SHALL require an explicit environment acknowledgement (e.g. `KB_EMBEDDING_BACKFILL_ALLOW`)
- **AND** SHALL refuse to run without it

### Requirement: Shadow Comparison Logging

Shadow retrieval SHALL emit safe structured logs comparing keyword and vector/hybrid candidates.

#### Scenario: Shadow comparison is logged

- **WHEN** a shadow job completes
- **THEN** logs SHALL include tenant ID, conversation ID, document scope, keyword candidate chunk IDs and scores, vector/hybrid candidate chunk IDs and scores, RRF ranks, overlap between keyword and vector top results, latency breakdown (query embedding, vector search), and any fallback reason
- **AND** logs SHALL state that shadow had no reply impact
- **AND** logs SHALL NOT include full raw chunk content, the unrelated raw conversation transcript, or secrets
- **AND** query-derived text SHALL use existing safe preview helpers

#### Scenario: No new metrics backend

- **WHEN** shadow observability is implemented
- **THEN** it SHALL emit structured log fields
- **AND** SHALL NOT add a new metrics backend dependency

### Requirement: Shadow Fallback Behavior

Shadow retrieval SHALL degrade safely and log the reason, never affecting replies.

#### Scenario: Shadow cannot run

- **WHEN** pgvector is unavailable, no usable OpenAI key exists, query embedding fails or times out, the vector RPC fails, the allowlist is empty, or no embedded chunks exist
- **THEN** the shadow job SHALL log a structured fallback reason and stop
- **AND** the reply path SHALL be unaffected

### Requirement: Tests Before Enabling

The implementation SHALL include tests proving safety before any flag is enabled.

#### Scenario: Reply-path safety is proven

- **WHEN** shadow-related tests run
- **THEN** they SHALL verify that flag off produces zero enqueues and an identical reply result
- **AND** that shadow enqueue failure cannot propagate to the reply path
- **AND** that shadow candidates are never injected into reply context

#### Scenario: Tenant and allowlist safety is verified

- **WHEN** vector search is tested
- **THEN** tests SHALL verify tenant filtering, READY status filtering, empty-allowlist short-circuit, and selected-document allowlist behavior
- **AND** that the allowlist `OR` cannot bypass tenant/status filters
- **AND** that vector RPCs are not executable by `anon` or `authenticated`
- **AND** that pgvector text parameters cast correctly inside the RPC

#### Scenario: Embedding lifecycle safety is verified

- **WHEN** embedding tests run
- **THEN** they SHALL verify input truncation, timeout/failure handling, key-resolver missing/unusable key, stale success no-op, stale failure no-op, and idempotent tenant-scoped backfill

### Requirement: Rollout, Canary, NO-GO, and Rollback

The change SHALL follow a phased, reversible rollout with explicit gates.

#### Scenario: Phased rollout order

- **WHEN** the change is rolled out
- **THEN** the order SHALL be: staging schema+RPCs → staging embedding pipeline+backfill → staging shadow lane → approved production additive migration → production canary-tenant backfill → production shadow canary → decision gate
- **AND** `KB_VECTOR_RETRIEVAL_ENABLED` SHALL remain false throughout

#### Scenario: Staging/local validation checklist is satisfied

- **WHEN** staging validation completes
- **THEN** the migration SHALL apply cleanly and idempotently
- **AND** the vector index SHALL be used (verified via query plan)
- **AND** backfill SHALL embed the test tenant and be a no-op on rerun
- **AND** `match_knowledge_chunks` SHALL be tenant-scoped, READY-only, and allowlist-respecting, with a cross-tenant probe returning nothing
- **AND** shadow logs SHALL contain the comparison fields with no raw content or secrets
- **AND** reply latency and reply content SHALL be unchanged with shadow on versus off
- **AND** the kill switch and cost budget SHALL be verified

#### Scenario: Production canary checklist is satisfied

- **WHEN** the production canary runs
- **THEN** the staging checklist SHALL be green first
- **AND** the additive migration SHALL be applied with existing KB reads/writes unaffected
- **AND** backfill SHALL run for exactly one canary tenant
- **AND** shadow SHALL be enabled only for that tenant via `KB_VECTOR_SHADOW_TENANT_IDS`
- **AND** reply latency, error rate, queue depth, and OpenAI spend SHALL be monitored
- **AND** replies SHALL remain 100% keyword-sourced

#### Scenario: NO-GO conditions halt rollout

- **WHEN** any of the following occur: measurable reply latency increase or reply-content change from shadow, a shadow exception reaching the reply path, cross-tenant or cross-allowlist chunks in logs, raw content/messages/secrets in logs, migration locks/timeouts on a prod-sized clone, backfill not tenant-scopable or not idempotent, OpenAI cost materially over budget, kill switch failing to stop shadow work, or inability to guarantee `KB_VECTOR_RETRIEVAL_ENABLED` is false
- **THEN** rollout SHALL stop and SHALL NOT widen

#### Scenario: Rollback is clean

- **WHEN** rollback is required
- **THEN** disabling the flags SHALL immediately stop shadow work
- **AND** the shadow queue MAY be drained/obliterated
- **AND** additive nullable columns and RPCs MAY be left in place safely or dropped in a follow-up migration
- **AND** no data migration SHALL need reversing
