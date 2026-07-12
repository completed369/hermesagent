#Requires -Version 7.0
# Generates the Prisma client, runs migrations, seeds the database, and
# starts web + api + worker in dev mode. Assumes start-infrastructure.ps1
# has already been run and services are healthy.
. "$PSScriptRoot\_common.ps1"
Set-Location (Get-RepoRoot)

Write-Step "Prisma generate"
pnpm db:generate
Stop-OnFailure $LASTEXITCODE "pnpm db:generate"
Write-Pass "Prisma client generated"

Write-Step "Database migrate (dev)"
pnpm db:migrate:dev
Stop-OnFailure $LASTEXITCODE "pnpm db:migrate:dev"
Write-Pass "Migrations applied"

Write-Step "Seed database"
pnpm db:seed
Stop-OnFailure $LASTEXITCODE "pnpm db:seed"
Write-Pass "Database seeded (founder account + workspace created)"

Write-Step "Starting web, api, and worker (Ctrl+C to stop)"
Write-Host "  Web:            http://localhost:3000" -ForegroundColor Cyan
Write-Host "  API:            http://localhost:3001" -ForegroundColor Cyan
Write-Host "  API docs:       http://localhost:3001/api/docs" -ForegroundColor Cyan
Write-Host "  Temporal UI:    http://localhost:8088" -ForegroundColor Cyan
Write-Host "  MinIO console:  http://localhost:9001" -ForegroundColor Cyan
Write-Host ""
pnpm dev
