#Requires -Version 7.0
# Starts PostgreSQL, Temporal, Temporal UI, and MinIO via Docker Compose.
. "$PSScriptRoot\_common.ps1"
Set-Location (Get-RepoRoot)

Write-Step "Starting infrastructure (docker compose up -d)"
docker compose up -d
Stop-OnFailure $LASTEXITCODE "docker compose up"

Write-Step "Waiting for Postgres and MinIO to report healthy (up to 90s)"
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

Write-Step "Waiting for Temporal to accept connections on port 7233 (up to 60s)"
# Temporal's auto-setup image has no Docker healthcheck (it runs its own
# first-boot schema setup and can take much longer than Postgres/MinIO to
# start listening), so poll the actual TCP port instead of container health.
$temporalDeadline = (Get-Date).AddSeconds(60)
$temporalReady = $false
while ((Get-Date) -lt $temporalDeadline) {
    $test = Test-NetConnection -ComputerName "localhost" -Port 7233 -WarningAction SilentlyContinue
    if ($test.TcpTestSucceeded) {
        $temporalReady = $true
        break
    }
    Start-Sleep -Seconds 3
}

if ($temporalReady) {
    Write-Pass "Temporal is accepting connections on port 7233"
} else {
    Write-Warn "Temporal did not open port 7233 within 60s. The worker will still retry on its own, but check 'docker compose logs temporal' if this persists."
}

Write-Host ""
docker compose ps
Write-Host ""
Write-Host "Infrastructure started. Next: .\scripts\start-development.ps1" -ForegroundColor Green
