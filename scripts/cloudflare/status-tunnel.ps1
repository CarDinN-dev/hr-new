[CmdletBinding()]
param()

Set-StrictMode -Version Latest
$ErrorActionPreference = "Stop"

$root = (Resolve-Path (Join-Path $PSScriptRoot "..\..")).Path
$runtimeDir = Join-Path $root ".cloudflare"
$urlFile = Join-Path $root ".cloudflare-tunnel-url"
$pidFile = Join-Path $runtimeDir "tunnel.pid"
$processStateFile = Join-Path $runtimeDir "tunnel-process.json"

if (-not (Test-Path $pidFile) -or -not (Test-Path $processStateFile) -or -not (Test-Path $urlFile)) {
  throw "Tunnel is not running."
}

$processId = 0
if (-not [int]::TryParse((Get-Content -Raw $pidFile).Trim(), [ref]$processId)) {
  throw "Tunnel state is stale."
}

$state = Get-Content -Raw $processStateFile | ConvertFrom-Json
$process = Get-Process -Id $processId -ErrorAction SilentlyContinue
if (
  [int]$state.pid -ne $processId -or
  -not $process -or
  $process.ProcessName -notlike "cloudflared*" -or
  [string]$state.startTimeUtcTicks -ne [string]$process.StartTime.ToUniversalTime().Ticks
) {
  throw "Tunnel state is stale or does not identify an owned process."
}

$url = (Get-Content -Raw $urlFile).Trim()
if ($url -notmatch '^https://[a-z0-9-]+\.trycloudflare\.com$') {
  throw "Tunnel URL state is invalid."
}

Write-Output $url
