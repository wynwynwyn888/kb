-- PostgREST cannot infer an embedded conversations relationship when both the
-- legacy conversation_id FK and a new composite (conversation_id, tenant_id) FK
-- exist. Keep the legacy relationship plus direct tenant FK. The ownership
-- trigger continues to reject mismatched tenant/conversation writes.

ALTER TABLE public.messages
  DROP CONSTRAINT IF EXISTS messages_conversation_tenant_fkey;

ALTER TABLE public.handover_events
  DROP CONSTRAINT IF EXISTS handover_events_conversation_tenant_fkey;
