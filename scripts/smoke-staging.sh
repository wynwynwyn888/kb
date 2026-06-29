#!/usr/bin/env bash
# =============================================================================
# smoke-staging.sh  —  KB (aisbp) LOCAL staging smoke check
# =============================================================================
#
# READ-ONLY by design. This script only performs HTTP GET liveness probes
# against the LOCAL staging stack. It never mutates data, never sends messages,
# never calls GHL, and never uses any auth secrets.
#
# Targets (local staging ports only):
#   * Frontend : http://localhost:3002
#   * Backend  : http://localhost:3003  (API prefix: /api/v1)
#
# Expected statuses (documented per endpoint below):
#   * Frontend "/"            -> 200 / 301 / 302 / 307  (page served / redirect)
#   * Backend  "/api/v1/auth/me" -> 401                 (server up; auth guard active,
#                                                         no token supplied — this is
#                                                         the safe liveness signal)
#
# A 401 from a guarded endpoint is GOOD here: it proves the backend is running
# and its auth guard works, without any credentials. Connection refused (000)
# means the stack is not running — start it first (see docs/staging-setup-guide.md).
#
# Usage:
#   bash scripts/smoke-staging.sh
#   FRONTEND_URL=http://localhost:3002 BACKEND_URL=http://localhost:3003 \
#     bash scripts/smoke-staging.sh
# =============================================================================

set -uo pipefail

FRONTEND_URL="${FRONTEND_URL:-http://localhost:3002}"
BACKEND_URL="${BACKEND_URL:-http://localhost:3003}"

PASS_COUNT=0
FAIL_COUNT=0

# probe <name> <url> <space-separated-accepted-codes>
probe() {
  local name="$1" url="$2" accepted="$3" code
  # --get + no body: GET only, read-only. Never follow into auth, never mutate.
  code="$(curl --silent --show-error --get \
            --max-time 5 \
            --output /dev/null \
            --write-out '%{http_code}' \
            "$url" 2>/dev/null || true)"

  if [ -z "$code" ] || [ "$code" = "000" ]; then
    printf '  [FAIL] %-32s %-40s not reachable (stack not running?)\n' "$name" "$url"
    FAIL_COUNT=$((FAIL_COUNT + 1))
    return
  fi

  for ok in $accepted; do
    if [ "$code" = "$ok" ]; then
      printf '  [PASS] %-32s %-40s -> %s\n' "$name" "$url" "$code"
      PASS_COUNT=$((PASS_COUNT + 1))
      return
    fi
  done

  printf '  [FAIL] %-32s %-40s -> %s (expected: %s)\n' "$name" "$url" "$code" "$accepted"
  FAIL_COUNT=$((FAIL_COUNT + 1))
}

echo "KB local staging smoke check (read-only GET probes)"
echo "Frontend: $FRONTEND_URL"
echo "Backend : $BACKEND_URL"
echo

probe "frontend-root"     "$FRONTEND_URL/"               "200 301 302 307"
probe "backend-auth-guard" "$BACKEND_URL/api/v1/auth/me" "401"

echo
echo "Summary: $PASS_COUNT passed, $FAIL_COUNT failed"

if [ "$FAIL_COUNT" -ne 0 ]; then
  exit 1
fi
exit 0
