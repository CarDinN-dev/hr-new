[CmdletBinding()]
param()

Set-StrictMode -Version Latest
$ErrorActionPreference = "Stop"

$root = (Resolve-Path (Join-Path $PSScriptRoot "..\..")).Path
$runtimeDir = Join-Path $root ".cloudflare"
$urlFile = Join-Path $root ".cloudflare-tunnel-url"
$pidFile = Join-Path $runtimeDir "tunnel.pid"
$processStateFile = Join-Path $runtimeDir "tunnel-process.json"
$appMarker = Join-Path $runtimeDir "app-started"
$configState = Join-Path $runtimeDir "config-moves.tsv"

function Get-OwnedTunnelProcess {
  if (-not (Test-Path $pidFile) -or -not (Test-Path $processStateFile)) { return $null }
  $processId = 0
  if (-not [int]::TryParse((Get-Content -Raw $pidFile).Trim(), [ref]$processId)) { return $null }
  try {
    $state = Get-Content -Raw $processStateFile | ConvertFrom-Json
    if ([int]$state.pid -ne $processId) { return $null }
    $process = Get-Process -Id $processId -ErrorAction SilentlyContinue
    if (-not $process -or $process.ProcessName -notlike "cloudflared*") { return $null }
    if ([string]$state.startTimeUtcTicks -ne [string]$process.StartTime.ToUniversalTime().Ticks) { return $null }
    return $process
  } catch {
    return $null
  }
}

Set-Location $root

$ownedProcess = Get-OwnedTunnelProcess
if ($ownedProcess) {
  Stop-Process -Id $ownedProcess.Id -Force
  $ownedProcess.WaitForExit(10000) | Out-Null
} elseif (Test-Path $pidFile) {
  $rawPid = (Get-Content -Raw $pidFile).Trim()
  $parsedPid = 0
  $process = if ([int]::TryParse($rawPid, [ref]$parsedPid)) { Get-Process -Id $parsedPid -ErrorAction SilentlyContinue } else { $null }
  if ($process) {
    Write-Warning "PID $parsedPid is not a verified tunnel process; it was not stopped."
  } else {
    Write-Warning "Removed stale tunnel state."
  }
}

Remove-Item -LiteralPath $pidFile, $processStateFile, $urlFile -Force -ErrorAction SilentlyContinue

if (Test-Path $configState) {
  $pending = @()
  foreach ($line in Get-Content $configState) {
    $parts = $line -split "`t", 2
    if ($parts.Count -ne 2 -or -not (Test-Path $parts[1])) { continue }
    if (Test-Path $parts[0]) {
      Write-Warning "Cannot restore $($parts[0]); it already exists. Backup kept at $($parts[1])."
      $pending += $line
    } else {
      Move-Item -LiteralPath $parts[1] -Destination $parts[0]
    }
  }
  if ($pending.Count) {
    Set-Content -LiteralPath $configState -Value $pending -Encoding utf8
  } else {
    Remove-Item -LiteralPath $configState -Force -ErrorAction SilentlyContinue
  }
}

if (Test-Path $appMarker) {
  & docker compose stop
  if ($LASTEXITCODE -ne 0) { throw "docker compose stop failed." }
  Remove-Item -LiteralPath $appMarker -Force
}

Write-Host "Cloudflare Quick Tunnel is stopped." -ForegroundColor Green
