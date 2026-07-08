-- ============================================================================
-- RAG Shadow Lane: tenant-scope the embedding WRITE RPCs (Codex blocker #3/#4)
-- ----------------------------------------------------------------------------
-- SAFETY / SCOPE:
--   * ADDITIVE / REPLACES ONLY the two service-role WRITE RPCs. No table column
--     is added, changed, or dropped. Live keyword retrieval is untouched.
--   * `service_role` bypasses RLS, so the previous chunk-id-only signatures could
--     write across tenants. These replacements require `p_tenant_id` and verify
--     the chunk's owning document belongs to that tenant before writing.
--   * Both RPCs keep the stale input-hash guard AND now stamp/preserve the
--     captured hash so an out-of-order (stale) success OR failure job can never
--     clobber a newer embedding/hash.
--   * Vector I/O still crosses PostgREST as TEXT and is cast to `vector` in SQL.
--   * Intended for STAGING/LOCAL first. Do NOT apply to production without
--     explicit approval.
--
-- ROLLBACK (manual, if ever needed):
--   DROP FUNCTION IF EXISTS set_knowledge_chunk_embedding(text, text, text, text, text);
--   DROP FUNCTION IF EXISTS mark_knowledge_chunk_embedding_failed(text, text, text, text);
--   -- (the previous 4-arg / 3-arg signatures were dropped by this migration)
-- ============================================================================

-- Drop the previous, non-tenant-scoped signatures so callers cannot invoke a
-- function that trusts a bare chunk id. Guarded by IF EXISTS for idempotency.
DROP FUNCTION IF EXISTS set_knowledge_chunk_embedding(text, text, text, text);
DROP FUNCTION IF EXISTS mark_knowledge_chunk_embedding_failed(text, text, text);

-- ----------------------------------------------------------------------------
-- RPC: set_knowledge_chunk_embedding(tenant, chunk, embedding, model, hash)
-- Tenant-scoped: the UPDATE only matches a chunk whose owning document belongs
-- to p_tenant_id. Vector arrives as pgvector text and is cast inside SQL.
-- Stale-job guard: only write when the stored input hash is still NULL (never
-- stamped) or equals the job's captured hash. A superseding write stamps a newer
-- hash, so an out-of-order job no-ops. The captured hash is stamped on success.
-- ----------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION set_knowledge_chunk_embedding(
  p_tenant_id text,
  p_chunk_id text,
  p_embedding text,
  p_embedding_model text,
  p_embedding_input_hash text
)
RETURNS void
LANGUAGE sql
AS $$
  UPDATE knowledge_chunks kc
  SET embedding            = p_embedding::vector,
      embedding_model      = p_embedding_model,
      embedding_input_hash = p_embedding_input_hash,
      embedding_status     = 'embedded',
      embedding_error      = NULL,
      embedding_updated_at = now()
  FROM knowledge_documents kd
  WHERE kc.id = p_chunk_id
    AND kd.id = kc.document_id
    AND kd.tenant_id = p_tenant_id
    AND (kc.embedding_input_hash IS NULL OR kc.embedding_input_hash = p_embedding_input_hash);
$$;

-- ----------------------------------------------------------------------------
-- RPC: mark_knowledge_chunk_embedding_failed(tenant, chunk, error, hash)
-- Tenant-scoped with the same stale-job guard so a stale failing job cannot
-- clear a newer valid embedding. The captured hash is stamped/preserved so the
-- failed row records which input failed and a later stale job for a different
-- input no-ops. Error text is sanitized/truncated by callers; clamped here too.
-- ----------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION mark_knowledge_chunk_embedding_failed(
  p_tenant_id text,
  p_chunk_id text,
  p_error text,
  p_embedding_input_hash text
)
RETURNS void
LANGUAGE sql
AS $$
  UPDATE knowledge_chunks kc
  SET embedding            = NULL,
      embedding_input_hash = p_embedding_input_hash,
      embedding_status     = 'failed',
      embedding_error      = left(coalesce(p_error, ''), 500),
      embedding_updated_at = now()
  FROM knowledge_documents kd
  WHERE kc.id = p_chunk_id
    AND kd.id = kc.document_id
    AND kd.tenant_id = p_tenant_id
    AND (kc.embedding_input_hash IS NULL OR kc.embedding_input_hash = p_embedding_input_hash);
$$;

-- ----------------------------------------------------------------------------
-- Lock down execution to service_role only for the new signatures.
-- ----------------------------------------------------------------------------
REVOKE ALL ON FUNCTION set_knowledge_chunk_embedding(text, text, text, text, text) FROM PUBLIC;
REVOKE ALL ON FUNCTION mark_knowledge_chunk_embedding_failed(text, text, text, text) FROM PUBLIC;

DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'anon') THEN
    REVOKE ALL ON FUNCTION set_knowledge_chunk_embedding(text, text, text, text, text) FROM anon;
    REVOKE ALL ON FUNCTION mark_knowledge_chunk_embedding_failed(text, text, text, text) FROM anon;
  END IF;

  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'authenticated') THEN
    REVOKE ALL ON FUNCTION set_knowledge_chunk_embedding(text, text, text, text, text) FROM authenticated;
    REVOKE ALL ON FUNCTION mark_knowledge_chunk_embedding_failed(text, text, text, text) FROM authenticated;
  END IF;

  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'service_role') THEN
    GRANT EXECUTE ON FUNCTION set_knowledge_chunk_embedding(text, text, text, text, text) TO service_role;
    GRANT EXECUTE ON FUNCTION mark_knowledge_chunk_embedding_failed(text, text, text, text) TO service_role;
  END IF;
END$$;
