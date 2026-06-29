# KB Local Staging Setup Guide (Phase 1)

This guide explains how to set up an **isolated local staging environment** for
KB (`aisbp`). Staging lets you test future major changes against a **separate
staging Supabase project** before anything touches production.

> **Phase 1 scope:** repo-only scaffolding for *local* staging. There is no
> remote/VPS/DNS staging yet — that is **Phase 2 and is not implemented**.
> Nothing here deploys, migrates, or modifies production.

---

## What you get

| File | Purpose |
| --- | --- |
| `docker-compose.staging.yml` | Isolated local staging stack (`aisbp-staging`) |
| `.env.staging.example` | Template for your local staging secrets |
| `scripts/smoke-staging.sh` | Read-only GET liveness checks |

Local staging uses **non-production ports** so it never clashes with dev or
production:

| Service | Local staging | Dev (existing) |
| --- | --- | --- |
| Frontend | `http://localhost:3002` | `http://localhost:3000` |
| Backend | `http://localhost:3003` | `http://localhost:3001` |
| Redis | `localhost:6380` | `localhost:6379` |

---

## Guardrails (why this is safe)

- **Separate compose project name** (`aisbp-staging`) → isolated containers,
  network, and volumes. It cannot collide with dev (`aisbp-dev`) or production.
- **`env_file: .env.staging` is required.** If that file is missing, the stack
  **refuses to start** — it can never silently fall back to production.
- **No production env files are referenced.** This compose file never reads
  `.env`, `.env.local`, or `.env.production`.
- **Database is fail-closed.** The compose file does not read `DATABASE_URL`
  from your shell. It uses your staging value (`STAGING_DATABASE_URL` in
  `.env.staging`); if that is unset it falls back to an **invalid local DSN**, so
  a misconfigured run cannot reach a real or production database.
- **`QUEUE_PREFIX=staging` and `NODE_ENV=staging`** are pinned, keeping queues
  and runtime behavior separate from production (`aisbp`).

---

## Step 1 — Create a staging Supabase project

1. In the Supabase dashboard, create a **new project** dedicated to staging
   (do not reuse the production project).
2. From that staging project, note its URL and keys (anon key, service role
   key) and its Postgres connection string.

> **Never** point staging at the production database, production Supabase, or
> production keys.

## Step 2 — Create your local `.env.staging`

```bash
cp .env.staging.example .env.staging
```

Open `.env.staging` and fill in **staging-only** values from Step 1.

> **Security:**
> - `.env.staging` is git-ignored — **never commit it**.
> - **Never paste real secrets into ChatGPT, chat, issues, or PRs.** Type them
>   directly into your local `.env.staging` file only.
> - Generate **fresh** staging secrets (JWT, encryption key, webhook secret).
>   Do not reuse production secrets.

## Step 3 — Validate the staging compose file

This checks the file is well-formed without starting anything:

```bash
pnpm staging:config
# or: docker compose -f docker-compose.staging.yml config
```

## Step 4 — Run the local staging stack

> Note: in Phase 1 the application container images are not wired up yet (no
> Dockerfiles committed). Use `pnpm staging:config` to validate the scaffold.
> Once images are added in a later phase, start/stop with:

```bash
pnpm staging:up      # start in the background
pnpm staging:down    # stop and remove the staging stack
```

## Step 5 — Run the smoke check (read-only)

After the stack is up, verify liveness with **read-only GET** probes:

```bash
pnpm staging:smoke
# or: bash scripts/smoke-staging.sh
```

Expected results:

- Frontend `/` → `200`, `301`, `302`, or `307`.
- Backend `/api/v1/auth/me` → `401`. **A 401 here is good** — it proves the
  backend is running and its auth guard is active, with no credentials sent.

The smoke script never mutates data, never sends messages, and never uses any
secrets. If a probe shows "not reachable", the stack is not running.

---

## What is NOT included (Phase 2)

- Remote staging on a VPS.
- DNS / reverse-proxy configuration for a staging hostname.
- Any deploy, migration, or CI workflow changes.

These are intentionally out of scope for Phase 1 and will be addressed
separately once local staging is proven.
