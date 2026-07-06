-- ============================================================================
-- RAG Shadow Lane: additive pgvector storage + service-role-only RPCs
-- ----------------------------------------------------------------------------
-- SAFETY / SCOPE:
--   * ADDITIVE ONLY. No existing column is modified or dropped.
--   * `knowledge_chunks.embedding` and lifecycle columns are nullable and are
--     NOT read by live keyword retrieval. Behavior is unchanged with all RAG
--     flags off.
--   * Vector I/O crosses the PostgREST boundary as TEXT and is cast to `vector`
--     inside SQL. RPCs are executable ONLY by `service_role`.
--   * Intended for STAGING/LOCAL first. Do NOT apply to production without
--     explicit approval.
--
-- ROLLBACK (manual, if ever needed):
--   DROP FUNCTION IF EXISTS match_knowledge_chunks(text, text, text[], int);
--   DROP FUNCTION IF EXISTS mark_knowledge_chunk_embedding_failed(text, text, text);
--   DROP FUNCTION IF EXISTS set_knowledge_chunk_embedding(text, text, text, text);
--   DROP FUNCTION IF EXISTS check_pgvector_available();
--   DROP INDEX IF EXISTS idx_knowledge_chunks_embedding_hnsw;
--   DROP INDEX IF EXISTS idx_knowledge_chunks_embedding_ivfflat;
--   ALTER TABLE knowledge_chunks
--     DROP COLUMN IF EXISTS embedding,
--     DROP COLUMN IF EXISTS embedding_model,
--     DROP COLUMN IF EXISTS embedding_input_hash,
--     DROP COLUMN IF EXISTS embedding_status,
--     DROP COLUMN IF EXISTS embedding_updated_at,
--     DROP COLUMN IF EXISTS embedding_error;
--   (extension `vector` can be left in place)
-- ============================================================================

CREATE EXTENSION IF NOT EXISTS vector;

-- ----------------------------------------------------------------------------
-- Additive lifecycle columns (all nullable / defaulted; no existing col touched)
-- ----------------------------------------------------------------------------
ALTER TABLE knowledge_chunks
  ADD COLUMN IF NOT EXISTS embedding vector(1536),
  ADD COLUMN IF NOT EXISTS embedding_model text,
  ADD COLUMN IF NOT EXISTS embedding_input_hash text,
  ADD COLUMN IF NOT EXISTS embedding_status text NOT NULL DEFAULT 'pending',
  ADD COLUMN IF NOT EXISTS embedding_updated_at timestamptz,
  ADD COLUMN IF NOT EXISTS embedding_error text;

-- embedding_status domain constraint (guarded so re-run is idempotent)
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'knowledge_chunks_embedding_status_check'
  ) THEN
    ALTER TABLE knowledge_chunks
      ADD CONSTRAINT knowledge_chunks_embedding_status_check
      CHECK (embedding_status IN ('pending', 'embedded', 'failed', 'skipped'));
  END IF;
END$$;

-- ----------------------------------------------------------------------------
-- Partial vector index over non-null embeddings.
-- Prefer HNSW when the access method is available; otherwise fall back to
-- IVFFlat. Partial so null embeddings never pollute vector search.
-- ----------------------------------------------------------------------------
DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM pg_am WHERE amname = 'hnsw') THEN
    CREATE INDEX IF NOT EXISTS idx_knowledge_chunks_embedding_hnsw
      ON knowledge_chunks
      USING hnsw (embedding vector_cosine_ops)
      WHERE embedding IS NOT NULL;
  ELSE
    CREATE INDEX IF NOT EXISTS idx_knowledge_chunks_embedding_ivfflat
      ON knowledge_chunks
      USING ivfflat (embedding vector_cosine_ops)
      WITH (lists = 100)
      WHERE embedding IS NOT NULL;
    -- NOTE: with IVFFlat, run ANALYZE knowledge_chunks after backfill and tune
    -- `lists` (~sqrt(rows)) and set `ivfflat.probes` at query time for recall.
  END IF;
END$$;

-- ----------------------------------------------------------------------------
-- RPC: check_pgvector_available()
-- ----------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION check_pgvector_available()
RETURNS boolean
LANGUAGE sql
STABLE
AS $$
  SELECT EXISTS (SELECT 1 FROM pg_extension WHERE extname = 'vector');
$$;

-- ----------------------------------------------------------------------------
-- RPC: set_knowledge_chunk_embedding(...)
-- Vector arrives as pgvector text and is cast inside SQL.
-- Stale-job guard: only write when the stored input hash is still NULL
-- (never stamped) or equals the job's captured hash. A superseding write
-- stamps a newer hash, so an out-of-order job no-ops.
-- ----------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION set_knowledge_chunk_embedding(
  p_chunk_id text,
  p_embedding text,
  p_embedding_model text,
  p_embedding_input_hash text
)
RETURNS void
LANGUAGE sql
AS $$
  UPDATE knowledge_chunks
  SET embedding            = p_embedding::vector,
      embedding_model      = p_embedding_model,
      embedding_input_hash = p_embedding_input_hash,
      embedding_status     = 'embedded',
      embedding_error      = NULL,
      embedding_updated_at = now()
  WHERE id = p_chunk_id
    AND (embedding_input_hash IS NULL OR embedding_input_hash = p_embedding_input_hash);
$$;

-- ----------------------------------------------------------------------------
-- RPC: mark_knowledge_chunk_embedding_failed(...)
-- Same stale-job guard so a stale failing job cannot clear a newer valid
-- embedding. Error text is truncated to a short, sanitized length by callers;
-- also clamped here defensively.
-- ----------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION mark_knowledge_chunk_embedding_failed(
  p_chunk_id text,
  p_error text,
  p_embedding_input_hash text
)
RETURNS void
LANGUAGE sql
AS $$
  UPDATE knowledge_chunks
  SET embedding            = NULL,
      embedding_status     = 'failed',
      embedding_error      = left(coalesce(p_error, ''), 500),
      embedding_updated_at = now()
  WHERE id = p_chunk_id
    AND (embedding_input_hash IS NULL OR embedding_input_hash = p_embedding_input_hash);
$$;

-- ----------------------------------------------------------------------------
-- RPC: match_knowledge_chunks(...)
-- Tenant + READY + non-null embedding + PARENTHESIZED allowlist filters.
-- Query vector arrives as text and is cast inside SQL.
-- ----------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION match_knowledge_chunks(
  p_tenant_id text,
  p_query_embedding text,
  p_document_id_allowlist text[] DEFAULT NULL,
  p_limit int DEFAULT 20
)
RETURNS TABLE (
  chunk_id text,
  document_id text,
  title text,
  source text,
  content text,
  metadata jsonb,
  document_updated_at timestamptz,
  vector_score double precision
)
LANGUAGE sql
STABLE
AS $$
  SELECT
    kc.id AS chunk_id,
    kc.document_id,
    kd.title,
    kd.source,
    kc.content,
    kc.metadata,
    kd.updated_at AS document_updated_at,
    1 - (kc.embedding <=> p_query_embedding::vector) AS vector_score
  FROM knowledge_chunks kc
  JOIN knowledge_documents kd ON kd.id = kc.document_id
  WHERE kd.tenant_id = p_tenant_id
    AND kd.status = 'READY'
    AND kc.embedding IS NOT NULL
    AND (
      p_document_id_allowlist IS NULL
      OR kd.id = ANY(p_document_id_allowlist)
    )
  ORDER BY kc.embedding <=> p_query_embedding::vector
  LIMIT LEAST(GREATEST(p_limit, 1), 50);
$$;

-- ----------------------------------------------------------------------------
-- Lock down execution to service_role only. These functions trust the
-- caller-provided tenant id, so they must never be callable by anon/authenticated.
-- Role grants are conditional so this migration can still run against a plain
-- local/staging Postgres where Supabase roles may not exist.
-- ----------------------------------------------------------------------------
REVOKE ALL ON FUNCTION check_pgvector_available() FROM PUBLIC;
REVOKE ALL ON FUNCTION set_knowledge_chunk_embedding(text, text, text, text) FROM PUBLIC;
REVOKE ALL ON FUNCTION mark_knowledge_chunk_embedding_failed(text, text, text) FROM PUBLIC;
REVOKE ALL ON FUNCTION match_knowledge_chunks(text, text, text[], int) FROM PUBLIC;

DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'anon') THEN
    REVOKE ALL ON FUNCTION check_pgvector_available() FROM anon;
    REVOKE ALL ON FUNCTION set_knowledge_chunk_embedding(text, text, text, text) FROM anon;
    REVOKE ALL ON FUNCTION mark_knowledge_chunk_embedding_failed(text, text, text) FROM anon;
    REVOKE ALL ON FUNCTION match_knowledge_chunks(text, text, text[], int) FROM anon;
  END IF;

  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'authenticated') THEN
    REVOKE ALL ON FUNCTION check_pgvector_available() FROM authenticated;
    REVOKE ALL ON FUNCTION set_knowledge_chunk_embedding(text, text, text, text) FROM authenticated;
    REVOKE ALL ON FUNCTION mark_knowledge_chunk_embedding_failed(text, text, text) FROM authenticated;
    REVOKE ALL ON FUNCTION match_knowledge_chunks(text, text, text[], int) FROM authenticated;
  END IF;

  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'service_role') THEN
    GRANT EXECUTE ON FUNCTION check_pgvector_available() TO service_role;
    GRANT EXECUTE ON FUNCTION set_knowledge_chunk_embedding(text, text, text, text) TO service_role;
    GRANT EXECUTE ON FUNCTION mark_knowledge_chunk_embedding_failed(text, text, text) TO service_role;
    GRANT EXECUTE ON FUNCTION match_knowledge_chunks(text, text, text[], int) TO service_role;
  END IF;
END$$;
