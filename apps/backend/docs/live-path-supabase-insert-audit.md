# Live-path Supabase insert audit (GHL SMS loop)

Reference: `prisma/migrations/20260419094926_add_conversation_automation_events/migration.sql` + `schema.prisma` `@map` rules.

## Column naming rule

- Prisma `@map("snake_case")` → DB snake_case.
- Prisma field **without** `@map` → DB column name equals Prisma field name (often **camelCase** in quoted Postgres identifiers).

## Tables checked (live loop)

| Table | DB columns (relevant) | Supabase payload fixes applied |
|-------|-------------------------|--------------------------------|
| `webhook_events` | snake_case (`tenant_id`, `external_event_id`, …) | Already matched. **Status update** must filter by `id` (row PK), not `external_event_id` — fixed in `InboundMessageProcessor`. |
| `conversations` | snake_case | Inserts already use snake_case + `id` + `updated_at`. |
| `messages` | `contentType` (**camelCase**), `conversation_id`, … | **Insert + selects**: use `contentType`, not `content_type`. Inbound maps GHL types → enum `TEXT` / `IMAGE` / … |
| `orchestration_logs` | snake_case | Payload already snake_case; `id` set in code. |
| `quota_ledgers` | snake_case | Payload snake_case; `id` set in code. |
| `handover_events` | snake_case | `id` + `updated_at` on insert (when handover path runs). |
| `tenants` | snake_case | Not raw-inserted on this path (reads). |
| `tenant_ghl_connections` | snake_case | Not inserted on inbound worker path (reads / other flows). |

## Files changed in this pass

- `queues/processors/inbound-message.processor.ts` — `contentType`, `mapToDbContentType`, webhook update `.eq('id', …)`, warn on update error.
- `modules/outbound/outbound-send.service.ts` — `contentType` on message insert; conversation `updated_at` touch; insert error handling.
- `modules/orchestration/conversation-memory-loader.ts` — select `contentType`; normalize; `formatPostgrestError` on load failure.
- `modules/conversations/conversations-controller.service.ts` — select `contentType`.

## Later audit (out of scope for this pass)

- Other `.from(...).insert` / broad selects: `action_intents`, `knowledge_*`, scripts, non-GHL paths — verify each column against migration (especially any Prisma field without `@map`).
