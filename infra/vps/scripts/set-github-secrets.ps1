#Requires -Version 5.1
<#
.SYNOPSIS
  Upload Hostinger deploy secrets + VM variable to GitHub (gh CLI).

.DESCRIPTION
  Reads infra/vps/.github-secrets.local.env (gitignored). Validates all required keys,
  checks gh auth, asks for confirmation, then uploads. Never prints secret values.

  Run from anywhere inside the repo:
    pwsh infra/vps/scripts/set-github-secrets.ps1
#>
Set-StrictMode -Version Latest
$ErrorActionPreference = 'Stop'

function Read-EnvFile {
  param([string]$Path)
  $map = @{}
  $lines = Get-Content -LiteralPath $Path -Encoding UTF8
  foreach ($line in $lines) {
    $t = $line.Trim()
    if ($t.Length -eq 0 -or $t.StartsWith('#')) { continue }
    $eq = $t.IndexOf('=')
    if ($eq -lt 1) { continue }
    $key = $t.Substring(0, $eq).Trim()
    if ($key.Length -eq 0) { continue }
    $val = $t.Substring($eq + 1).Trim()
    if ($val.Length -ge 2 -and $val.StartsWith('"') -and $val.EndsWith('"')) {
      $val = $val.Substring(1, $val.Length - 2)
    }
    $map[$key] = $val
  }
  return $map
}

$RequiredSecrets = @(
  'HOSTINGER_API_KEY',
  'DATABASE_URL',
  'SUPABASE_URL',
  'SUPABASE_ANON_KEY',
  'SUPABASE_SERVICE_ROLE_KEY',
  'JWT_SECRET',
  'ENCRYPTION_KEY',
  'CORS_ORIGIN',
  'NEXT_PUBLIC_SUPABASE_URL',
  'NEXT_PUBLIC_SUPABASE_ANON_KEY'
)

$RequiredVariables = @(
  'HOSTINGER_VM_ID'
)

if (-not (Get-Command gh -ErrorAction SilentlyContinue)) {
  throw 'GitHub CLI (gh) not found. Install: winget install GitHub.cli'
}

$repoRoot = (git rev-parse --show-toplevel 2>$null).Trim()
if ([string]::IsNullOrWhiteSpace($repoRoot)) {
  throw 'Run this from inside the git repository (git rev-parse failed).'
}

$envFile = Join-Path $repoRoot 'infra/vps/.github-secrets.local.env'
if (-not (Test-Path -LiteralPath $envFile)) {
  throw "Missing env file: $envFile — copy infra/vps/.github-secrets.local.env.example and fill values."
}

Write-Host "Reading: $envFile" -ForegroundColor DarkGray
$kv = Read-EnvFile -Path $envFile

$missingSecrets = @()
foreach ($name in $RequiredSecrets) {
  if (-not $kv.ContainsKey($name) -or [string]::IsNullOrWhiteSpace($kv[$name])) {
    $missingSecrets += $name
  }
}

$missingVars = @()
foreach ($name in $RequiredVariables) {
  if (-not $kv.ContainsKey($name) -or [string]::IsNullOrWhiteSpace($kv[$name])) {
    $missingVars += $name
  }
}

if ($missingSecrets.Count -gt 0 -or $missingVars.Count -gt 0) {
  Write-Host "`nValidation failed: required keys are missing or empty (values are not shown)." -ForegroundColor Red
  if ($missingSecrets.Count -gt 0) {
    Write-Host "`nMissing GitHub Actions secrets (names only):" -ForegroundColor Yellow
    $missingSecrets | ForEach-Object { Write-Host "  - $_" }
  }
  if ($missingVars.Count -gt 0) {
    Write-Host "`nMissing GitHub Actions variables (names only):" -ForegroundColor Yellow
    $missingVars | ForEach-Object { Write-Host "  - $_" }
  }
  exit 1
}

Write-Host "`n=== Validation OK ===" -ForegroundColor Green
Write-Host "`nGitHub Actions secrets to upload (10 names; values never printed):" -ForegroundColor Cyan
$RequiredSecrets | ForEach-Object { Write-Host "  - $_" }

Write-Host "`nGitHub Actions variables to upload (1 name; value not printed):" -ForegroundColor Cyan
$RequiredVariables | ForEach-Object { Write-Host "  - $_" }

Write-Host "`n--- gh auth status (must succeed) ---" -ForegroundColor DarkGray
gh auth status
if ($LASTEXITCODE -ne 0) {
  Write-Host "`ngh auth status failed. Run: gh auth login" -ForegroundColor Red
  exit 1
}

$repoNameRaw = gh repo view --json nameWithOwner -q .nameWithOwner 2>$null
$repoName = if ($repoNameRaw) { $repoNameRaw.Trim() } else { '' }
if (-not [string]::IsNullOrWhiteSpace($repoName)) {
  Write-Host "`nTarget GitHub repo: $repoName" -ForegroundColor Cyan
}

Write-Host "`nYou are about to write these names to the current repo's GitHub Actions secrets and variables." -ForegroundColor Yellow
Write-Host "Secret and variable values will be sent to GitHub via gh and will not be echoed here." -ForegroundColor Yellow
$confirm = Read-Host "Type YES (exactly) to continue, or anything else to abort"
if ($confirm -cne 'YES') {
  Write-Host "Aborted." -ForegroundColor DarkGray
  exit 0
}

foreach ($name in $RequiredSecrets) {
  Write-Host "Uploading secret name: $name" -ForegroundColor DarkGray
  $kv[$name] | gh secret set $name
  if ($LASTEXITCODE -ne 0) {
    throw "gh secret set failed for: $name"
  }
}

foreach ($name in $RequiredVariables) {
  Write-Host "Uploading variable name: $name" -ForegroundColor DarkGray
  gh variable set $name --body $kv[$name]
  if ($LASTEXITCODE -ne 0) {
    throw "gh variable set failed for: $name"
  }
}

Write-Host "`n=== Upload complete ===" -ForegroundColor Green

$repoSlugRaw = gh repo view --json nameWithOwner -q .nameWithOwner
if ([string]::IsNullOrWhiteSpace($repoSlugRaw)) {
  throw 'Could not resolve repo (gh repo view failed).'
}
$repoSlug = $repoSlugRaw.Trim()
Write-Host "`n--- Repository Actions secrets (names only; values never returned by this API) ---" -ForegroundColor Cyan
gh api "repos/$repoSlug/actions/secrets" --paginate --jq '.secrets[].name' | ForEach-Object { if ($_) { Write-Host "  $_" } }

Write-Host "`n--- Repository Actions variables (names only; avoids table output that includes values) ---" -ForegroundColor Cyan
gh api "repos/$repoSlug/actions/variables" --paginate --jq '.variables[].name' | ForEach-Object { if ($_) { Write-Host "  $_" } }

Write-Host "`nDone." -ForegroundColor Green
