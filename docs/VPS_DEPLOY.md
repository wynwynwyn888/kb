# VPS Deploy (Hostinger)

This repo is deployed on a VPS using Docker Compose. **Use the commands below exactly** to ensure Compose interpolation loads production environment variables.

## Deploy backend (Hostinger)

```bash
cd ~/aisbp
git fetch origin main
git reset --hard origin/main

COMPOSE_FILE="./docker-compose.hostinger.yml"
ENV_FILE="./.env.production"

docker compose --env-file "$ENV_FILE" -f "$COMPOSE_FILE" build --no-cache backend
docker compose --env-file "$ENV_FILE" -f "$COMPOSE_FILE" up -d --force-recreate --no-deps backend

docker ps --filter "name=aisbp-backend"
docker logs aisbp-backend-1 --tail=150
```

## Warning: don’t use plain `docker compose up -d --build backend`

**Do not run** `docker compose up -d --build backend` on the VPS for this project.

Docker Compose interpolation will **not** load `./.env.production` automatically in this setup. If env interpolation runs with missing variables, **`DATABASE_URL` may become blank**, which can break the backend at runtime.

