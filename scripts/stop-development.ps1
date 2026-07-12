#Requires -Version 7.0
# Stops Docker Compose infrastructure. Does NOT delete volumes (no data
# loss) — use 'docker compose down -v' manually if you intentionally want
# to wipe local Postgres/MinIO data.
. "$PSScriptRoot\_common.ps1"
Set-Location (Get-RepoRoot)

Write-Step "Stopping infrastructure (docker compose down)"
docker compose down
Stop-OnFailure $LASTEXITCODE "docker compose down"
Write-Pass "Infrastructure stopped. Data volumes preserved (postgres-data, minio-data)."
Write-Host "Dev servers (web/api/worker) started via 'pnpm dev' must be stopped separately with Ctrl+C in their terminal." -ForegroundColor Yellow
