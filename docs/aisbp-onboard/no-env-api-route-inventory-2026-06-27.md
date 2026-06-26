# AISBP-Onboard API Route / Contract Inventory — 2026-06-27

> **No-env verification**: All 30 endpoints documented below exist in code. Verified by inspection of `onboard.controller.ts` and `agent/agent.controller.ts`.

---

## Agent API (AgentTokenGuard)

| Method | Path | Writes Data | Calls KB | Calls GHL | Sends Msg | Notes |
|--------|------|------------|----------|-----------|-----------|-------|
| POST | `/api/v1/onboard/agent/sessions` | Yes | No | No | No | Create or resume existing session |
| GET | `/api/v1/onboard/agent/sessions/:id` | No | No | No | No | Get session details + progress |
| POST | `/api/v1/onboard/agent/sessions/:id/answers` | Yes | No | No | No | Upsert answers (by project+section+key) |
| GET | `/api/v1/onboard/agent/projects/:id/missing-fields` | No | No | No | No | Per-section completeness |
| POST | `/api/v1/onboard/agent/projects/:id/request-review` | Yes | No | No | No | Sets project to SUBMITTED |
| POST | `/api/v1/onboard/agent/projects/:id/analysis` | Yes | No | No | No | AI analysis + recommendations |
| GET | `/api/v1/onboard/agent/projects/:id/status` | No | No | No | No | Project status for agent |

**Total agent endpoints**: 7

---

## Operator CRUD API (JwtAuthGuard + OnboardOperatorGuard)

| Method | Path | Writes Data | Calls KB | Calls GHL | Sends Msg | Notes |
|--------|------|------------|----------|-----------|-----------|-------|
| GET | `/api/v1/onboard/clients` | No | No | No | No | List all clients |
| POST | `/api/v1/onboard/clients` | Yes | No | No | No | Create client (phone masked) |
| GET | `/api/v1/onboard/clients/:id` | No | No | No | No | Get client by ID or clientKey |
| PATCH | `/api/v1/onboard/clients/:id` | Yes | No | No | No | Update client fields |
| GET | `/api/v1/onboard/projects` | No | No | No | No | List all projects |
| POST | `/api/v1/onboard/projects` | Yes | No | No | No | Create project |
| GET | `/api/v1/onboard/projects/:id` | No | No | No | No | Get project by ID |
| PATCH | `/api/v1/onboard/projects/:id` | Yes | No | No | No | Update project metadata |

**Total operator CRUD endpoints**: 8

---

## Approval API (JwtAuthGuard + OnboardOperatorGuard)

| Method | Path | Writes Data | Calls KB | Calls GHL | Sends Msg | Notes |
|--------|------|------------|----------|-----------|-----------|-------|
| POST | `/api/v1/onboard/projects/:id/sections/:name/approve` | Yes | No | No | No | Section must be COMPLETE |
| POST | `/api/v1/onboard/projects/:id/request-changes` | Yes | No | No | No | Comment required |
| POST | `/api/v1/onboard/projects/:id/reject` | Yes | No | No | No | Comment required |
| POST | `/api/v1/onboard/projects/:id/approve` | Yes | No | No | No | Required sections must be approved |
| GET | `/api/v1/onboard/projects/:id/approval-events` | No | No | No | No | Approval history |
| GET | `/api/v1/onboard/projects/:id/audit` | No | No | No | No | Audit trail |

**Total approval endpoints**: 6

---

## KB Sync API (JwtAuthGuard + OnboardOperatorGuard)

| Method | Path | Writes Data | Calls KB | Calls GHL | Sends Msg | Notes |
|--------|------|------------|----------|-----------|-----------|-------|
| POST | `/api/v1/onboard/projects/:id/sync/kb/dry-run` | Yes (sync_runs) | No | No | No | Preview only, no KB mutation |
| POST | `/api/v1/onboard/projects/:id/sync/kb/apply` | Yes | Yes | No | No | 5 scopes, feature flag gated |
| GET | `/api/v1/onboard/projects/:id/sync/kb/plan-preview` | No | No | No | No | Mapper preview, no write |
| GET | `/api/v1/onboard/projects/:id/sync-runs` | No | No | No | No | Sync run history |
| GET | `/api/v1/onboard/projects/:id/analysis` | No | No | No | No | Workflow analysis (read) |
| GET | `/api/v1/onboard/projects/:id/recommendations` | No | No | No | No | Automation recs (read) |

**Total KB sync endpoints**: 6

---

## GHL API (JwtAuthGuard + OnboardOperatorGuard)

| Method | Path | Writes Data | Calls KB | Calls GHL | Sends Msg | Notes |
|--------|------|------------|----------|-----------|-----------|-------|
| POST | `/api/v1/onboard/projects/:id/sync/ghl/validate` | Yes (sync_runs) | No | No | No | Local only, no GHL API calls |
| POST | `/api/v1/onboard/projects/:id/sync/ghl/dry-run` | Yes (sync_runs) | No | No | No | All ops disabled, no-write |

**Total GHL endpoints**: 2

---

## Notification API (JwtAuthGuard + OnboardOperatorGuard)

| Method | Path | Writes Data | Calls KB | Calls GHL | Sends Msg | Notes |
|--------|------|------------|----------|-----------|-----------|-------|
| GET | `/api/v1/onboard/notifications/review-alerts` | No | No | No | No | In-app only, no external notify |

**Total notification endpoints**: 1

---

## Summary

| Category | Count | Guard | Can Write KB | Can Call GHL | Can Send Msg |
|----------|-------|-------|-------------|-------------|-------------|
| Agent | 7 | AgentTokenGuard | **No** | **No** | **No** |
| Operator CRUD | 8 | JwtAuthGuard + OnboardOperatorGuard | No | No | No |
| Approval | 6 | JwtAuthGuard + OnboardOperatorGuard | No | No | No |
| KB Sync | 6 | JwtAuthGuard + OnboardOperatorGuard | Yes (apply only, gated) | No | No |
| GHL | 2 | JwtAuthGuard + OnboardOperatorGuard | No | No (local only) | No |
| Notification | 1 | JwtAuthGuard + OnboardOperatorGuard | No | No | No |
| **Total** | **30** | — | — | — | — |

**Key confirmations**:
- Agent can NEVER approve, sync, call KB/GHL, or send messages
- Operator always requires JWT + agency role (OWNER/ADMIN/OPERATOR)
- GHL is local/no-write only — no GHL API calls in any endpoint
- No endpoint sends messages or activates outbound
- No endpoint activates bot profile
