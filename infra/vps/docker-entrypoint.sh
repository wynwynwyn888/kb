#!/bin/sh
set -e
cd /app/apps/backend
if [ "${SKIP_PRISMA_MIGRATE:-}" != "1" ]; then
  npx prisma migrate deploy
fi
exec node dist/main.js
