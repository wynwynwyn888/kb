# KB Target Mapping — AISBP-Onboard → KB Config Apply

> **Date**: 2026-06-27
> **Status**: Discovery complete. Mapper contract created. Real KB writes deferred to PR 10C+.
> **PR 10A behaviour preserved**: Apply endpoint returns `KB_TARGET_MAPPING_NOT_IMPLEMENTED`.

---

## 1. Summary Recommendation

Real KB config apply should write to these tables in this order, using existing KB services with NO side-effect imports:

**Phase 1 — Tenant + Identity**:
- `tenants` (create via `TenantsService.createTenant`)
- `onboarding_identity_map` (update `kb_tenant_id`)

**Phase 2 — Knowledge Base**:
- `knowledge_vaults` (create via `KbService.createVault`)
- `knowledge_documents` + `knowledge_chunks` (create via `KbService.createFaq` / `createRichText`)

**Phase 3 — Bot Profile + Prompt**:
- `tenant_bot_profiles` (create via `BotProfilesService.createBotProfile`)
- `tenant_prompt_configs` (linked via `bot_profile_id`)

**Phase 4 — Automation Settings** (one-to-one via `tenantId` PK):
- `tenant_booking_settings` (upsert via `BookingSettingsService.patchBookingSettings`)
- `tenant_follow_up_settings` (upsert via `FollowUpSettingsService.patchFollowUpSettings` — STEPS MUST HAVE NO OUTBOUND TRIGGERS)
- `tenant_human_escalation_settings` (upsert via `HumanEscalationSettingsService.patchSettings`)

**Recommended next PR**: PR 10C — KB Config Apply Adapter Implementation

---

## 2. Exact Models/Tables Inspected

| Model | Table | Purpose |
|-------|-------|---------|
| `Tenant` | `tenants` | Tenant identity, status, client contact |
| `TenantBotProfile` | `tenant_bot_profiles` | Bot persona, goals, tone, business notes |
| `TenantPromptConfig` | `tenant_prompt_configs` | System prompt, temperature, model override |
| `KnowledgeVault` | `knowledge_vaults` | Knowledge base vault |
| `KnowledgeDocument` | `knowledge_documents` | FAQ items, rich text documents |
| `KnowledgeChunk` | `knowledge_chunks` | Text chunks for RAG retrieval |
| `TenantBookingSettings` | `tenant_booking_settings` | Booking automation config |
| `TenantFollowUpSettings` | `tenant_follow_up_settings` | Follow-up automation steps |
| `TenantHumanEscalationSettings` | `tenant_human_escalation_settings` | Handover/escalation config |
| `TenantGhlConnection` | `tenant_ghl_connections` | GHL OAuth connection (NEVER WRITE) |
| `OnboardingIdentityMap` | `onboarding_identity_map` | Onboard → KB tenant link |

---

## 3. Exact Services/Repositories Inspected

| Service | Path | Import |
|---------|------|--------|
| `TenantsService` | `modules/tenants/tenants.service.ts` | `createTenant(agencyId, profileId, input)` |
| `BotProfilesService` | `modules/prompts/bot-profiles.service.ts` | `createBotProfile(profileId, tenantId, body)` |
| `KbService` | `modules/kb/kb.service.ts` | `createFaq()`, `createRichText()`, `createVault()` |
| `BookingSettingsService` | `modules/booking-settings/booking-settings.service.ts` | `patchBookingSettings(tenantId, patch)` |
| `FollowUpSettingsService` | `modules/follow-up-settings/follow-up-settings.service.ts` | `patchFollowUpSettings(tenantId, raw)` |
| `HumanEscalationSettingsService` | `modules/human-escalation/human-escalation-settings.service.ts` | `patchSettings(tenantId, raw)` |

---

## 4. Proposed Onboard → KB Field Mapping

### 4.1 Tenant Identity

| Onboard Source | KB Target Field | Notes |
|----------------|-----------------|-------|
| `business_profile.business_name` | `tenants.name` | Required |
| `client.contact_name` | `tenants.client_contact_name` | Optional |
| `client.contact_phone` (masked) | `tenants.client_contact_phone` | Masked only |
| `client.contact_email` | `tenants.client_contact_email` | Optional |
| `identity_map.ghl_location_id` | `tenants.ghl_location_id` | If already mapped |
| — | `tenants.status` | Set to `"active"` |
| — | `tenants.agency_id` | From the operator's agency |

### 4.2 Bot Profile + Prompt Config

| Onboard Source | KB Target Field | Notes |
|----------------|-----------------|-------|
| `prompt_config.persona` | `tenant_bot_profiles.persona` | System prompt personality |
| `prompt_config.conversation_goals` | `tenant_bot_profiles.conversation_goals` | Array → newline-joined text |
| `prompt_config.business_notes` | `tenant_bot_profiles.business_notes` | Business context |
| `prompt_config.tone_of_voice` | `tenant_bot_profiles.tone_rules` | Tone description |
| `prompt_config.language` | — | Stored in persona/business notes |
| `prompt_config.max_reply_length` | `tenant_prompt_configs.max_tokens` | Mapped to max reply tokens |
| — | `tenant_prompt_configs.temperature` | Default `0.7` |
| — | `tenant_prompt_configs.is_active` | Set to `true` |
| — | `tenant_bot_profiles.is_active` | Set to `true` |

### 4.3 FAQ Items (Knowledge Base)

| Onboard Source | KB Target | Notes |
|----------------|-----------|-------|
| `faq_items[].question` | `knowledge_documents.title` + `metadata.question` | FAQ title |
| `faq_items[].answer` | `knowledge_chunks.content` (single chunk) | FAQ answer |
| `faq_items[].category` | `knowledge_documents.metadata.category` | Category tag |
| — | `knowledge_documents.document_kind` | Set to `"faq"` |
| — | `knowledge_documents.status` | Set to `"READY"` |

### 4.4 Booking Settings

| Onboard Source | KB Target | Notes |
|----------------|-----------|-------|
| `sales_process.booking_link` | `tenant_booking_settings.default_ghl_calendar_id` | If calendar is linked |
| `sales_process.lead_fields_to_collect` | `tenant_booking_settings.core_fields_json` | Name, phone, email → required fields |
| — | `tenant_booking_settings.enabled` | Only if booking recommendation is operator-approved |

### 4.5 Follow-Up Rules

| Onboard Source | KB Target | Notes |
|----------------|-----------|-------|
| `follow_up_rules.enabled` | `tenant_follow_up_settings.enabled` | Must stay `false` if no outbound |
| `follow_up_rules.goal` | `tenant_follow_up_settings.steps_json[0].ai_instruction` | Goal as AI instruction |
| `follow_up_rules.cadence_hours` | `tenant_follow_up_settings.steps_json[0].delay_amount` | Wait time |
| `follow_up_rules.stop_conditions` | `tenant_follow_up_settings.stop_on_customer_reply` etc. | Stop rules |

**CRITICAL**: Follow-up steps must have `mode = "ai_decides"` and NEVER `mode = "fixed_message"` that auto-sends. Outbound must remain disabled (`AISBP_OUTBOUND_THROUGH_KB_ENABLED = false`).

### 4.6 Handover Rules

| Onboard Source | KB Target | Notes |
|----------------|-----------|-------|
| `handover_rules.handover_contact_phone` (masked) | `tenant_human_escalation_settings.team_notification_number` | Required if enabled |
| `handover_rules.triggers` | (stored in metadata) | Trigger conditions |
| `handover_rules.handover_method` | (stored in metadata) | Method used |
| — | `tenant_human_escalation_settings.enabled` | Only if handover recommendation is operator-approved |

---

## 5. Safe Write Order for Future PR

1. Create tenant via `TenantsService.createTenant()` (generates ID, creates quota wallet)
2. Update `onboarding_identity_map.kb_tenant_id` with new tenant ID
3. Create default knowledge vault via `KbService.ensureDefaultVaultForTenant()`
4. Create FAQ documents via `KbService.createFaq()` (one per approved FAQ item)
5. Create bot profile via `BotProfilesService.createBotProfile()` with `setActive: true`
6. Upsert booking settings via `BookingSettingsService.patchBookingSettings()` (only if operator-approved recommendation exists)
7. Upsert follow-up settings via `FollowUpSettingsService.patchFollowUpSettings()` (with `enabled: false` and AI-decides steps only)
8. Upsert escalation settings via `HumanEscalationSettingsService.patchSettings()` (only if operator-approved)

---

## 6. Required Preconditions

- ONBOARD_KB_SYNC_ENABLED = true
- operator must have an agency (required by `createTenant`)
- project must be APPROVED
- dry-run must be DRY_RUN_PASSED with matching snapshot hash
- all required sections must be approved or explicitly waived
- NO FULL PHONE NUMBERS in payload
- NO SECRETS in payload
- AISBP_OUTBOUND_THROUGH_KB_ENABLED = false

---

## 7. Rollback / Audit Notes

- sync_runs already stores `request_payload` and `response_payload` with snapshot hash
- `audit_events` records every write with actor and timestamps
- `buildCurrentSnapshotHash()` can verify source integrity at any time
- Rollback: pause bot, review sync_run snapshots, manually revert in KB dashboard
- Automated rollback is future/non-MVP

---

## 8. Unknowns / Blockers

| Item | Status |
|------|--------|
| Which agency ID to use for tenant creation | Assumed: operator's agency from `SessionUser.agencyId` |
| Operator agency membership validation | `TenantsService.createTenant` already checks agency staff access |
| GHL location ID mapping | Use `onboarding_identity_map.ghl_location_id` if available; otherwise use `pending:` sentinel |
| Bot profile deduplication | `tenant_bot_profiles.@@unique([tenantId, name])` enforces uniqueness |
| Follow-up auto-send risk | Steps must be AI-decides; `enabled` must be false; no fixed_message mode |
| Booking alert sending | `internal_booking_alert_enabled` must be false |

---

## 9. Services/Files to Avoid (NEVER IMPORT)

| Service | Reason |
|---------|--------|
| `modules/outbound/` | Sends real GHL messages |
| `queues/` | Registers BullMQ jobs (SEND_BUBBLE, follow-up, handover notify) |
| `modules/ghl/ghl.service.ts` `saveConnection()` | Writes encrypted GHL tokens |
| `modules/webhooks/` | Inbound webhook processing |
| `modules/orchestration/` | AI orchestration pipeline |
| `modules/conversations/` | Conversation/message persistence |
| `modules/handover/` | Active handover state management |
| `modules/follow-up-engine/` | Follow-up job scheduling |
| Any file importing `@nestjs/bullmq`, `InjectQueue`, or `../../queues/queue.constants` |

---

## 10. Recommended Next PR

**PR 10C — KB Config Apply Adapter Implementation**

Implement the real `OnboardKbSyncService` that calls the above KB services in the safe write order, behind all existing gates (feature flag, approval, snapshot hash match). Wire it into `kbApply()`.
