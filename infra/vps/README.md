# Self-host on a VPS (Docker): Next.js + Nest + Redis

**Hostinger KVM2 + GitHub:** see [HOSTINGER.md](./HOSTINGER.md).

**Postgres and Supabase Auth** stay on [hosted Supabase](https://supabase.com/dashboard). This stack runs:

- **Redis** — queues (BullMQ)
- **Nest API** — internal port 3001 on the Docker network only
- **Next.js** — published on the host (default `3000`); `/api/v1` BFF proxies to Nest

## Prerequisites

- Docker Engine + Compose v2
- Supabase project: **Database** connection string + **API** URL and keys (`NEXT_PUBLIC_*` must match the same project the browser uses)

## Configure

```bash
cp infra/vps/env.vps.example infra/vps/.env
```

Edit `infra/vps/.env`:

1. **`DATABASE_URL`** — Supabase Postgres URI (often the pooler on port `6543` with `?pgbouncer=true` for Prisma; follow [Supabase + Prisma](https://supabase.com/docs/guides/database/connecting-to-postgres) if you use `migrate` or direct `5432`).
2. **`SUPABASE_*`** and **`NEXT_PUBLIC_SUPABASE_*`** — same project; anon key is safe in the browser bundle.
3. **`CORS_ORIGIN`** — your public site origin, e.g. `https://app.example.com` (must match how users open the Next app).
4. **`JWT_SECRET`**, **`ENCRYPTION_KEY`** — see `apps/backend/.env.example`.

## Run (from repository root)

```bash
docker compose -f infra/vps/docker-compose.yml up -d --build
```

The API container runs `prisma migrate deploy` on start, then `node dist/main.js`. Use `SKIP_PRISMA_MIGRATE=1` in `.env` only for debugging.

**Rebuild the frontend image** whenever you change `NEXT_PUBLIC_*` (those values are fixed at `docker compose build` time).

## HTTPS / reverse proxy

Expose only the **frontend** port to the internet (default `127.0.0.1:3000` or bind `3000` on the host). Terminate TLS with Caddy or nginx. Example [Caddy](https://caddyserver.com/):

```text
app.example.com {
  reverse_proxy 127.0.0.1:3000
}
```

Swagger `/docs` is proxied by Next (see `apps/frontend/next.config.js` rewrites).

## Optional: expose Nest on the host

By default only Next is published (`FRONTEND_PUBLISH_PORT`). To reach the API directly (e.g. mobile or `curl` to `:3001`), add under `backend`:

```yaml
    ports:
      - '3001:3001'
```

Keep **`CORS_ORIGIN`** aligned with the browser origin that calls the API.

## Prisma + Supabase pooler

If `prisma migrate deploy` fails through the pooler, use Supabase’s **direct** Postgres URI for `DATABASE_URL` during migrations, or add a `directUrl` in Prisma per [Supabase docs](https://supabase.com/docs/guides/database/connecting-to-postgres#prisma).

## API-only variant

To run **only the Nest container** (Next hosted elsewhere; Redis not in this compose file), use `docker-compose.api-only.yml` and set `REDIS_HOST`, `DATABASE_URL`, and Supabase vars in `.env`.

## GHL production smoke test (manual)

To POST a realistic **inbound webhook** and validate the **SMS outbound** path (no app deploy required), use:

- `infra/vps/scripts/smoke-ghl-webhook.ps1`
- `infra/vps/scripts/smoke-ghl-webhook.sh` (requires `jq`)

Full steps, log sequence, and failure table: **[docs/AISBP_PRODUCTION_SMOKE_TEST.md](../docs/AISBP_PRODUCTION_SMOKE_TEST.md)**.
