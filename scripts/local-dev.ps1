[CmdletBinding()]
param([ValidateSet('start', 'stop', 'status')][string]$Action = 'start')
$ErrorActionPreference = 'Stop'
$root = [IO.Path]::GetFullPath((Split-Path -Parent $PSScriptRoot))
$runtime = Join-Path $root '.wx-local-runtime'
$stateFile = Join-Path $runtime 'services.json'
New-Item -ItemType Directory -Force -Path $runtime | Out-Null
$services = @(
  @{ Name = 'backend'; Port = 3000; Directory = 'backend'; Entry = 'scripts/run-local-backend.cjs'; Extra = ''; Health = '/health/ready' },
  @{ Name = 'admin'; Port = 5173; Directory = 'admin-web'; Entry = 'admin-web/node_modules/vite/bin/vite.js'; Extra = '--host 127.0.0.1 --port 5173 --strictPort'; Health = '/login' },
  @{ Name = 'customer'; Port = 5174; Directory = 'web-customer'; Entry = 'web-customer/node_modules/vite/bin/vite.js'; Extra = '--host 127.0.0.1 --port 5174 --strictPort'; Health = '/login' },
  @{ Name = 'official'; Port = 5180; Directory = 'official-site'; Entry = 'web-customer/node_modules/vite/bin/vite.js'; Extra = '--host 127.0.0.1 --port 5180 --strictPort'; Health = '/' }
)
$records = @()
if (Test-Path -LiteralPath $stateFile) {
  $loaded = Get-Content -LiteralPath $stateFile -Raw | ConvertFrom-Json
  foreach ($record in $loaded) { $records += $record }
}
function Save-State { ConvertTo-Json -InputObject @($script:records) -Depth 4 | Set-Content -LiteralPath $stateFile -Encoding UTF8 }
function Get-OwnedProcess($record) {
  $proc = Get-Process -Id $record.ProcessId -ErrorAction SilentlyContinue
  if ($proc -and $proc.StartTime.ToUniversalTime().Ticks.ToString() -eq $record.StartTicks) { return $proc }
  return $null
}
function Stop-Tree([int]$ProcessId) {
  $children = @(Get-CimInstance Win32_Process -Filter "ParentProcessId=$ProcessId")
  foreach ($child in $children) { Stop-Tree $child.ProcessId }
  Stop-Process -Id $ProcessId -ErrorAction SilentlyContinue
}
function Assert-Exit([string]$label) { if ($LASTEXITCODE -ne 0) { throw "$label failed (exit $LASTEXITCODE)" } }
function Test-Health($service) {
  try {
    $response = Invoke-WebRequest -UseBasicParsing -TimeoutSec 3 -Uri "http://127.0.0.1:$($service.Port)$($service.Health)"
    return $response.StatusCode -eq 200
  } catch { return $false }
}
if ($Action -eq 'stop') {
  foreach ($record in $records) {
    if (Get-OwnedProcess $record) { Stop-Tree $record.ProcessId; Write-Host "Stopped $($record.Name)" }
  }
  $records = @()
  Save-State
  Write-Host 'Local application services stopped. Database containers and all data were preserved.'
  exit 0
}
if ($Action -eq 'status') {
  foreach ($service in $services) { Write-Host "$($service.Name): $(Test-Health $service) http://127.0.0.1:$($service.Port)" }
  exit 0
}
$node = (Get-Command node.exe).Source
foreach ($entry in @('backend/node_modules/prisma/build/index.js', 'backend/node_modules/@nestjs/cli/bin/nest.js', 'admin-web/node_modules/vite/bin/vite.js', 'web-customer/node_modules/vite/bin/vite.js')) {
  if (!(Test-Path -LiteralPath (Join-Path $root $entry))) { throw "Missing dependency: $entry. Run npm ci in that package." }
}
foreach ($service in $services) {
  $record = $records | Where-Object Name -eq $service.Name | Select-Object -First 1
  $owned = $record -and (Get-OwnedProcess $record)
  if (!$owned -and (Get-NetTCPConnection -State Listen -LocalPort $service.Port -ErrorAction SilentlyContinue)) {
    throw "Port $($service.Port) is occupied by an unmanaged process. Nothing was stopped; inspect it before retrying."
  }
}
& $node (Join-Path $root 'scripts/local-environment.cjs') check
Assert-Exit 'Local environment validation'
& $node (Join-Path $root 'scripts/wait-local-services.cjs') --engine
Assert-Exit 'Docker engine (start Docker Desktop first if needed)'
docker compose -f (Join-Path $root 'docker-compose.dev.yml') up -d --pull never --wait mysql redis minio
Assert-Exit 'Local infrastructure'
& $node (Join-Path $root 'scripts/wait-local-services.cjs')
Assert-Exit 'Windows-to-Docker connectivity check (no migrations run on failure)'
$backendRecord = $records | Where-Object Name -eq 'backend' | Select-Object -First 1
if (!$backendRecord -or !(Get-OwnedProcess $backendRecord)) {
  & $node (Join-Path $root 'scripts/local-environment.cjs') migrate
  Assert-Exit 'Backup and migration'
}
& $node (Join-Path $root 'scripts/prepare-local-mini.cjs')
Assert-Exit 'Local mini project preparation'
$oldApi = $env:VITE_API_BASE_URL
try {
  $env:VITE_API_BASE_URL = 'http://127.0.0.1:3000/api/v1'
  foreach ($service in $services) {
    $record = $records | Where-Object Name -eq $service.Name | Select-Object -First 1
    if (!$record -or !(Get-OwnedProcess $record)) {
      $entry = Join-Path $root $service.Entry
      $proc = Start-Process -FilePath $node -ArgumentList "`"$entry`" $($service.Extra)" -WorkingDirectory (Join-Path $root $service.Directory) -WindowStyle Hidden -PassThru -RedirectStandardOutput (Join-Path $runtime "$($service.Name).log") -RedirectStandardError (Join-Path $runtime "$($service.Name).error.log")
      $records = @($records | Where-Object Name -ne $service.Name) + @(@{ Name = $service.Name; ProcessId = $proc.Id; StartTicks = $proc.StartTime.ToUniversalTime().Ticks.ToString() })
      Save-State
    }
    $ready = $false
    for ($attempt = 0; $attempt -lt 60; $attempt++) {
      if (Test-Health $service) { $ready = $true; break }
      Start-Sleep -Seconds 1
    }
    if (!$ready) { throw "$($service.Name) did not become ready. See $runtime. Successfully started services were retained." }
    Write-Host "$($service.Name): http://127.0.0.1:$($service.Port)"
  }
} finally { $env:VITE_API_BASE_URL = $oldApi }
Write-Host 'Ready. Existing data preserved; local SMS code: 123456 (request a code before login).'
