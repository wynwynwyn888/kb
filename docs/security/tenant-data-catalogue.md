# Tenant Data and Authorization Catalogue

Baseline: `26a82f03975688da2f7c3cf30143091c6a942057`

Architecture: one agency, multiple isolated tenant workspaces

Owner: backend/security
Review rule: update this catalogue in the same pull request as any Prisma model, ownership, authorization, RLS, retention, or service-role change.

## How to read this catalogue

This is the authoritative ownership decision for every Prisma model. The Prisma schema currently contains 39 application models. Production has 40 public tables because `_prisma_migrations` is an infrastructure table and is not a Prisma application model.

Ownership classes are:

- `platform`: infrastructure or platform-global data;
- `agency`: owned by the single agency, using `agency_id` or a named agency parent;
- `tenant`: owned directly by immutable `tenant_id`;
- `user`: owned by `profile_id`/authenticated user;
- `inherited`: tenant ownership must be resolved through the named authoritative parent.

Role notation:

- `AO`: agency OWNER;
- `AA`: agency ADMIN;
- `OP`: agency OPERATOR;
- `TM`: explicitly assigned tenant member, further limited by tenant role;
- `SELF`: the profile owning personal data;
- `INT`: allowlisted internal worker or platform administration path.

`R` means read, `C` create, `U` update, and `D` delete. The matrix documents the target authorization decision; deployed database enforcement is stated separately. No role gains mutation rights merely because it can read.

## Catalogue

| Prisma model | Database table | Ownership and null rule | Sensitivity | Allowed application access | Deployed database boundary | Known service-role surfaces | Required next decision |
|---|---|---|---|---|---|---|---|
| `Profile` | `profiles` | user: `id = auth.uid()`; never tenant-owned | confidential identity | SELF:R/U; AO/AA:R for administration; INT:C/U | RLS enabled; no documented user policy | auth, invitations, agency-users, tenant-users | Define self and scoped administrator policies; prevent directory-wide reads. |
| `Agency` | `agencies` | agency root: `id`; no nullable owner | confidential configuration | AO:R/U; AA/OP:R; INT:C/D | RLS enabled; no documented user policy | auth, agencies, tenants, quotas, ops | Add single-agency membership read and owner-only mutation policies. |
| `UserInvitation` | `user_invitations` | agency: required `agency_id`; `tenant_id` nullable only for agency-wide invite | confidential identity/access | AO/AA:CRUD; invited SELF:R/accept via narrow flow | RLS enabled; no documented user policy | invitations | Add checked scope type and enforce tenant belongs to agency. |
| `AgencyUser` | `agency_users` | agency: required `agency_id` plus `profile_id` | restricted authorization | AO/AA:CRUD subject to role rules; SELF:R | RLS enabled; no documented user policy | auth, agencies, agency-users, invitations | Add non-recursive membership policies and last-owner protection. |
| `Tenant` | `tenants` | tenant root: required `agency_id` | confidential workspace | AO/AA:CRUD; OP:R; TM:R assigned tenant | RLS enabled; no documented user policy | tenants, auth, ops, most tenant services | Add tenant-root policies using fixed-path membership helpers. |
| `WorkspaceCreditWarningEvent` | `workspace_credit_warning_events` | tenant: required `tenant_id` and `agency_id`; must agree | confidential billing/operations | AO/AA/OP:R; INT:C/U | RLS enabled; no documented user policy | credit-warnings, notifications | Enforce agency/tenant equality and internal-only writes. |
| `WorkspaceCreditResetReminderEvent` | `workspace_credit_reset_reminder_events` | tenant: required `tenant_id` and `agency_id`; must agree | confidential billing/operations | AO/AA/OP:R; INT:C/U | RLS enabled; no documented user policy | credit-reset-reminders, notifications | Enforce agency/tenant equality and internal-only writes. |
| `TenantTaggingSettings` | `tenant_tagging_settings` | tenant: `tenant_id` is required primary key | confidential configuration | AO/AA:CRUD; OP:R/U operational; TM:R, admin-role U | RLS enabled; no documented user policy | intent-tags | Add tenant configuration CRUD policies. |
| `TenantTagRule` | `tenant_tag_rules` | tenant: required `tenant_id` | confidential configuration | AO/AA:CRUD; OP:R/U; TM:R, admin-role C/U/D | RLS enabled; no documented user policy | intent-tags | Add tenant configuration CRUD policies and tenant-leading tests. |
| `TenantBookingSettings` | `tenant_booking_settings` | tenant: `tenant_id` is required primary key | confidential configuration | AO/AA:CRUD; OP:R/U; TM:R, admin-role U | RLS enabled; no documented user policy | booking-settings, booking-flow | Add tenant configuration CRUD policies. |
| `TenantFollowUpSettings` | `tenant_follow_up_settings` | tenant: `tenant_id` is required primary key | confidential configuration | AO/AA:CRUD; OP:R/U; TM:R, admin-role U | RLS enabled; no documented user policy | follow-up-settings, follow-up-engine | Add tenant configuration CRUD policies. |
| `TenantHumanEscalationSettings` | `tenant_human_escalation_settings` | tenant: `tenant_id` is required primary key | confidential configuration/contact destination | AO/AA:CRUD; OP:R/U; TM:R, admin-role U | RLS enabled; no documented user policy | human-escalation settings/runtime | Add tenant configuration policies; redact notification destinations from non-admins. |
| `ConversationFollowUpJob` | `conversation_follow_up_jobs` | tenant: required `tenant_id`; conversation must have same tenant | restricted automation | AO/AA/OP:R; INT:CRUD | RLS enabled; no documented user policy; no Prisma relation to conversation | follow-up-engine, recovery workers | Add conversation/tenant FK or constraint trigger; internal-only mutations. |
| `TenantUser` | `tenant_users` | tenant: required `tenant_id` plus `profile_id` | restricted authorization | AO/AA:CRUD; tenant admin limited CRUD; SELF:R | RLS enabled; no documented user policy | auth, tenant-users, invitations, tenants | Add non-recursive membership policies and revocation behavioral tests. |
| `TenantGhlConnection` | `tenant_ghl_connections` | tenant: required unique `tenant_id` | secret credentials/integration | AO/AA:CRUD; OP:R health metadata only; INT:R/U secrets | RLS enabled; no documented user policy | ghl, webhooks, transcription, outbound | Separate secret material from safe status; never return tokens through user RLS. |
| `AgencyModelProvider` | `agency_model_providers` | agency: required `agency_id` | secret credentials/model config | AO:CRUD; AA:R/U by policy; INT:R | RLS enabled; no documented user policy | agency-ai-config, generation | Restrict secret columns to narrow server operations. |
| `AgencySystemPolicy` | `agency_system_policies` | agency: required unique `agency_id` | restricted global AI policy | AO:CRUD; AA:R/U; OP:R | RLS enabled; no documented user policy | prompts, orchestration, agency config | Add agency role policies and immutable audit trail for changes. |
| `TenantPromptConfig` | `tenant_prompt_configs` | tenant: required `tenant_id` | restricted AI instructions | AO/AA:CRUD; OP:R/U; tenant admin:R/U | RLS enabled; no documented user policy | prompts, orchestration | Add tenant prompt CRUD policies and cross-tenant prompt tests. |
| `TenantBotProfile` | `tenant_bot_profiles` | tenant: required `tenant_id` | restricted AI instructions | AO/AA:CRUD; OP:R/U; tenant admin:CRUD | RLS enabled; no documented user policy | prompts/bot-profiles, orchestration | Add tenant CRUD policies; preserve tenant/vault link consistency. |
| `TenantModelOverride` | `tenant_model_overrides` | tenant: required `tenant_id` | restricted model configuration | AO/AA:CRUD; OP:R; tenant admin:R/U if enabled | RLS enabled; no documented user policy | agency-ai-config, generation | Define whether tenant admins may mutate; add policies after decision. |
| `KnowledgeVault` | `knowledge_vaults` | tenant: required `tenant_id` | confidential business knowledge | AO/AA:CRUD; OP:R/U; TM:R, admin-role CRUD | RLS enabled; no documented user policy | kb, orchestration | Add tenant CRUD policies and deletion/retention rules. |
| `TenantBotProfileKnowledgeVault` | `tenant_bot_profile_knowledge_vaults` | tenant: required `tenant_id`; profile and vault must share tenant | confidential relationship | AO/AA:CRUD; OP:R/U; tenant admin:CRUD | RLS enabled; `profile_vault_links_member_select` uses `can_read_tenant(tenant_id)`; direct authenticated writes denied | prompts/bot-profiles, kb | Add role-specific mutation policies only after behavioral tests. |
| `KnowledgeDocument` | `knowledge_documents` | tenant: required `tenant_id`; vault must share tenant | confidential business knowledge/source metadata | AO/AA:CRUD; OP:R/U; TM:R, admin-role CRUD; INT:C/U ingestion | RLS enabled; no documented user policy | kb, kb-ingest | Enforce document/vault equality and add tenant CRUD policies. |
| `KnowledgeChunk` | `knowledge_chunks` | inherited: `document_id -> knowledge_documents.tenant_id`; no legal standalone/null owner | confidential derived business knowledge | Same read boundary as document; INT:CRUD ingestion | RLS enabled; no documented user policy | kb, vector context/shadow, kb-ingest | Add immutable direct `tenant_id`, backfill, constraint, and tenant-leading index. |
| `Conversation` | `conversations` | tenant: required `tenant_id` | highly confidential customer communication | AO/AA/OP:R/U; assigned TM:R/U by role; INT:CRUD messaging | RLS enabled; no documented user policy | conversations, orchestration, handover, workers, ops | Add read/update policies; define customer-data deletion and retention. |
| `Message` | `messages` | tenant: required `tenant_id`; conversation must share tenant | highly confidential customer content | AO/AA/OP:R; assigned TM:R; INT:CRUD messaging | RLS enabled; `messages_member_select` uses `can_read_tenant(tenant_id)`; direct authenticated writes denied | conversations, orchestration, inbound/send workers | Retain internal-only writes; add content retention and verified parent constraint tests. |
| `HandoverEvent` | `handover_events` | tenant: required `tenant_id`; conversation must share tenant | highly confidential escalation/customer context | AO/AA/OP:R/U; assigned operational TM:R/U; INT:C/U | RLS enabled; `handover_events_member_select` uses `can_read_tenant(tenant_id)`; direct authenticated writes denied | handover, human-escalation, notifications, workers | Define mutation roles and add role-specific policies only after tests. |
| `ConversationAutomationEvent` | `conversation_automation_events` | inherited: `conversation_id -> conversations.tenant_id`; no standalone owner | restricted automation history | AO/AA/OP:R; assigned TM:R where exposed; INT:CRUD | RLS enabled; no documented user policy | orchestration, follow-up, recovery | Add immutable direct `tenant_id` and enforce conversation equality. |
| `QuotaWallet` | `quota_wallets` | tenant: required unique `tenant_id` | confidential billing/balance | AO/AA:R/U; OP:R; tenant admin:R; INT:C/U | RLS enabled; no documented user policy | quotas, orchestration | Add read policies; keep balance mutations in narrow transactional RPC. |
| `QuotaLedger` | `quota_ledgers` | inherited: `wallet_id -> quota_wallets.tenant_id`; optional conversation must match tenant | confidential billing ledger | AO/AA:R; OP:R; tenant admin:R; INT:C immutable ledger | RLS enabled; no documented user policy | quotas, orchestration | Add direct immutable `tenant_id`; prohibit update/delete except controlled correction. |
| `QuotaAuditLog` | `quota_audit_logs` | agency: required `agency_id`; `tenant_id` nullable only for agency-global billing event; profile required | restricted billing audit | AO/AA:R; OP:R limited; INT:C immutable | RLS enabled; no documented user policy | quotas | Add typed scope and agency/tenant consistency; append-only policies. |
| `ActionLog` | `action_logs` | tenant: required `tenant_id`; optional conversation must match when present | confidential sales/action history | AO/AA/OP:R; assigned TM:R; INT:C/U execution | RLS enabled; no documented user policy | action execution/gating | Enforce conversation tenant consistency; restrict mutation to executor. |
| `ActionIntent` | `action_intents` | tenant: required `tenant_id`; optional conversation must match when present | confidential proposed business action | AO/AA/OP:R/U; assigned authorized TM:R/U; INT:C/U | RLS enabled; no documented user policy | action-intents/execution/gating | Enforce conversation equality and explicit approval-role policies. |
| `AuditLog` | `audit_logs` | agency: required `agency_id`; `tenant_id` nullable only for agency-global event; profile required | restricted security audit | AO/AA:R; OP:R limited; INT:C immutable | RLS enabled; no documented user policy | audit and administration modules | Add typed scope, tenant/agency consistency, append-only policies, retention. |
| `WebhookEvent` | `webhook_events` | tenant: required `tenant_id` | restricted external event metadata | AO/AA/OP:R status; INT:CRUD processing | RLS enabled; no documented user policy | webhooks, inbound processors | Internal-only writes; tenant-scoped idempotency and signed-source enforcement. |
| `OrchestrationLog` | `orchestration_logs` | tenant: required `tenant_id`; conversation must share tenant | restricted operational trace, potentially customer-derived | AO/AA/OP:R redacted; INT:C/U | RLS enabled; no documented user policy | orchestration, ops | Enforce conversation equality; define redaction/retention and internal writes. |
| `Notification` | `notifications` | user: required `profile_id`; tenant/agency scope absent, so workspace ownership is ambiguous | confidential user/workspace alert | SELF:R/U; INT:C/D | RLS enabled; no documented user policy; no Prisma relation to profile | notifications, credit/escalation flows | Add typed platform/user/workspace scope and tenant/agency discriminator where applicable. |
| `OutboundSend` | `outbound_sends` | tenant: required `tenant_id`; conversation must share tenant | highly confidential delivery/idempotency metadata | AO/AA/OP:R redacted; INT:CRUD outbound | RLS enabled; no documented user policy; no Prisma relation to conversation | outbound services and send/sync workers | Add ownership constraint, tenant-scoped idempotency, internal-only mutations. |
| `MetricsEvent` | `metrics_events` | tenant: `tenant_id` nullable only for explicitly typed platform-global metric; optional conversation must match tenant | restricted operational telemetry | AO/AA/OP:R aggregate only; INT:C/D retention | RLS enabled; no documented user policy; no Prisma relation to tenant/conversation | metrics, ops | Add typed scope, ownership relations/validation, content-free retention policy. |

## Non-Prisma public table

| Database table | Ownership | Access decision |
|---|---|---|
| `_prisma_migrations` | platform infrastructure | Migration runner/database administration only. It is excluded from the 39-model application catalogue and must never be exposed through user APIs. |

## Current RLS policy inventory

Production baseline has RLS enabled on all public tables, but only these authenticated tenant-data policies are currently deployed:

| Policy | Table | Command | Evaluation |
|---|---|---|---|
| `messages_member_select` | `messages` | SELECT | `public.can_read_tenant(tenant_id)` |
| `handover_events_member_select` | `handover_events` | SELECT | `public.can_read_tenant(tenant_id)` |
| `profile_vault_links_member_select` | `tenant_bot_profile_knowledge_vaults` | SELECT | `public.can_read_tenant(tenant_id)` |

All other policy entries above mean “RLS enabled with no documented user policy”, not that the table is safely available to authenticated users. Ordinary backend service-role access bypasses RLS and remains a classified migration risk.

## Deployed single-agency read contract

- Agency OWNER, ADMIN, and OPERATOR can read all tenants in the one agency.
- An explicit tenant membership can read its assigned tenant.
- Agency MEMBER alone grants no tenant access.
- Revoked, unrelated, and anonymous users receive no tenant rows.
- Database mutation access is denied on the three protected tables until separately specified and behaviorally tested.

## Change-control checklist

Any pull request adding or changing a model must answer:

1. What is the authoritative owner and can it ever be null?
2. Which parent/child consistency rule prevents cross-tenant references?
3. Which roles may perform each CRUD action?
4. Is access through caller JWT/RLS, a narrow RPC, or an allowlisted internal adapter?
5. What are the RLS policy and grant decisions?
6. What are retention and deletion semantics?
7. Which real two-tenant negative tests prove denial and absence of side effects?
