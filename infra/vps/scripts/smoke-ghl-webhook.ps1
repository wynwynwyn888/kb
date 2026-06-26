#Requires -Version 5.1
<#
.SYNOPSIS
  Posts a realistic GHL inbound webhook JSON to AISBP production (safe manual smoke test).

.DESCRIPTION
  Generates a unique data.id, UTC timestamp, and optional synthetic conversationId.
  Prints a preview, requires typing SEND to confirm, then POSTs to the webhook URL.
  No secrets are used or printed.

  Production auth: pass -WebhookToken or -WebhookSecret to match the backend's
  WEBHOOK_SIGNATURE_SECRET. Without auth, unsigned webhooks return 401 in production.

.EXAMPLE
  pwsh infra/vps/scripts/smoke-ghl-webhook.ps1 -LocationId "xxx" -ContactId "yyy"

.EXAMPLE
  pwsh infra/vps/scripts/smoke-ghl-webhook.ps1 -LocationId "xxx" -ContactId "yyy" -ConversationId "zzz" -Message "hi"

.EXAMPLE
  $env:AISBP_WEBHOOK_TOKEN = "my-secret"
  pwsh infra/vps/scripts/smoke-ghl-webhook.ps1 -LocationId "xxx" -ContactId "yyy"
#>
[CmdletBinding()]
param(
  [Parameter(Mandatory = $true, HelpMessage = 'HighLevel sub-account location ID (must match AISBP tenant ghl_location_id).')]
  [string] $LocationId,

  [Parameter(Mandatory = $true, HelpMessage = 'HighLevel contact ID (SMS-capable for end-to-end SMS).')]
  [string] $ContactId,

  [Parameter(Mandatory = $false, HelpMessage = 'HighLevel conversation ID; if omitted, a synthetic conv-smoke-* id is used.')]
  [string] $ConversationId = '',

  [Parameter(Mandatory = $false)]
  [string] $Message = 'AISBP smoke test. Please reply with one short sentence.',

  [Parameter(Mandatory = $false)]
  [string] $WebhookUrl = 'https://kb.aisalesbot.pro/api/v1/webhooks/ghl',

  [Parameter(Mandatory = $false, HelpMessage = 'Static token matching WEBHOOK_SIGNATURE_SECRET (sent via x-aisbp-webhook-token)')]
  [string] $WebhookToken = '',

  [Parameter(Mandatory = $false, HelpMessage = 'HMAC secret matching WEBHOOK_SIGNATURE_SECRET (HMAC-SHA256 computed automatically)')]
  [string] $WebhookSecret = ''
)

Set-StrictMode -Version Latest
$ErrorActionPreference = 'Stop'

# Resolve auth from env vars if not provided via CLI
$token = if ($WebhookToken.Trim().Length -gt 0) { $WebhookToken.Trim() } else { $env:AISBP_WEBHOOK_TOKEN ?? '' }
$secret = if ($WebhookSecret.Trim().Length -gt 0) { $WebhookSecret.Trim() } else { $env:WEBHOOK_SIGNATURE_SECRET ?? '' }

$utcNow = [datetime]::UtcNow
$uniqueSuffix = '{0}-{1:x4}' -f $utcNow.ToString('yyyyMMdd-HHmmss'), (Get-Random -Maximum 0x10000)
$dataId = "ghl-msg-smoke-$uniqueSuffix"
$convId = if ($ConversationId.Trim().Length -gt 0) { $ConversationId.Trim() } else { "conv-smoke-$uniqueSuffix" }
$timestamp = $utcNow.ToString('o')

$payload = [ordered]@{
  locationId   = $LocationId.Trim()
  event        = 'InboundMessage'
  timestamp    = $timestamp
  version      = '1.0'
  data         = [ordered]@{
    id              = $dataId
    conversationId  = $convId
    contactId       = $ContactId.Trim()
    message         = $Message
    messageType     = 'TextMessage'
    channel         = 'SMS'
  }
}

$bodyJson = ($payload | ConvertTo-Json -Depth 6 -Compress)

Write-Host ''
Write-Host '--- Smoke test preview (no secrets) ---' -ForegroundColor Cyan
Write-Host "  Webhook URL:      $WebhookUrl"
Write-Host "  locationId:       $($payload.locationId)"
Write-Host "  contactId:        $($payload.data.contactId)"
Write-Host "  conversationId:   $($payload.data.conversationId)"
Write-Host "  message:          $($payload.data.message)"
Write-Host "  generated data.id: $($payload.data.id)"
if ($token.Length -gt 0) {
  Write-Host "  auth:             static token (****)"
} elseif ($secret.Length -gt 0) {
  Write-Host "  auth:             HMAC-SHA256 (secret not shown)"
} else {
  Write-Host "  auth:             none (may fail 401 in production)"
}
Write-Host '----------------------------------------'
Write-Host ''

$confirm = Read-Host 'Type SEND exactly to continue'
if ($confirm -cne 'SEND') {
  Write-Host 'Aborted (expected exactly: SEND).' -ForegroundColor Yellow
  exit 1
}

Write-Host ''
Write-Host 'Posting...' -ForegroundColor Cyan

# Build auth headers
$headers = @{ 'Content-Type' = 'application/json; charset=utf-8' }
if ($token.Length -gt 0) {
  # Static token auth
  $headers['x-aisbp-webhook-token'] = $token
} elseif ($secret.Length -gt 0) {
  # HMAC-SHA256 auth: compute signature over raw body
  $hmac = New-Object System.Security.Cryptography.HMACSHA256
  $hmac.Key = [System.Text.Encoding]::UTF8.GetBytes($secret)
  $hash = $hmac.ComputeHash([System.Text.Encoding]::UTF8.GetBytes($bodyJson))
  $sig = [System.BitConverter]::ToString($hash).Replace('-', '').ToLower()
  $headers['x-ghl-signature'] = "sha256=$sig"
} else {
  # No auth — empty signature (works only if backend secret is not configured)
  $headers['x-ghl-signature'] = ''
}

try {
  $response = Invoke-WebRequest `
    -Uri $WebhookUrl `
    -Method Post `
    -Body $bodyJson `
    -ContentType 'application/json; charset=utf-8' `
    -Headers $headers `
    -UseBasicParsing

  Write-Host "HTTP $($response.StatusCode)" -ForegroundColor Green
  Write-Host 'Response body:'
  Write-Host $response.Content
}
catch {
  $ex = $_.Exception
  Write-Host 'Request failed.' -ForegroundColor Red
  if ($ex.Response) {
    try {
      $code = [int]$ex.Response.StatusCode
      Write-Host "HTTP $code"
      $stream = $ex.Response.GetResponseStream()
      if ($stream) {
        $reader = New-Object System.IO.StreamReader($stream)
        $text = $reader.ReadToEnd()
        if ($text.Length -gt 8000) { $text = $text.Substring(0, 8000) + '...(truncated)' }
        Write-Host $text
      }
      if ($code -eq 401) {
        Write-Host ''
        Write-Host 'Webhook auth failed (401). The backend requires a valid signature or static token.'
        Write-Host 'Use -WebhookToken or -WebhookSecret with the same value as the backend WEBHOOK_SIGNATURE_SECRET.'
        Write-Host "Never commit secrets - use env vars: `$env:AISBP_WEBHOOK_TOKEN or `$env:WEBHOOK_SIGNATURE_SECRET."
      }
    }
    catch {
      Write-Host ($ex.Message)
    }
  }
  else {
    Write-Host ($ex.Message)
  }
  exit 1
}

Write-Host ''
Write-Host 'Next: watch VPS logs, e.g. docker logs -f aisbp-backend-1' -ForegroundColor Cyan
Write-Host 'See docs/AISBP_PRODUCTION_SMOKE_TEST.md for expected log sequence.' -ForegroundColor DarkGray
