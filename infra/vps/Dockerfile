# Build from repository root: docker compose -f infra/vps/docker-compose.yml build
# syntax=docker/dockerfile:1

FROM node:20-bookworm-slim AS base
RUN apt-get update \
  && apt-get install -y --no-install-recommends openssl ca-certificates \
  && rm -rf /var/lib/apt/lists/*
RUN corepack enable && corepack prepare pnpm@9.0.0 --activate

FROM base AS build
WORKDIR /app
COPY package.json pnpm-lock.yaml pnpm-workspace.yaml ./
COPY turbo.json ./
COPY apps ./apps
COPY packages ./packages
RUN pnpm install --frozen-lockfile
# @prisma/client must exist before tsc can compile @aisbp/db (backend tsconfig references it).
RUN pnpm --filter @aisbp/backend exec prisma generate
# Nest uses TS project references (apps/backend/tsconfig.json → packages/*). Those packages
# have no "build" script, so `pnpm --filter @aisbp/backend... run build` would skip them and
# TS6305 fails. Emit their dist/ first, then the backend.
RUN pnpm --filter @aisbp/types exec tsc -b \
  && pnpm --filter @aisbp/db exec tsc -b \
  && pnpm --filter @aisbp/formatter exec tsc -b \
  && pnpm --filter @aisbp/ghl-client exec tsc -b \
  && pnpm --filter @aisbp/ai-router exec tsc -b \
  && pnpm --filter @aisbp/ai-provider-openai exec tsc -b
RUN pnpm --filter @aisbp/backend run build

FROM base AS runner
WORKDIR /app
ENV NODE_ENV=production
COPY --from=build /app /app
COPY infra/vps/docker-entrypoint.sh /docker-entrypoint.sh
RUN chmod +x /docker-entrypoint.sh
WORKDIR /app/apps/backend
EXPOSE 3001
ENTRYPOINT ["/docker-entrypoint.sh"]
