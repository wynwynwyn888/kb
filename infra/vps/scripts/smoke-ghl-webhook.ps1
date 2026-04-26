#Requires -Version 5.1
<#
.SYNOPSIS
  Posts a realistic GHL inbound webhook JSON to AISBP production (safe manual smoke test).

.DESCRIPTION
  Generates a unique data.id, UTC timestamp, and optional synthetic conversationId.
  Prints a preview, requires typing SEND to confirm, then POSTs to the webhook URL.
  No secrets are used or printed.

.EXAMPLE
  pwsh infra/vps/scripts/smoke-ghl-webhook.ps1 -LocationId "xxx" -ContactId "yyy"

.EXAMPLE
  pwsh infra/vps/scripts/smoke-ghl-webhook.ps1 -LocationId "xxx" -ContactId "yyy" -ConversationId "zzz" -Message "hi"
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
  [string] $WebhookUrl = 'https://kb.aisalesbot.pro/api/v1/webhooks/ghl'
)

Set-StrictMode -Version Latest
$ErrorActionPreference = 'Stop'

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
Write-Host '----------------------------------------'
Write-Host ''

$confirm = Read-Host 'Type SEND exactly to continue'
if ($confirm -cne 'SEND') {
  Write-Host 'Aborted (expected exactly: SEND).' -ForegroundColor Yellow
  exit 1
}

Write-Host ''
Write-Host 'Posting...' -ForegroundColor Cyan

try {
  $response = Invoke-WebRequest `
    -Uri $WebhookUrl `
    -Method Post `
    -Body $bodyJson `
    -ContentType 'application/json; charset=utf-8' `
    -Headers @{ 'x-ghl-signature' = '' } `
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
        if ($text.Length -gt 8000) { $text = $text.Substring(0, 8000) + '…(truncated)' }
        Write-Host $text
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
