[CmdletBinding()]
param()

Set-StrictMode -Version Latest
$ErrorActionPreference = "Stop"

$root = (Resolve-Path (Join-Path $PSScriptRoot "..\..")).Path
$runtimeDir = Join-Path $root ".cloudflare"
$logDir = Join-Path $root "cloudflare-logs"
$urlFile = Join-Path $root ".cloudflare-tunnel-url"
$pidFile = Join-Path $runtimeDir "tunnel.pid"
$processStateFile = Join-Path $runtimeDir "tunnel-process.json"
$appMarker = Join-Path $runtimeDir "app-started"
$configState = Join-Path $runtimeDir "config-moves.tsv"
$origin = "http://127.0.0.1:8080"
$healthUrl = "$origin/healthz"

function Test-Health {
  try {
    $response = Invoke-WebRequest -UseBasicParsing -Uri $healthUrl -TimeoutSec 5
    return $response.StatusCode -eq 200
  } catch {
    return $false
  }
}

function Invoke-Compose([string[]]$Arguments) {
  & docker compose @Arguments
  if ($LASTEXITCODE -ne 0) {
    throw "docker compose $($Arguments -join ' ') failed."
  }
}

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

function Restore-CloudflareConfig {
  if (-not (Test-Path $configState)) { return }

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

function Stop-OwnedApp {
  if (-not (Test-Path $appMarker)) { return }
  try { Invoke-Compose @("stop") } finally {
    Remove-Item -LiteralPath $appMarker -Force -ErrorAction SilentlyContinue
  }
}

New-Item -ItemType Directory -Force -Path $runtimeDir, $logDir | Out-Null
Set-Location $root

if (Test-Path $pidFile) {
  $existingProcessId = 0
  $pidIsValid = [int]::TryParse((Get-Content -Raw $pidFile).Trim(), [ref]$existingProcessId)
  $existing = if ($pidIsValid) { Get-Process -Id $existingProcessId -ErrorAction SilentlyContinue } else { $null }
  if ($existing -and $existing.ProcessName -like "cloudflared*") {
    $owned = Get-OwnedTunnelProcess
    if ($owned) {
      $existingUrl = if (Test-Path $urlFile) { (Get-Content -Raw $urlFile).Trim() } else { "URL pending" }
      throw "Tunnel is already running (PID $existingProcessId): $existingUrl"
    }
    throw "PID $existingProcessId belongs to an unverified cloudflared process; it was not touched."
  }
}
Remove-Item -LiteralPath $pidFile, $processStateFile, $urlFile -Force -ErrorAction SilentlyContinue
Restore-CloudflareConfig

$cloudflaredCommand = Get-Command cloudflared -ErrorAction SilentlyContinue
$cloudflared = if ($cloudflaredCommand) { $cloudflaredCommand.Source } else { $null }
if (-not $cloudflared) {
  $candidates = @(
    (Join-Path $env:ProgramFiles "cloudflared\cloudflared.exe"),
    $(if (${env:ProgramFiles(x86)}) { Join-Path ${env:ProgramFiles(x86)} "cloudflared\cloudflared.exe" })
  ) | Where-Object { $_ -and (Test-Path $_) }
  $cloudflared = $candidates | Select-Object -First 1
}
if (-not $cloudflared) {
  throw "cloudflared is not installed. Run: winget install --id Cloudflare.cloudflared"
}

$appWasRunning = Test-Health
if (-not $appWasRunning) {
  if (-not (Get-Command docker -ErrorAction SilentlyContinue)) {
    throw "Docker is required to start this project."
  }
  $runningServices = @(& docker compose ps --status running -q 2>$null)
  Invoke-Compose @("up", "-d", "--build")
  if ($runningServices.Count -eq 0) {
    Set-Content -LiteralPath $appMarker -Value (Get-Date).ToString("o") -Encoding ascii
  }
  for ($attempt = 0; $attempt -lt 90 -and -not (Test-Health); $attempt++) {
    Start-Sleep -Seconds 2
  }
  if (-not (Test-Health)) {
    Stop-OwnedApp
    throw "Application did not become healthy at $healthUrl."
  }
}

$configDirectory = Join-Path $HOME ".cloudflared"
$moves = @()
foreach ($name in @("config.yml", "config.yaml")) {
  $configPath = Join-Path $configDirectory $name
  if (-not (Test-Path $configPath)) { continue }
  $backupPath = "$configPath.quick-tunnel-disabled-$(Get-Date -Format 'yyyyMMddHHmmss')"
  Move-Item -LiteralPath $configPath -Destination $backupPath
  $moves += "$configPath`t$backupPath"
}
if ($moves.Count) {
  Set-Content -LiteralPath $configState -Value $moves -Encoding utf8
}

$timestamp = Get-Date -Format "yyyyMMdd-HHmmss"
$stdoutLog = Join-Path $logDir "cloudflared-$timestamp.out.log"
$stderrLog = Join-Path $logDir "cloudflared-$timestamp.err.log"
$tunnel = $null
$completed = $false

try {
  $tunnel = Start-Process -FilePath $cloudflared -ArgumentList @("tunnel", "--url", $origin) -RedirectStandardOutput $stdoutLog -RedirectStandardError $stderrLog -PassThru -WindowStyle Hidden
  Start-Sleep -Milliseconds 100
  $tunnel.Refresh()
  Set-Content -LiteralPath $pidFile -Value $tunnel.Id -Encoding ascii
  @{
    pid = $tunnel.Id
    startTimeUtcTicks = $tunnel.StartTime.ToUniversalTime().Ticks
    executable = $cloudflared
  } | ConvertTo-Json | Set-Content -LiteralPath $processStateFile -Encoding ascii

  $publicUrl = $null
  for ($attempt = 0; $attempt -lt 60 -and -not $publicUrl; $attempt++) {
    Start-Sleep -Seconds 1
    if ($tunnel.HasExited) { break }
    $logText = ((Get-Content -Raw $stdoutLog -ErrorAction SilentlyContinue) + "`n" + (Get-Content -Raw $stderrLog -ErrorAction SilentlyContinue))
    $match = [regex]::Match($logText, "https://[a-z0-9-]+\.trycloudflare\.com")
    if ($match.Success) { $publicUrl = $match.Value }
  }

  if (-not $publicUrl) {
    throw "cloudflared did not produce a Quick Tunnel URL. Review $stderrLog."
  }

  Set-Content -LiteralPath $urlFile -Value $publicUrl -Encoding ascii
  $completed = $true
  Write-Host "Cloudflare Quick Tunnel is ready: $publicUrl" -ForegroundColor Green
  Write-Host "Logs: $logDir"
} finally {
  if (-not $completed) {
    if ($tunnel -and -not $tunnel.HasExited) {
      Stop-Process -Id $tunnel.Id -Force -ErrorAction SilentlyContinue
    }
    Remove-Item -LiteralPath $pidFile, $processStateFile, $urlFile -Force -ErrorAction SilentlyContinue
    Restore-CloudflareConfig
    if (-not $appWasRunning) { Stop-OwnedApp }
  }
}
