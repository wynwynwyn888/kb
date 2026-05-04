-- Per-profile knowledge scope mode (MVP: all workspace; future: selected collections)
ALTER TABLE "tenant_bot_profiles" ADD COLUMN "knowledge_scope_mode" TEXT NOT NULL DEFAULT 'all_workspace_knowledge';
