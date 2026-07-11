-- Add direct tenant ownership to conversation child tables.
-- This migration is additive and rerunnable. Existing rows are backfilled while
-- new writes are derived from, and validated against, the parent conversation.

ALTER TABLE public.messages
  ADD COLUMN IF NOT EXISTS tenant_id TEXT;

ALTER TABLE public.handover_events
  ADD COLUMN IF NOT EXISTS tenant_id TEXT;

UPDATE public.messages AS m
SET tenant_id = c.tenant_id
FROM public.conversations AS c
WHERE m.conversation_id = c.id
  AND m.tenant_id IS DISTINCT FROM c.tenant_id;

UPDATE public.handover_events AS h
SET tenant_id = c.tenant_id
FROM public.conversations AS c
WHERE h.conversation_id = c.id
  AND h.tenant_id IS DISTINCT FROM c.tenant_id;

CREATE UNIQUE INDEX IF NOT EXISTS conversations_id_tenant_id_uidx
  ON public.conversations (id, tenant_id);

CREATE INDEX IF NOT EXISTS messages_tenant_created_idx
  ON public.messages (tenant_id, created_at DESC);

CREATE INDEX IF NOT EXISTS messages_tenant_conversation_created_idx
  ON public.messages (tenant_id, conversation_id, created_at DESC);

CREATE INDEX IF NOT EXISTS handover_events_tenant_status_created_idx
  ON public.handover_events (tenant_id, status, created_at DESC);

CREATE INDEX IF NOT EXISTS handover_events_tenant_conversation_created_idx
  ON public.handover_events (tenant_id, conversation_id, created_at DESC);

CREATE OR REPLACE FUNCTION public.enforce_conversation_child_tenant()
RETURNS trigger
LANGUAGE plpgsql
SECURITY INVOKER
SET search_path = pg_catalog, public
AS $$
DECLARE
  parent_tenant_id TEXT;
BEGIN
  SELECT c.tenant_id
  INTO parent_tenant_id
  FROM public.conversations AS c
  WHERE c.id = NEW.conversation_id;

  IF parent_tenant_id IS NULL THEN
    RAISE EXCEPTION 'conversation % does not exist', NEW.conversation_id
      USING ERRCODE = '23503';
  END IF;

  IF NEW.tenant_id IS NULL THEN
    NEW.tenant_id := parent_tenant_id;
  ELSIF NEW.tenant_id IS DISTINCT FROM parent_tenant_id THEN
    RAISE EXCEPTION 'tenant ownership mismatch for conversation %', NEW.conversation_id
      USING ERRCODE = '23514';
  END IF;

  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS messages_enforce_tenant ON public.messages;
CREATE TRIGGER messages_enforce_tenant
BEFORE INSERT OR UPDATE OF tenant_id, conversation_id ON public.messages
FOR EACH ROW EXECUTE FUNCTION public.enforce_conversation_child_tenant();

DROP TRIGGER IF EXISTS handover_events_enforce_tenant ON public.handover_events;
CREATE TRIGGER handover_events_enforce_tenant
BEFORE INSERT OR UPDATE OF tenant_id, conversation_id ON public.handover_events
FOR EACH ROW EXECUTE FUNCTION public.enforce_conversation_child_tenant();

DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'messages_tenant_id_fkey') THEN
    ALTER TABLE public.messages
      ADD CONSTRAINT messages_tenant_id_fkey
      FOREIGN KEY (tenant_id) REFERENCES public.tenants(id) ON DELETE CASCADE NOT VALID;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'messages_conversation_tenant_fkey') THEN
    ALTER TABLE public.messages
      ADD CONSTRAINT messages_conversation_tenant_fkey
      FOREIGN KEY (conversation_id, tenant_id)
      REFERENCES public.conversations(id, tenant_id) ON DELETE CASCADE NOT VALID;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'handover_events_tenant_id_fkey') THEN
    ALTER TABLE public.handover_events
      ADD CONSTRAINT handover_events_tenant_id_fkey
      FOREIGN KEY (tenant_id) REFERENCES public.tenants(id) ON DELETE CASCADE NOT VALID;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'handover_events_conversation_tenant_fkey') THEN
    ALTER TABLE public.handover_events
      ADD CONSTRAINT handover_events_conversation_tenant_fkey
      FOREIGN KEY (conversation_id, tenant_id)
      REFERENCES public.conversations(id, tenant_id) ON DELETE CASCADE NOT VALID;
  END IF;
END $$;

-- RLS is enabled with membership-based read policies. Backend service-role jobs
-- continue to bypass RLS, so application-level tenant predicates remain required.
ALTER TABLE public.messages ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.handover_events ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS messages_member_select ON public.messages;
CREATE POLICY messages_member_select ON public.messages
FOR SELECT TO authenticated
USING (
  EXISTS (
    SELECT 1 FROM public.tenant_users tu
    WHERE tu.tenant_id = messages.tenant_id AND tu.profile_id = auth.uid()::text
  ) OR EXISTS (
    SELECT 1
    FROM public.tenants t
    JOIN public.agency_users au ON au.agency_id = t.agency_id
    WHERE t.id = messages.tenant_id
      AND au.profile_id = auth.uid()::text
      AND au.role IN ('OWNER', 'ADMIN', 'OPERATOR')
  )
);

DROP POLICY IF EXISTS handover_events_member_select ON public.handover_events;
CREATE POLICY handover_events_member_select ON public.handover_events
FOR SELECT TO authenticated
USING (
  EXISTS (
    SELECT 1 FROM public.tenant_users tu
    WHERE tu.tenant_id = handover_events.tenant_id AND tu.profile_id = auth.uid()::text
  ) OR EXISTS (
    SELECT 1
    FROM public.tenants t
    JOIN public.agency_users au ON au.agency_id = t.agency_id
    WHERE t.id = handover_events.tenant_id
      AND au.profile_id = auth.uid()::text
      AND au.role IN ('OWNER', 'ADMIN', 'OPERATOR')
  )
);

REVOKE ALL ON FUNCTION public.enforce_conversation_child_tenant() FROM PUBLIC;
