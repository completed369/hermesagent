#Requires -Version 7.0
# Starts PostgreSQL, Temporal, Temporal UI, and MinIO via Docker Compose.
. "$PSScriptRoot\_common.ps1"
Set-Location (Get-RepoRoot)

Write-Step "Starting infrastructure (docker compose up -d)"
docker compose up -d
Stop-OnFailure $LASTEXITCODE "docker compose up"

Write-Step "Waiting for services to become healthy (up to 90s)"
$deadline = (Get-Date).AddSeconds(90)
$services = @("ventureos-postgres", "ventureos-minio")
$allHealthy = $false

while ((Get-Date) -lt $deadline) {
    $statuses = $services | ForEach-Object {
        $status = docker inspect --format='{{.State.Health.Status}}' $_ 2>$null
        [PSCustomObject]@{ Name = $_; Status = $status }
    }
    $allHealthy = ($statuses | Where-Object { $_.Status -ne "healthy" }).Count -eq 0
    if ($allHealthy) { break }
    Start-Sleep -Seconds 3
}

if ($allHealthy) {
    Write-Pass "postgres and minio report healthy"
} else {
    Write-Warn "Not all services reported healthy within 90s. Run 'docker compose ps' and 'docker compose logs' to investigate."
}

Write-Host ""
docker compose ps
Write-Host ""
Write-Host "Infrastructure started. Next: .\scripts\start-development.ps1" -ForegroundColor Green
