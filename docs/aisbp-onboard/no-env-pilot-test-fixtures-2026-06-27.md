# AISBP-Onboard No-Env Pilot Test Fixtures — 2026-06-27

> **Status**: Fixtures and test harness only. No real env, no secrets, no backend/frontend startup.
> **Purpose**: Prepare fake pilot data, sample payloads, and verify everything that can be verified without a running environment.

---

## 1. What Can Be Verified Without Env

### Static Code Checks (No DB/Redis/Supabase Required)

| Check | Command | Status |
|-------|---------|--------|
| Backend TypeScript | `pnpm --filter @aisbp/backend typecheck` | ✓ |
| Frontend TypeScript | `pnpm --filter @aisbp/onboard typecheck` | ✓ |
| Backend unit tests | `pnpm --filter @aisbp/backend test` | ✓ (1134 tests) |
| Mapper tests | `pnpm --filter @aisbp/backend test -- onboard-kb-sync.mapper` | ✓ (19 tests) |
| Prisma validate | `DATABASE_URL=... prisma validate` | ✓ (needs dummy URL) |
| Prisma format | `DATABASE_URL=... prisma format` | ✓ |
| Frontend lint | `pnpm --filter @aisbp/onboard lint` | ✓ (0 warnings) |
| Frontend build | `pnpm --filter @aisbp/onboard build` | ✓ (9 routes) |

### Code Safety Checks (No Runtime Required)

| Check | Verified By |
|-------|------------|
| No GHL mutation code | `grep -rn "ghl.*apply\|createGhl\|updateGhl" apps/backend/src/modules/onboard/` returns empty |
| No message sending path | `grep -rn "sendMessage\|sms\|email.*send" apps/backend/src/modules/onboard/` returns only safety assertions |
| No outbound activation | `grep -rn "outbound.*true\|enableOutbound" apps/backend/src/modules/onboard/` returns empty |
| Bot profile inactive | Hardcoded `setActive: false` |
| Booking/handover/follow-up disabled | Hardcoded `enabled: false` |
| Agent cannot approve | Agent controller has no approval endpoints |
| Agent cannot sync | Agent controller has no sync endpoints |
| Guard separation | AgentTokenGuard ≠ JwtAuthGuard + OnboardOperatorGuard |

### Fixture Safety

| Check | Status |
|-------|--------|
| No real customer names | ✓ — all "Pilot Test Business", "Test Owner" |
| No real phone numbers | ✓ — `+6500001111` (test prefix), `+65****1111` (masked) |
| No real emails | ✓ — `test@example.com` |
| No real GHL IDs | ✓ — `ghl12345`, UUID test patterns |
| No real Supabase IDs | ✓ — all-zero or all-repeated-character UUIDs |
| No secrets/tokens | ✓ — no API keys, tokens, passwords |

---

## 2. What Cannot Be Verified Without Env

| Check | Requires |
|-------|----------|
| Real login / Supabase Auth | `NEXT_PUBLIC_SUPABASE_URL` + keys |
| Database writes | `DATABASE_URL` pointing to running Postgres |
| Migration execution | Running Postgres + `prisma migrate deploy` |
| Backend startup | `.env` with all required vars |
| Frontend login | Supabase project + operator account |
| End-to-end API calls | Backend running + agent/operator tokens |
| sync_runs persistence | Running DB |
| audit_events persistence | Running DB |

---

## 3. Sample Pilot Flow (No-Env Reference)

This is the exact flow that would be tested in a running environment:

### Phase A: Client/Project Creation

```
POST /api/v1/onboard/clients
  → clientKey: pilot-test
  → displayName: Pilot Test Business

POST /api/v1/onboard/projects
  → onboardClientId: <from client creation>
  → status: DRAFT
```

### Phase B: Agent Intake

```
POST /api/v1/onboard/agent/sessions
  → Creates session, returns sessionId

POST /api/v1/onboard/agent/sessions/:id/answers
  → Submits 5 answers (business profile, prompt, FAQ)

POST /api/v1/onboard/agent/projects/:id/analysis
  → Submits workflow analysis + 2 recommendations

POST /api/v1/onboard/agent/projects/:id/request-review
  → Sets project to SUBMITTED

Agent CANNOT call:
  POST /onboard/projects/:id/sections/:name/approve  → 401/403
  POST /onboard/projects/:id/sync/kb/dry-run        → 401/403
  POST /onboard/projects/:id/sync/kb/apply          → 401/403
```

### Phase C: Operator Review

```
POST /api/v1/onboard/projects/:id/sections/business_profile/approve  → APPROVED
POST /api/v1/onboard/projects/:id/sections/prompt/approve            → APPROVED
POST /api/v1/onboard/projects/:id/approve                            → Status = APPROVED
```

### Phase D: KB Dry-Run

```
POST /api/v1/onboard/projects/:id/sync/kb/dry-run
  → DRY_RUN_PASSED with sourceSnapshotHash
  → No KB mutation
```

### Phase E: KB Apply (Requires ONBOARD_KB_SYNC_ENABLED=true)

```
With flag false: 400 "ONBOARD_KB_SYNC_ENABLED is not enabled"
With flag true:  Tenant created, identity map updated
All other phases skipped (bot profile, FAQ, booking, handover, follow-up)
```

### Phase F: GHL Validation/Dry-Run

```
POST /api/v1/onboard/projects/:id/sync/ghl/validate  → No GHL API calls
POST /api/v1/onboard/projects/:id/sync/ghl/dry-run   → All ops disabled
```

---

## 4. Fixture Files Created

| File | Contents |
|------|----------|
| `__fixtures__/pilot-client.fixture.ts` | Client, project, answers, analysis, approval fixtures |
| `__fixtures__/agent-intake.fixture.ts` | Agent API request/response samples |
| `__fixtures__/kb-sync.fixture.ts` | KB dry-run/apply response samples |
| `__fixtures__/ghl-validation.fixture.ts` | GHL validate/dry-run response samples |

All fixtures use fake data only:
- Client: `pilot-test`, `Pilot Test Business`, `+6500001111` → masked `+65****1111`
- Email: `test@example.com`
- UUIDs: all-zero or repeated-character test patterns
- No real GHL IDs, no real Supabase IDs, no tokens, no secrets

---

## 5. Recommended Next Step

When Wyn is ready to set up the environment:

1. Follow `docs/aisbp-onboard/local-staging-env-setup-2026-06-27.md` (PR 17A)
2. Create `.env` files with real values
3. Start Redis, backend, frontend
4. Apply migration to safe DB
5. Execute the pilot flow using these fixtures as reference data
6. Record results in a new execution report doc
