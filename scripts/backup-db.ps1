# =============================================
# 数据库备份脚本（开发/测试环境）
# 用法: .\scripts\backup-db.ps1
# 备份文件输出到 backup/ 目录，自动保留最近 14 份
# =============================================
[CmdletBinding()]
param(
  [string]$Container = 'miniprogram-mysql-1',
  [string]$Database = 'b2b_miniapp',
  [string]$MysqlUser = 'root',
  [string]$MysqlPassword = 'password',
  [int]$Keep = 14
)

$ErrorActionPreference = 'Stop'
$root = Split-Path -Parent $PSScriptRoot
$outDir = Join-Path $root 'backup'
New-Item -ItemType Directory -Force -Path $outDir | Out-Null

# 1. 确认容器在运行
docker inspect -f '{{.State.Running}}' $Container 2>$null | Out-Null
if ($LASTEXITCODE -ne 0) {
  Write-Error "容器 $Container 未运行，请先执行: docker compose -f docker-compose.dev.yml up -d"
  exit 1
}

# 2. mysqldump 备份
$timestamp = Get-Date -Format 'yyyyMMdd-HHmmss'
$file = Join-Path $outDir "$Database-$timestamp.sql"
$dumpCmd = "exec mysqldump -u$MysqlUser -p$MysqlPassword --databases $Database --single-transaction --routines --triggers"
docker exec $Container sh -c $dumpCmd | Out-File -FilePath $file -Encoding utf8
if ($LASTEXITCODE -ne 0) { Write-Error "备份失败"; exit 1 }

# 3. 清理旧备份，保留最近 $Keep 份
Get-ChildItem $outDir -Filter "$Database-*.sql" |
  Sort-Object LastWriteTime -Descending |
  Select-Object -Skip $Keep |
  ForEach-Object { Remove-Item -LiteralPath $_.FullName -Force; Write-Host "已清理旧备份: $($_.Name)" }