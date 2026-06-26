# AISBP-Onboard — Dependencies & Config Files Review

## 1. Onboard Project Dependencies

**Project**: `apps/onboard/` (inside KB monorepo, isolated Next.js app)

The Onboard frontend is a Next.js app within the monorepo. It calls the KB backend via HTTP API. It does NOT use Prisma directly — all DB access goes through the backend Onboard module.

### Core Dependencies (to install)

| Dependency | Purpose |
|------------|---------|
| `next` | Framework (match existing KB version) |
| `react` / `react-dom` | UI (match existing KB version) |
| `@supabase/supabase-js` | Auth client (same project as KB) |
| `zod` | Schema validation |
| `react-hook-form` | Form handling |
| `@hookform/resolvers` | Zod resolver for react-hook-form |
| `swr` or `@tanstack/react-query` | Data fetching with cache |
| `tailwindcss` | Styling |
| `typescript` (dev) | Type safety |
| `vitest` (dev) | Unit tests |
| `@playwright/test` (dev) | E2E tests |
| `eslint` (dev) | Linting |

### Dependencies to Avoid

| Dependency | Reason |
|------------|--------|
| `@prisma/client` | Frontend never talks to DB directly — backend handles all DB access |
| `prisma` | Migrations run from `apps/backend/`, not from `apps/onboard/` |
| `better-sqlite3` | Onboard uses Supabase Postgres via backend, not local SQLite |
| `bcryptjs` | Auth via Supabase, no local password hashing |
| `iron-session` | Auth via Supabase JWT, not cookie sessions |
| `cheerio` | Not needed for onboarding |
| `@aisbp/db` | Do not import — backend handles DB, frontend calls API |

---

## 2. KB Monorepo Dependencies (reference only)

The KB monorepo at `~/Projects/KB/kb-explore/` uses pnpm workspaces with Turbo. Onboard references it for API contracts and patterns, not for code imports.

---

## 2. Backend `package.json`

**File**: `/Users/wyn/Projects/KB/kb-explore/apps/backend/package.json`
**Package**: `@aisbp/backend`

### Dependencies Onboard Can Likely Reuse

| Dependency | Version | Used In Onboard? |
|------------|---------|-------------------|
| `@nestjs/common` | `^10.3.0` | Yes — NestJS module |
| `@nestjs/core` | `^10.3.0` | Yes — NestJS module |
| `@nestjs/config` | `^3.2.0` | Yes — env config |
| `@nestjs/jwt` | `^10.2.0` | Yes — JWT auth (agent tokens) |
| `@nestjs/passport` | `^10.0.3` | Yes — auth guards |
| `@nestjs/swagger` | `^7.3.0` | Yes — API docs |
| `@nestjs/throttler` | `^5.1.0` | Yes — rate limiting |
| `@prisma/client` | `^5.14.0` | Yes — DB access |
| `@aisbp/db` | `workspace:*` | Yes — Prisma singleton |
| `@aisbp/types` | `workspace:*` | Yes — shared types |
| `@aisbp/ghl-client` | `workspace:*` | Yes — GHL sync |
| `class-validator` | `^0.14.1` | Yes — DTO validation |
| `class-transformer` | `^0.5.1` | Yes — DTO transform |
| `zod` | `^3.23.8` | Yes — schema validation |
| `helmet` | `^8.2.0` | Yes — HTTP security headers |
| `ioredis` | `^5.3.0` | Future — queue for async sync |
| `bullmq` | `^5.4.0` | Future — queue for async sync |
| `@nestjs/bullmq` | `^10.2.0` | Future — NestJS BullMQ integration |

### Dependencies to Avoid Adding to Onboard

| Dependency | Reason |
|------------|--------|
| `@aisbp/ai-router` | Not needed — Onboard doesn't do AI routing |
| `@aisbp/ai-provider-openai` | Not needed — Onboard doesn't call AI directly |
| `@aisbp/formatter` | Not needed — Onboard doesn't format messages |
| `passport` / `passport-jwt` | Already available via NestJS module |
| `@supabase/supabase-js` | Already available via `@aisbp/db` |

### Dev Dependencies Pattern

```json
{
  "@aisbp/tsconfig": "workspace:*",
  "@jest/globals": "^29.7.0",
  "@nestjs/cli": "^10.3.0",
  "@types/jest": "^29.5.12",
  "@types/node": "^20.11.0",
  "eslint": "^8.57.0",
  "jest": "^29.7.0",
  "prisma": "^5.14.0",
  "ts-jest": "^29.1.2",
  "tsx": "^4.7.0",
  "typescript": "^5.4.0"
}
```

---

## 3. Frontend `package.json`

**File**: `/Users/wyn/Projects/KB/kb-explore/apps/frontend/package.json`
**Package**: `@aisbp/frontend`

### Dependencies Onboard Frontend Can Reuse

| Dependency | Version | Used In Onboard? |
|------------|---------|-------------------|
| `next` | `^14.2.0` | Yes — same framework |
| `react` / `react-dom` | `^18.3.0` | Yes |
| `@supabase/supabase-js` | `^2.43.0` | Yes — auth client |
| `@aisbp/types` | `workspace:*` | Yes — shared types |
| `@aisbp/tsconfig` | `workspace:*` | Yes — base tsconfig |

### Additional Dependencies Likely Needed for Onboard Frontend

| Dependency | Purpose |
|------------|---------|
| `react-hook-form` | Form handling (client setup, review forms) |
| `@hookform/resolvers` | Zod resolver for react-hook-form |
| `swr` or `@tanstack/react-query` | Data fetching with cache |

---

## 4. Lock File

**File**: `/Users/wyn/Projects/KB/kb-explore/pnpm-lock.yaml`

- Managed by pnpm
- Updated automatically on `pnpm install`
- Ensure consistent Node version (>=20) across all environments

---

## 5. Env Example Files

### Backend `.env.example`

**File**: `/Users/wyn/Projects/KB/kb-explore/apps/backend/.env.example` (150 lines)

Key patterns:
- `DATABASE_URL` — Postgres connection string
- `SUPABASE_URL`, `SUPABASE_ANON_KEY`, `SUPABASE_SERVICE_ROLE_KEY` — Supabase config
- `REDIS_HOST`, `REDIS_PORT` — Redis config for BullMQ
- `JWT_SECRET`, `JWT_EXPIRES_IN` — JWT signing
- `WEBHOOK_SIGNATURE_SECRET` — Webhook auth
- `ENCRYPTION_KEY` — AES-256-GCM encryption (exactly 32 chars)
- `GHL_API_BASE_URL`, `GHL_CLIENT_ID`, `GHL_CLIENT_SECRET` — GHL integration
- `CORS_ORIGIN` — CORS allowlist
- Feature flags: `GHL_VOICE_*`, `ALLOW_BOOKING_PROBE`, `AUTH_REQUIRE_PROFILE`

### Frontend `.env.example`

**File**: `/Users/wyn/Projects/KB/kb-explore/apps/frontend/.env.example` (20 lines)

Key patterns:
- `NEXT_PUBLIC_SUPABASE_URL`, `NEXT_PUBLIC_SUPABASE_ANON_KEY` — Browser Supabase
- `NEXT_PUBLIC_APP_URL` — App origin
- `BACKEND_URL`, `BACKEND_DEV_URL` — Server-side proxy target
- `NEXT_PUBLIC_APP_TIMEZONE` — Timezone

---

## 6. Docker / Infra Files

| File | Purpose |
|------|---------|
| `docker-compose.redis.yml` | Local Redis for dev |
| `docker-compose.hostinger.yml` | Production deploy compose |
| `infra/vps/docker-compose.yml` | VPS full stack |
| `infra/vps/Dockerfile` | Backend Docker image |
| `infra/vps/Dockerfile.frontend` | Frontend Docker image |
| `infra/vps/Caddyfile.example` | Reverse proxy (Caddy) |
| `infra/vps/env.vps.example` | VPS env template |

Onboard will need its own Dockerfile and compose entry when deployed.

---

## 7. Framework Versions Summary

| Framework | Version |
|-----------|---------|
| Node.js | >=20 |
| pnpm | >=9.0.0 |
| TypeScript | ^5.4.0 |
| Next.js | ^14.2.0 |
| React | ^18.3.0 |
| NestJS | ^10.3.0 |
| Prisma | ^5.14.0 |
| Supabase JS | ^2.43.0 |
| BullMQ | ^5.4.0 |
| Redis (ioredis) | ^5.3.0 |
| Jest | ^29.7.0 |
| Vitest | ^2.1.0 |
| Playwright | ^1.49.1 |
| Turbo | ^2.0.0 |

---

## 8. Build / Lint / Test Commands

| Command | Scope | Runner |
|---------|-------|--------|
| `pnpm dev` | All apps | Turbo |
| `pnpm build` | All apps | Turbo |
| `pnpm lint` | All apps | Turbo |
| `pnpm typecheck` | All apps | Turbo |
| `pnpm test` | All apps | Turbo |
| `pnpm --filter @aisbp/backend test` | Backend | Jest |
| `pnpm --filter @aisbp/frontend test` | Frontend | Vitest |
| `pnpm --filter @aisbp/frontend test:e2e` | Frontend E2E | Playwright |
| `pnpm --filter @aisbp/backend db:generate` | Prisma generate | Prisma CLI |
| `pnpm --filter @aisbp/backend db:migrate` | Prisma migrate | Prisma CLI |

---

## 9. Env/Config Patterns to Follow

1. **`.env.example` for every app** — all vars documented, secrets marked
2. **`NEXT_PUBLIC_*` prefix** for browser-accessible vars
3. **Secrets never committed** — `.env` and `.env.local` in `.gitignore`
4. **Feature flags with safe defaults** — `ENABLED` flags default to `false`
5. **`ENCRYPTION_KEY`** — exactly 32 UTF-8 chars for AES-256-GCM
6. **Workspace imports** — use `workspace:*` for shared packages

---

## 10. Possible Future Dependencies (Only If Justified)

| Dependency | Purpose | When |
|------------|---------|------|
| `@nestjs/schedule` | Cron for periodic health checks | Post-MVP |
| `nodemailer` | Email notifications | If email needed |
| `twilio` | WhatsApp notifications | If WhatsApp API direct needed |
| `@nestjs/axios` | HTTP client for NestJS | If sync needs external API calls |
| `pino` / `pino-pretty` | Structured logging | If existing logging insufficient |
