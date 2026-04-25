# Hostinger KVM2 — Docker deploy (frontend + backend + Redis)

Supabase stays **hosted**; this stack runs **Next**, **Nest**, and **Redis** on your VPS.

## Security

- **Never commit** Hostinger API tokens or database passwords to git.
- If a token was pasted anywhere insecure (chat, ticket, screenshot), **revoke it** in hPanel → Profile → [API](https://hpanel.hostinger.com/profile/api) and create a new one.
- Store credentials only in **GitHub Actions secrets** (CI) or a root-owned **`.env` file on the VPS** (manual SSH deploy), never in the repository.

## VPS one-time setup

1. In hPanel, use a **Docker** OS template or install Docker Engine + Compose v2 on the VPS.
2. Open firewall **80 / 443** (and **3000** only if you terminate TLS on the VPS without a reverse proxy).
3. Point your domain **A record** to the VPS IP.
4. Put **TLS in front of Next** (Caddy/nginx) on `127.0.0.1:3000` — see `Caddyfile.example` in this folder.

## Option A — GitHub Actions (`hostinger/deploy-on-vps`)

Hostinger pulls `docker-compose.hostinger.yml` from your repo at the pushed commit and runs it on the VM.

1. **Repository variable** (Settings → Secrets and variables → Actions → *Variables*):

   - `HOSTINGER_VM_ID` — from the VPS URL `.../vps/123456/overview` or hostname `srv123456.hstgr.cloud` → `123456`.

2. **Repository secrets** (Settings → Secrets and variables → Actions → *Secrets*):

   - `HOSTINGER_API_KEY` — new token from hPanel API (after rotating any exposed one).
   - `DATABASE_URL` — Supabase Postgres URI.
   - `SUPABASE_URL`, `SUPABASE_ANON_KEY`, `SUPABASE_SERVICE_ROLE_KEY` — same Supabase project.
   - `JWT_SECRET`, `ENCRYPTION_KEY` — see `apps/backend/.env.example`.
   - `CORS_ORIGIN` — public origin of the Next app, e.g. `https://app.yourdomain.com` (no trailing slash).
   - `NEXT_PUBLIC_SUPABASE_URL`, `NEXT_PUBLIC_SUPABASE_ANON_KEY` — same values as in the browser (used at **image build** time).

3. **Private repo:** add a deploy read key per [Hostinger: private GitHub repo](https://www.hostinger.com/support/how-to-deploy-from-private-github-repository-on-hostinger-docker-manager/).

4. Push to **`main`** or run workflow **Deploy Hostinger VPS** manually.

### Bulk upload with GitHub CLI (local machine)

1. `gh auth login` (repo admin).
2. Copy `infra/vps/.github-secrets.local.env.example` → `infra/vps/.github-secrets.local.env` and fill real values (that file is gitignored).
3. From the repo root run **one** of:

```powershell
pwsh infra/vps/scripts/set-github-secrets.ps1
```

```bash
bash infra/vps/scripts/set-github-secrets.sh
```

The scripts **validate** that every required name is present (they only print **names**, never values), run **`gh auth status`**, show **secrets vs variables** separately, ask you to type **`YES`** before uploading, then list names via **`gh api … --jq`** (so variable **values** are never printed—plain `gh variable list` would show them in a table).

The Bash script needs **bash 4+** (associative arrays). On macOS stock bash 3.x, use PowerShell or `brew install bash`.

The agent environment cannot run `gh` for you; you run the script on your machine.

If the platform does not pass build-time variables correctly, SSH to the VPS and run:

`docker compose -f docker-compose.hostinger.yml --env-file .env.production up -d --build`

from the directory where the compose file lives (synced clone), with a local `.env.production` containing the same keys.

## Option B — SSH only (no GitHub)

```bash
git clone <your-repo> && cd aisbp
cp infra/vps/env.vps.example .env.production
# edit .env.production — use Supabase DATABASE_URL, same keys as localhost prod
docker compose -f docker-compose.hostinger.yml --env-file .env.production up -d --build
```

Use the same variable names as in `env.vps.example`, plus `SUPABASE_ANON_KEY` for the backend.

## Compose file

- Repo root: **`docker-compose.hostinger.yml`** (build `context: .` so the monorepo builds on the server).
- Image definitions: **`infra/vps/Dockerfile`**, **`infra/vps/Dockerfile.frontend`**.

## Railway

Railway-specific config was removed from this repo; use this Hostinger flow or plain Docker on the VPS instead.
