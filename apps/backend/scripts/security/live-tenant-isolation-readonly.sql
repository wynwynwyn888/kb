\set ON_ERROR_STOP on
\pset pager off

BEGIN TRANSACTION READ ONLY;
SET LOCAL statement_timeout = '30s';
SET LOCAL lock_timeout = '2s';

SELECT current_database() AS database_name,
       current_user AS database_user,
       current_setting('server_version') AS server_version,
       now() AS audited_at;

SELECT migration_name, finished_at, rolled_back_at
FROM public._prisma_migrations
ORDER BY started_at DESC
LIMIT 15;

SELECT c.relname AS table_name,
       c.relrowsecurity AS rls_enabled,
       c.relforcerowsecurity AS rls_forced,
       count(p.policyname) AS policy_count
FROM pg_catalog.pg_class c
JOIN pg_catalog.pg_namespace n ON n.oid = c.relnamespace
LEFT JOIN pg_catalog.pg_policies p
  ON p.schemaname = n.nspname AND p.tablename = c.relname
WHERE n.nspname = 'public' AND c.relkind = 'r'
GROUP BY c.relname, c.relrowsecurity, c.relforcerowsecurity
ORDER BY c.relname;

SELECT schemaname, tablename, policyname, permissive, roles, cmd, qual, with_check
FROM pg_catalog.pg_policies
WHERE schemaname = 'public'
ORDER BY tablename, policyname;

SELECT grantee,
       privilege_type,
       count(*) AS table_count
FROM information_schema.role_table_grants
WHERE table_schema = 'public'
  AND grantee IN ('anon', 'authenticated', 'service_role')
GROUP BY grantee, privilege_type
ORDER BY grantee, privilege_type;

SELECT conrelid::regclass::text AS table_name,
       conname AS constraint_name,
       contype AS constraint_type,
       convalidated AS validated
FROM pg_catalog.pg_constraint
WHERE connamespace = 'public'::regnamespace
  AND NOT convalidated
ORDER BY table_name, constraint_name;

SELECT event_object_table AS table_name,
       trigger_name,
       action_timing,
       event_manipulation
FROM information_schema.triggers
WHERE trigger_schema = 'public'
  AND trigger_name IN (
    'messages_enforce_tenant',
    'handover_events_enforce_tenant',
    'profile_vault_links_enforce_tenant'
  )
ORDER BY table_name, trigger_name, event_manipulation;

SELECT c.relname AS table_name,
       t.tgname AS trigger_name,
       t.tgenabled AS enabled_mode
FROM pg_catalog.pg_trigger t
JOIN pg_catalog.pg_class c ON c.oid = t.tgrelid
JOIN pg_catalog.pg_namespace n ON n.oid = c.relnamespace
WHERE n.nspname = 'public'
  AND NOT t.tgisinternal
  AND t.tgenabled <> 'O'
ORDER BY c.relname, t.tgname;

SELECT 'messages_null_tenant' AS check_name, count(*) AS anomaly_count
FROM public.messages WHERE tenant_id IS NULL
UNION ALL
SELECT 'messages_missing_conversation', count(*)
FROM public.messages m
LEFT JOIN public.conversations c ON c.id = m.conversation_id
WHERE c.id IS NULL
UNION ALL
SELECT 'messages_parent_tenant_mismatch', count(*)
FROM public.messages m
JOIN public.conversations c ON c.id = m.conversation_id
WHERE m.tenant_id IS DISTINCT FROM c.tenant_id
UNION ALL
SELECT 'handover_events_null_tenant', count(*)
FROM public.handover_events WHERE tenant_id IS NULL
UNION ALL
SELECT 'handover_events_missing_conversation', count(*)
FROM public.handover_events h
LEFT JOIN public.conversations c ON c.id = h.conversation_id
WHERE c.id IS NULL
UNION ALL
SELECT 'handover_events_parent_tenant_mismatch', count(*)
FROM public.handover_events h
JOIN public.conversations c ON c.id = h.conversation_id
WHERE h.tenant_id IS DISTINCT FROM c.tenant_id
UNION ALL
SELECT 'profile_vault_links_null_tenant', count(*)
FROM public.tenant_bot_profile_knowledge_vaults WHERE tenant_id IS NULL
UNION ALL
SELECT 'profile_vault_links_missing_profile', count(*)
FROM public.tenant_bot_profile_knowledge_vaults l
LEFT JOIN public.tenant_bot_profiles p ON p.id = l.profile_id
WHERE p.id IS NULL
UNION ALL
SELECT 'profile_vault_links_missing_vault', count(*)
FROM public.tenant_bot_profile_knowledge_vaults l
LEFT JOIN public.knowledge_vaults v ON v.id = l.vault_id
WHERE v.id IS NULL
UNION ALL
SELECT 'profile_vault_links_owner_mismatch', count(*)
FROM public.tenant_bot_profile_knowledge_vaults l
JOIN public.tenant_bot_profiles p ON p.id = l.profile_id
JOIN public.knowledge_vaults v ON v.id = l.vault_id
WHERE l.tenant_id IS DISTINCT FROM p.tenant_id
   OR l.tenant_id IS DISTINCT FROM v.tenant_id
   OR p.tenant_id IS DISTINCT FROM v.tenant_id
ORDER BY check_name;

SELECT 'duplicate_agency_memberships' AS check_name, count(*) AS anomaly_count
FROM (
  SELECT agency_id, profile_id
  FROM public.agency_users
  GROUP BY agency_id, profile_id
  HAVING count(*) > 1
) duplicates
UNION ALL
SELECT 'duplicate_tenant_memberships', count(*)
FROM (
  SELECT tenant_id, profile_id
  FROM public.tenant_users
  GROUP BY tenant_id, profile_id
  HAVING count(*) > 1
) duplicates
UNION ALL
SELECT 'tenant_missing_agency', count(*)
FROM public.tenants t
LEFT JOIN public.agencies a ON a.id = t.agency_id
WHERE a.id IS NULL
UNION ALL
SELECT 'agency_user_missing_agency', count(*)
FROM public.agency_users au
LEFT JOIN public.agencies a ON a.id = au.agency_id
WHERE a.id IS NULL
UNION ALL
SELECT 'agency_user_missing_profile', count(*)
FROM public.agency_users au
LEFT JOIN public.profiles p ON p.id = au.profile_id
WHERE p.id IS NULL
UNION ALL
SELECT 'tenant_user_missing_tenant', count(*)
FROM public.tenant_users tu
LEFT JOIN public.tenants t ON t.id = tu.tenant_id
WHERE t.id IS NULL
UNION ALL
SELECT 'tenant_user_missing_profile', count(*)
FROM public.tenant_users tu
LEFT JOIN public.profiles p ON p.id = tu.profile_id
WHERE p.id IS NULL
ORDER BY check_name;

SELECT table_name, column_name, is_nullable, data_type
FROM information_schema.columns
WHERE table_schema = 'public'
  AND column_name IN ('tenant_id', 'agency_id', 'profile_id')
ORDER BY table_name, column_name;

SELECT tc.table_name,
       kcu.column_name,
       tc.constraint_name,
       ccu.table_name AS referenced_table,
       ccu.column_name AS referenced_column
FROM information_schema.table_constraints tc
JOIN information_schema.key_column_usage kcu
  ON kcu.constraint_schema = tc.constraint_schema
 AND kcu.constraint_name = tc.constraint_name
JOIN information_schema.constraint_column_usage ccu
  ON ccu.constraint_schema = tc.constraint_schema
 AND ccu.constraint_name = tc.constraint_name
WHERE tc.table_schema = 'public'
  AND tc.constraint_type = 'FOREIGN KEY'
  AND kcu.column_name IN ('tenant_id', 'agency_id', 'profile_id')
ORDER BY tc.table_name, kcu.column_name, tc.constraint_name;

ROLLBACK;
