# AISBP-Onboard — Environment Variable Checklist

> **Important**: No real secrets should be committed. External notifications should default off. GHL apply sync should default off until explicitly approved.

---

## Core

| Variable | Purpose | Dev | Staging | Prod | Secret | Safe Default | Notes |
|----------|---------|-----|---------|------|--------|-------------|-------|
| `ONBOARD_APP_URL` | Frontend app URL | Required | Required | Required | No | `http://localhost:3002` | Set to `https://onboard.aisalesbot.pro` in production |
| `ONBOARD_API_BASE_URL` | Backend API base | Optional | Optional | Required | No | `http://localhost:3001/api/v1` | Same as KB backend |
| `ONBOARD_ENV` | Environment | Required | Required | Required | No | `development` | `development`, `staging`, `production` |

---

## Database

| Variable | Purpose | Dev | Staging | Prod | Secret | Safe Default | Notes |
|----------|---------|-----|---------|------|--------|-------------|-------|
| `DATABASE_URL` | Postgres connection | Required | Required | Required | **Yes** | — | Same as existing KB backend. Reuse existing Supabase DB. |
| `ONBOARD_DATABASE_URL` | Dedicated Onboard DB (if separate) | Optional | Optional | Optional | **Yes** | Same as `DATABASE_URL` | Only needed if Onboard uses separate DB |

---

## Auth

| Variable | Purpose | Dev | Staging | Prod | Secret | Safe Default | Notes |
|----------|---------|-----|---------|------|--------|-------------|-------|
| `ONBOARD_SESSION_SECRET` | Session encryption | Required | Required | Required | **Yes** | — | Generate with `openssl rand -hex 32` |
| `ONBOARD_JWT_SECRET` | JWT signing key | Required | Required | Required | **Yes** | — | Can reuse existing `JWT_SECRET` from KB backend |
| `ONBOARD_ADMIN_EMAILS` | Comma-separated admin emails | Required | Required | Required | No | — | e.g. `wyn@aisalesbot.pro` |
| `ONBOARD_SERVICE_TOKEN_SECRET` | Service-to-service auth secret | Required | Required | Required | **Yes** | — | For sync worker and internal API calls |

---

## Agent

| Variable | Purpose | Dev | Staging | Prod | Secret | Safe Default | Notes |
|----------|---------|-----|---------|------|--------|-------------|-------|
| `ONBOARD_AGENT_API_TOKEN` | API token for AI agent | Required | Required | Required | **Yes** | — | The WhatsApp AI agent uses this to call Onboard API |
| `ONBOARD_AGENT_RATE_LIMIT_PER_MINUTE` | Agent rate limit | Optional | Optional | Optional | No | `30` | Prevents agent from flooding API |

---

## KB Integration

| Variable | Purpose | Dev | Staging | Prod | Secret | Safe Default | Notes |
|----------|---------|-----|---------|------|--------|-------------|-------|
| `KB_INTEGRATION_BASE_URL` | KB backend URL for sync | Optional | Required | Required | No | `http://localhost:3001` | KB NestJS API. Same server in production, explicit URL for clarity. |
| `KB_ONBOARD_INTEGRATION_TOKEN` | Service token for KB API | Required | Required | Required | **Yes** | — | KB validates this token on integration endpoints |
| `KB_ONBOARD_WEBHOOK_SECRET` | Webhook signing secret (future) | Optional | Optional | Optional | **Yes** | — | Only if KB pushes events back to Onboard |

---

## GHL

| Variable | Purpose | Dev | Staging | Prod | Secret | Safe Default | Notes |
|----------|---------|-----|---------|------|--------|-------------|-------|
| `GHL_INTEGRATION_MODE` | GHL sync mode | Required | Required | Required | No | `dry_run` | `dry_run`, `apply`. Must be `dry_run` until explicitly approved. |
| `GHL_API_BASE_URL` | GHL API base | Required | Required | Required | No | `https://services.leadconnectorhq.com` | Same as existing KB backend |
| `GHL_PRIVATE_INTEGRATION_TOKEN` | GHL API token (future) | Optional | Optional | Optional | **Yes** | — | Only needed when GHL apply sync is enabled |

---

## Notifications

| Variable | Purpose | Dev | Staging | Prod | Secret | Safe Default | Notes |
|----------|---------|-----|---------|------|--------|-------------|-------|
| `WYN_NOTIFY_CHANNEL` | Notification channel | Optional | Optional | Optional | No | `none` | `none`, `whatsapp`, `email`, `in_app` |
| `WYN_WHATSAPP_PHONE_MASKED` | Wyn's WhatsApp for notifications | Optional | Optional | Optional | **Yes** | — | Only set if WhatsApp notifications enabled |
| `WYN_NOTIFICATION_TOKEN` | Notification service token | Optional | Optional | Optional | **Yes** | — | Future requirement |

---

## Queue / Redis

| Variable | Purpose | Dev | Staging | Prod | Secret | Safe Default | Notes |
|----------|---------|-----|---------|------|--------|-------------|-------|
| `REDIS_HOST` | Redis host | Required | Required | Required | No | `localhost` | Reuse existing Redis if same server |
| `REDIS_PORT` | Redis port | Optional | Optional | Optional | No | `6379` | |
| `REDIS_PASSWORD` | Redis password | Optional | Optional | Optional | **Yes** | — | |
| `ONBOARD_REDIS_URL` | Full Redis URL (if separate) | Optional | Optional | Optional | **Yes** | — | Only if Onboard uses separate Redis |
| `ONBOARD_QUEUE_PREFIX` | BullMQ queue prefix | Optional | Optional | Optional | No | `onboard` | Prevents collision with KB's `aisbp` prefix |

---

## Audit / Metrics

| Variable | Purpose | Dev | Staging | Prod | Secret | Safe Default | Notes |
|----------|---------|-----|---------|------|--------|-------------|-------|
| `ONBOARD_AUDIT_ENABLED` | Enable audit logging | Optional | Optional | Required | No | `true` | Should always be true in production |
| `ONBOARD_METRICS_ENABLED` | Enable metrics events | Optional | Optional | Optional | No | `true` | Fire-and-forget, non-blocking |

---

## Feature Flags

| Variable | Purpose | Dev | Staging | Prod | Secret | Safe Default | Notes |
|----------|---------|-----|---------|------|--------|-------------|-------|
| `ONBOARD_AGENT_INTAKE_ENABLED` | Allow agent API calls | Required | Required | Required | No | `true` | Disable to block all agent input |
| `ONBOARD_KB_SYNC_ENABLED` | Allow KB sync operations | Required | Required | Required | No | `false` | Set to `true` after dry-run verified in staging |
| `ONBOARD_GHL_SYNC_ENABLED` | Allow GHL sync operations | Required | Required | Required | No | `false` | Must stay `false` until explicitly approved |
| `ONBOARD_EXTERNAL_NOTIFICATIONS_ENABLED` | Allow external notifications | Optional | Optional | Required | No | `false` | Set to `true` only when notification channel configured |

---

## Supabase (Reuse from KB)

| Variable | Purpose | Dev | Staging | Prod | Secret | Safe Default | Notes |
|----------|---------|-----|---------|------|--------|-------------|-------|
| `NEXT_PUBLIC_SUPABASE_URL` | Supabase project URL | Required | Required | Required | No | — | Same as existing KB frontend |
| `NEXT_PUBLIC_SUPABASE_ANON_KEY` | Supabase anon key | Required | Required | Required | **Yes** | — | Same as existing KB frontend |
| `SUPABASE_SERVICE_ROLE_KEY` | Supabase service role | Required | Required | Required | **Yes** | — | For server-side operations (backend only) |

---

## Quick Setup (Dev)

```bash
# Core
export ONBOARD_APP_URL="http://localhost:3002"
export ONBOARD_ENV="development"

# Database (reuse existing)
export DATABASE_URL="postgresql://..."

# Auth (generate new or reuse)
export ONBOARD_SESSION_SECRET="$(openssl rand -hex 32)"
export ONBOARD_JWT_SECRET="$(openssl rand -hex 32)"
export ONBOARD_ADMIN_EMAILS="admin@example.com"
export ONBOARD_SERVICE_TOKEN_SECRET="$(openssl rand -hex 32)"

# Agent
export ONBOARD_AGENT_API_TOKEN="$(openssl rand -hex 32)"

# KB Integration (same server)
export KB_INTEGRATION_BASE_URL="http://localhost:3001"
export KB_ONBOARD_INTEGRATION_TOKEN="$(openssl rand -hex 32)"

# Feature flags (safe defaults)
export ONBOARD_AGENT_INTAKE_ENABLED="true"
export ONBOARD_KB_SYNC_ENABLED="false"
export ONBOARD_GHL_SYNC_ENABLED="false"
export ONBOARD_EXTERNAL_NOTIFICATIONS_ENABLED="false"
```
