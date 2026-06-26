# AISBP-Onboard — Security & Auth Rules

## 1. Threat Model

```
┌─────────────────────────────────────────────────────────────────┐
│                        THREAT ACTORS                            │
├─────────────────────────────────────────────────────────────────┤
│                                                                 │
│  External Attacker                                               │
│  - Unauthenticated API access                                   │
│  - Replay attacks on sync endpoints                             │
│  - Injection via answer payloads                                │
│  - Data exfiltration via API responses                          │
│                                                                 │
│  AI Agent (Compromised or Hallucinating)                        │
│  - Submits wrong/harmful config                                 │
│  - Attempts to approve its own work                             │
│  - Attempts to trigger sync directly                            │
│  - Floods API with garbage data                                 │
│                                                                 │
│  Hermes / OpenClaw Agents                                       │
│  - Generates code that bypasses approval                        │
│  - Approves their own generated config                          │
│  - Modifies production data without review                      │
│                                                                 │
│  Insider (Operator Error)                                       │
│  - Accidentally approves bad config                             │
│  - Triggers sync before verification                            │
│  - Exposes sensitive data                                       │
│                                                                 │
│  Supply Chain                                                    │
│  - Compromised dependency                                       │
│  - Leaked service token                                         │
│  - Misconfigured environment                                    │
└─────────────────────────────────────────────────────────────────┘
```

---

## 2. User Roles

| Role | Scope | Auth Method | Can Draft | Can Approve | Can Sync |
|------|-------|-------------|-----------|-------------|----------|
| `agent` | Single project | Agent API token | Yes | **No** | **No** |
| `operator` | All projects | Supabase JWT | Yes | Yes | Yes |
| `admin` | All projects + settings | Supabase JWT | Yes | Yes | Yes |
| `service` | Internal only | Service token | No | No | Yes (triggered by operator) |
| `viewer` | Read-only (future) | Supabase JWT | No | No | No |

---

## 3. Permission Matrix

| Action | Agent | Operator | Admin | Service |
|--------|-------|----------|-------|---------|
| Create session | ✅ | ✅ | ✅ | ❌ |
| Submit answers | ✅ | ✅ | ✅ | ❌ |
| Submit analysis | ✅ | ✅ | ✅ | ❌ |
| View own project | ✅ | ✅ | ✅ | ❌ |
| Request review | ✅ | ✅ | ✅ | ❌ |
| View all projects | ❌ | ✅ | ✅ | ❌ |
| Create project | ❌ | ✅ | ✅ | ❌ |
| Edit any section | ❌ | ✅ | ✅ | ❌ |
| Approve section | ❌ | ✅ | ✅ | ❌ |
| Reject section | ❌ | ✅ | ✅ | ❌ |
| Request changes | ❌ | ✅ | ✅ | ❌ |
| Approve project | ❌ | ✅ | ✅ | ❌ |
| Trigger sync | ❌ | ✅ | ✅ | ❌ |
| View audit log | ❌ | ✅ | ✅ | ❌ |
| Manage settings | ❌ | ❌ | ✅ | ❌ |
| Execute sync job | ❌ | ❌ | ❌ | ✅ |

---

## 4. Agent Token Scopes

Agent API tokens:
- Only have `agent` scope
- Map to a specific `projectId` (not global)
- Are rate-limited (default 30 req/min)
- Cannot access operator/admin endpoints
- Are validated on every request

**Code-level enforcement**: All agent endpoints use `@UseGuards(AgentTokenGuard)`. All operator endpoints use `@UseGuards(JwtAuthGuard, OperatorGuard)`.

---

## 5. Hermes / OpenClaw Scopes

- Hermes/OpenClaw coding agents have the **same permissions as the user they're assisting**
- They must **never approve their own work** — approval requires a separate human action
- If Hermes generates integration code, a human must review and approve before deploy
- No coding agent receives agent API tokens or service tokens in their context
- Coding agents must not disable feature flags

---

## 6. Wyn / Admin Permissions

- Wyn (as `operator` or `admin`) is the **sole approver** for MVP
- Wyn can: view all projects, edit any section, approve/reject, trigger sync
- Wyn cannot: bypass the approval gate (it's enforced in code, not just UI)
- Wyn's actions are fully audited — every approval, rejection, and sync trigger logged

---

## 7. Approval Authority Rules

1. **Only `operator` or `admin` can approve** — enforced at API level
2. **Agent cannot approve even if it knows the operator's credentials** — role check, not credential check
3. **All sections must be approved before project approval**
4. **All projects must be approved before sync**
5. **Approval events are immutable** — no delete/edit of approval records

---

## 8. Service Token Rules

- Service tokens are used for internal server-to-server communication
- They have `service` scope — can execute sync but cannot approve
- Service tokens are never exposed to clients or agents
- Service token validation requires the `ONBOARD_SERVICE_TOKEN_SECRET`
- Service token endpoints are not accessible from the public internet (internal only)

---

## 9. Idempotency Key Rules

| Rule | Detail |
|------|--------|
| Generated server-side | Sync run idempotency keys are SHA256 hashes |
| Unique per operation | `SHA256(projectId + targetSystem + mode + version)` |
| Enforced at DB level | Unique constraint on `idempotency_key` in `sync_runs` |
| Agent answers | Optional `X-Idempotency-Key` header accepted |
| Duplicate response | `409 Conflict` with existing resource ID |
| Not guessable | 256-bit hash, not sequential |

---

## 10. Rate Limits

| Actor | Limit | Window | Scope |
|-------|-------|--------|-------|
| Agent | 30 requests | Per minute | Per token |
| Operator | 120 requests | Per minute | Per user |
| Unauthenticated | 10 requests | Per minute | Per IP |
| Sync endpoints | 5 requests | Per minute | Per project |

Implemented via `@nestjs/throttler` with custom guard per route.

---

## 11. Audit Logging Rules

### What must be audited

- All write operations (create, update, delete)
- All approval/rejection/change-request actions
- All sync operations (dry-run and apply)
- All agent answer submissions
- All project status changes

### What each audit event must contain

- `actorId` — who performed the action
- `actorType` — agent / operator / admin / service
- `action` — e.g. `project.create`, `section.approve`, `sync.apply`
- `resourceType` — e.g. `project`, `answer`, `sync_run`
- `resourceId` — the affected resource
- `changes` — before/after diff (JSONB)
- `correlationId` — for tracing across requests
- `ipAddress` — client IP (if available)
- `timestamp` — when it happened

### What must NOT be in audit events

- Full phone numbers
- API keys or tokens
- Passwords
- Full PII (IDs are OK, values are not)

---

## 12. Secret Handling Rules

| Rule | Implementation |
|------|---------------|
| Never commit secrets | `.env` and `.env.local` in `.gitignore` |
| Encrypt at rest | GHL tokens encrypted with AES-256-GCM |
| Never return in API | Raw tokens stripped from all responses |
| Never log | Log sanitization strips known secret patterns |
| Rotate on leak | Service tokens and agent tokens can be rotated |
| `ENCRYPTION_KEY` | Exactly 32 UTF-8 chars, never hardcoded |

---

## 13. PII Handling Rules

| Data Type | Storage | API Response | Logs |
|-----------|---------|-------------|------|
| Business name | Plaintext | Full | OK |
| Contact name | Plaintext | Full | OK |
| Phone number | Encrypted | Masked (`+65****1234`) | Never logged |
| Email | Plaintext | Full (operator only) | Redacted |
| GHL location ID | Plaintext | Full (operator only) | OK |
| GHL tokens | Encrypted | Never returned | Never logged |
| Client key | Plaintext | Full | OK |

---

## 14. Phone Masking Rules

- **Default**: Always mask — `+65****1234`
- **Show full**: Only on explicit click-to-reveal (operator only)
- **Format**: `+<countryCode>****<last4>`
- **Storage**: Encrypted at rest in database
- **Logging**: Never logged, even masked
- **No full phone display** in agent API responses, audit logs, or list views

---

## 15. No Direct Production DB Writes

- All writes go through the API layer
- No direct Supabase/Prisma writes from agents or external services
- Service tokens for sync operations only
- DB credentials never exposed outside backend

---

## 16. No Agent Approval

**Code-level enforcement**:
```typescript
// In agent controller — role check on every request
@UseGuards(AgentTokenGuard)
// AgentTokenGuard sets req.user.role = 'agent'

// In approval service
if (actor.role === 'agent') {
  throw new ForbiddenException('Agents cannot approve');
}
```

---

## 17. No Agent Sync Authority

- Agent token cannot access `/integrations/*` endpoints
- Agent token cannot access `/sync/*` endpoints
- Service endpoints validate role explicitly (not just token)

---

## 18. Sync Authorization

Before any sync executes:
1. Validate operator/service role
2. Validate project status === `approved`
3. Validate feature flag enabled
4. Generate idempotency key
5. Check idempotency key doesn't already exist (completed)
6. Write audit event
7. Execute sync
8. Record result

---

## 19. OWASP-Style Concerns

| Concern | Mitigation |
|---------|------------|
| Injection | Parameterized queries (Prisma), input validation (Zod/class-validator) |
| Broken auth | JWT verification on every request, token expiry, scope validation |
| Sensitive data exposure | Phone masking, encrypted storage, no secrets in responses |
| Broken access control | Role-based guards on every endpoint, server-side enforcement |
| Security misconfiguration | Helmet headers, CORS allowlist, rate limiting |
| Insufficient logging | Full audit trail for all writes, correlation IDs |
| Replay attacks | Idempotency keys on sync endpoints, nonce on agent answers |

---

## 20. Least Privilege Summary

```
Agent Token:
  ✅ POST /onboard/agent/sessions
  ✅ POST /onboard/agent/sessions/:id/answers
  ✅ POST /onboard/agent/projects/:id/analysis
  ✅ GET  /onboard/agent/projects/:id/missing-fields
  ✅ POST /onboard/agent/projects/:id/request-review
  ✅ GET  /onboard/agent/projects/:id/status
  ❌ Everything else

Operator JWT:
  ✅ All agent endpoints
  ✅ All operator endpoints
  ❌ Integration settings endpoints (admin only)

Service Token:
  ✅ POST /integrations/onboard/tenants/dry-run
  ✅ POST /integrations/onboard/tenants/sync
  ❌ Everything else
```
