#Requires -Version 7.0
# One-time local setup: .env creation (never overwrites an existing .env),
# dev-only secret generation, dependency install. Non-destructive.
. "$PSScriptRoot\_common.ps1"

$repoRoot = Get-RepoRoot
Set-Location $repoRoot

Write-Step "Environment file"
$envPath = Join-Path $repoRoot ".env"
$envExamplePath = Join-Path $repoRoot ".env.example"

if (Test-Path $envPath) {
    Write-Warn ".env already exists — leaving it untouched (this script never overwrites an existing .env)."
} else {
    if (-not (Test-Path $envExamplePath)) {
        Write-Fail ".env.example not found at repo root."
        exit 1
    }
    Copy-Item $envExamplePath $envPath
    Write-Pass "Created .env from .env.example"

    # Generate development-only secrets so the app doesn't boot with the
    # literal placeholder values. These are LOCAL DEV secrets only — never
    # used for anything that leaves this machine.
    Add-Type -AssemblyName System.Security | Out-Null
    function New-DevSecret {
        $bytes = New-Object byte[] 32
        [System.Security.Cryptography.RandomNumberGenerator]::Fill($bytes)
        return [Convert]::ToBase64String($bytes)
    }

    $authSecret = New-DevSecret
    $pgPassword = New-DevSecret
    $minioPassword = New-DevSecret

    (Get-Content $envPath) |
        ForEach-Object {
            $_ -replace '^AUTH_SECRET=.*', "AUTH_SECRET=$authSecret" `
               -replace '^POSTGRES_PASSWORD=.*', "POSTGRES_PASSWORD=$pgPassword" `
               -replace '^MINIO_ROOT_PASSWORD=.*', "MINIO_ROOT_PASSWORD=$minioPassword"
        } | Set-Content $envPath

    # DATABASE_URL embeds the password too — update it to match.
    (Get-Content $envPath) |
        ForEach-Object { $_ -replace '(postgresql://ventureos:)[^@]+(@)', "`${1}$pgPassword`${2}" } |
        Set-Content $envPath

    Write-Pass "Generated local-only AUTH_SECRET, POSTGRES_PASSWORD, MINIO_ROOT_PASSWORD in .env"
    Write-Warn "DEV_FOUNDER_PASSWORD is still the placeholder 'change-me-dev-only' — change it in .env before doing anything beyond local testing."
}

Write-Step "Corepack / pnpm"
if (-not (Get-Command pnpm -ErrorAction SilentlyContinue)) {
    Write-Host "Enabling Corepack..."
    corepack enable
}
Write-Pass "pnpm ready"

Write-Step "Installing dependencies (pnpm install)"
pnpm install
Stop-OnFailure $LASTEXITCODE "pnpm install"
Write-Pass "Dependencies installed"

Write-Host ""
Write-Host "Setup complete. Next: .\scripts\start-infrastructure.ps1" -ForegroundColor Green
