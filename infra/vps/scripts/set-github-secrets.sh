#!/usr/bin/env bash
# Upload Hostinger deploy secrets + VM variable to GitHub (gh CLI).
# Validates required keys, checks gh auth, asks for YES confirmation.
# Never prints secret values or variable values.
#
#   cp infra/vps/.github-secrets.local.env.example infra/vps/.github-secrets.local.env
#   bash infra/vps/scripts/set-github-secrets.sh
#
# Requires: gh auth login, bash 4+ (for associative array), or use the PowerShell script on Windows.

set -euo pipefail

if [[ "${BASH_VERSINFO[0]}" -lt 4 ]]; then
  echo "This script needs bash 4+ (associative arrays). On macOS: brew install bash, or use:" >&2
  echo "  pwsh infra/vps/scripts/set-github-secrets.ps1" >&2
  exit 1
fi

if ! command -v gh >/dev/null 2>&1; then
  echo "GitHub CLI (gh) not found. Install: https://cli.github.com/" >&2
  exit 1
fi

ROOT="$(git rev-parse --show-toplevel 2>/dev/null || true)"
if [[ -z "$ROOT" ]]; then
  ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/../../.." && pwd)"
fi
ENV_FILE="$ROOT/infra/vps/.github-secrets.local.env"

if [[ ! -f "$ENV_FILE" ]]; then
  echo "Missing env file: $ENV_FILE — copy infra/vps/.github-secrets.local.env.example and fill values." >&2
  exit 1
fi

declare -A KV
while IFS= read -r line || [[ -n "$line" ]]; do
  t="${line#"${line%%[![:space:]]*}"}"
  t="${t%"${t##*[![:space:]]}"}"
  [[ -z "$t" || "${t:0:1}" == "#" ]] && continue
  [[ "$t" != *"="* ]] && continue
  key="${t%%=*}"
  val="${t#*=}"
  key="${key#"${key%%[![:space:]]*}"}"
  key="${key%"${key##*[![:space:]]}"}"
  val="${val#"${val%%[![:space:]]*}"}"
  val="${val%"${val##*[![:space:]]}"}"
  if [[ "${#val}" -ge 2 && "$val" == \"*\" ]]; then
    val="${val:1:${#val}-2}"
  fi
  [[ -n "$key" ]] || continue
  KV[$key]=$val
done <"$ENV_FILE"

REQUIRED_SECRETS=(
  HOSTINGER_API_KEY
  DATABASE_URL
  SUPABASE_URL
  SUPABASE_ANON_KEY
  SUPABASE_SERVICE_ROLE_KEY
  JWT_SECRET
  ENCRYPTION_KEY
  CORS_ORIGIN
  NEXT_PUBLIC_SUPABASE_URL
  NEXT_PUBLIC_SUPABASE_ANON_KEY
)

REQUIRED_VARS=(
  HOSTINGER_VM_ID
)

MISSING_SECRETS=()
for name in "${REQUIRED_SECRETS[@]}"; do
  v="${KV[$name]-}"
  if [[ -z "${v//[[:space:]]/}" ]]; then
    MISSING_SECRETS+=("$name")
  fi
done

MISSING_VARS=()
for name in "${REQUIRED_VARS[@]}"; do
  v="${KV[$name]-}"
  if [[ -z "${v//[[:space:]]/}" ]]; then
    MISSING_VARS+=("$name")
  fi
done

if [[ "${#MISSING_SECRETS[@]}" -gt 0 || "${#MISSING_VARS[@]}" -gt 0 ]]; then
  echo "" >&2
  echo "Validation failed: required keys are missing or empty (values are not shown)." >&2
  if [[ "${#MISSING_SECRETS[@]}" -gt 0 ]]; then
    echo "" >&2
    echo "Missing GitHub Actions secrets (names only):" >&2
    for n in "${MISSING_SECRETS[@]}"; do echo "  - $n" >&2; done
  fi
  if [[ "${#MISSING_VARS[@]}" -gt 0 ]]; then
    echo "" >&2
    echo "Missing GitHub Actions variables (names only):" >&2
    for n in "${MISSING_VARS[@]}"; do echo "  - $n" >&2; done
  fi
  exit 1
fi

echo ""
echo "=== Validation OK ==="
echo ""
echo "GitHub Actions secrets to upload (${#REQUIRED_SECRETS[@]} names; values never printed):"
for n in "${REQUIRED_SECRETS[@]}"; do echo "  - $n"; done

echo ""
echo "GitHub Actions variables to upload (${#REQUIRED_VARS[@]} name; value not printed):"
for n in "${REQUIRED_VARS[@]}"; do echo "  - $n"; done

echo ""
echo "--- gh auth status (must succeed) ---"
if ! gh auth status; then
  echo "" >&2
  echo "gh auth status failed. Run: gh auth login" >&2
  exit 1
fi

REPO_NAME="$(gh repo view --json nameWithOwner -q .nameWithOwner 2>/dev/null || true)"
if [[ -n "$REPO_NAME" ]]; then
  echo ""
  echo "Target GitHub repo: $REPO_NAME"
fi

echo ""
echo "You are about to write these names to the current repo's GitHub Actions secrets and variables."
echo "Secret and variable values will be sent to GitHub via gh and will not be echoed here."
read -r -p "Type YES (exactly) to continue, or anything else to abort: " CONFIRM
if [[ "$CONFIRM" != "YES" ]]; then
  echo "Aborted."
  exit 0
fi

for name in "${REQUIRED_SECRETS[@]}"; do
  echo "Uploading secret name: $name" >&2
  gh secret set "$name" <<<"${KV[$name]}"
done

for name in "${REQUIRED_VARS[@]}"; do
  echo "Uploading variable name: $name" >&2
  gh variable set "$name" --body "${KV[$name]}"
done

echo ""
echo "=== Upload complete ==="

REPO_SLUG="$(gh repo view --json nameWithOwner -q .nameWithOwner)"
if [[ -z "$REPO_SLUG" ]]; then
  echo "Could not resolve repo (gh repo view failed)." >&2
  exit 1
fi
echo ""
echo "--- Repository Actions secrets (names only; values never returned by this API) ---"
gh api "repos/${REPO_SLUG}/actions/secrets" --paginate --jq '.secrets[].name' | sed '/^$/d' | sed 's/^/  /'

echo ""
echo "--- Repository Actions variables (names only; avoids gh variable list table with values) ---"
gh api "repos/${REPO_SLUG}/actions/variables" --paginate --jq '.variables[].name' | sed '/^$/d' | sed 's/^/  /'

echo ""
echo "Done."
