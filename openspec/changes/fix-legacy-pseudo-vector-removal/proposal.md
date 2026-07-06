# Proposal: Remove legacy pseudo-vector retrieval from live KB paths

**Status:** Implemented (emergency safety fix)  
**Branch:** `fix/kb-rag-production-safety`  
**Base:** origin/main at f772f27

## Problem

PR #46 added real pgvector schema, RPC helpers, vector context runner, embedding
jobs, shadow lane, and production canary guards - but it did **not** remove the
legacy `metadata.embedding` pseudo-vector code from `KbService.retrieve()` and
`KbService.searchKnowledge()`.

Production tenant AISBP (`34c62859-95b1-49a8-911c-cc44ced05452`) has **no**
real pgvector embeddings, but 61 chunks carry a legacy 64-dim
`metadata.embedding` array.  Because `retrieve()` and `searchKnowledge()` check
`hasPseudoCompatibleEmbedding()` first, they fall into the pseudo-vector branch
(`pseudoEmbedFromText` + `cosineSimilarity`) whenever any chunk in the corpus
has a 64-dim embedding - **even in production with zero vector flags set**.
Keyword scoring is then bypassed for those chunks.

This means production KB retrieval is effectively operating in pseudo-vector
mode for AISBP and any other tenant with legacy `metadata.embedding` data.

## Fix

The pseudo-vector branch is removed from both `retrieve()` and
`searchKnowledge()`.  Keyword scoring is now the **only** mode reachable from
these methods.  Legacy `metadata.embedding` arrays are counted and logged
(mode=keyword legacyMetadataEmbeddingsIgnored=N) for observability only.

## What stays unchanged

| Component | Status |
|---|---|
| `kb-vector-score.ts` helpers | Untouched (used by `kb-vector-score.spec.ts` only, marked test/legacy) |
| `src/lib/kb-retrieval-score.ts` | Untouched (keyword scoring library) |
| `runKbVectorContext` | Untouched (separate, fail-closed, tenant-gated real RAG path) |
| `runKbVectorShadow` | Untouched (fire-and-forget shadow lane) |
| `kbEmbeddingJobsEnabledForTenant` | Untouched (queue guard) |
| `kbVectorContextEnabledForTenant` | Untouched (context guard) |
| `kb-embedding-backfill.ts` | Untouched |
| `kb-embedding-store.ts` | Untouched |
| `kb-vector-search-shadow.ts` | Untouched |
| Prompt content, sales copy, no-reply logic, debounce, provider gate, scanner, AI-off, handover, send-bubble, GHL dedupe | Untouched |

## Tests added

- `retrieve` returns `retrievalMode='keyword'` when chunks have 64-dim `metadata.embedding`
- `retrieve` keyword-scores content by relevance even when embeddings exist
- `retrieve` preserves keyword with all embedding flags unset
- Non-canary tenant unaffected (same keyword retrieval)
- `searchKnowledge` returns `retrievalMode='keyword'` when chunks have embeddings
- `searchKnowledge` ranks by keyword when embeddings exist

## Rollback SQL (approval required - NOT run by this branch)

```sql
-- AISBP tenant (34c62859-95b1-49a8-911c-cc44ced05452):
-- Before: 61 chunks with metadata.embedding
-- After:  0 chunks with legacy metadata.embedding

UPDATE knowledge_chunks
SET metadata = metadata - 'embedding',
    embedding_status = 'pending'
WHERE id IN (
  SELECT kc.id
  FROM knowledge_chunks kc
  JOIN knowledge_documents kd ON kd.id = kc.document_id
  WHERE kd.tenant_id = '34c62859-95b1-49a8-911c-cc44ced05452'
);

-- Verify:
-- SELECT COUNT(*) FROM knowledge_chunks kc
-- JOIN knowledge_documents kd ON kd.id = kc.document_id
-- WHERE kd.tenant_id = '34c62859-95b1-49a8-911c-cc44ced05452'
--   AND kc.metadata ? 'embedding';
-- Expected: 0
```

Owner approval is required before executing this SQL.
