#Requires -Version 7.0
# Checks prerequisites BEFORE making any changes. Never modifies anything.
. "$PSScriptRoot\_common.ps1"

$repoRoot = Get-RepoRoot
$failed = $false

Write-Step "PowerShell version"
if ($PSVersionTable.PSVersion.Major -ge 7) {
    Write-Pass "PowerShell $($PSVersionTable.PSVersion)"
} else {
    Write-Fail "PowerShell 7+ required, found $($PSVersionTable.PSVersion). Install: winget install Microsoft.PowerShell"
    $failed = $true
}

Write-Step "Git"
if (Get-Command git -ErrorAction SilentlyContinue) {
    Write-Pass (git --version)
} else {
    Write-Fail "Git not found. Install Git for Windows."
    $failed = $true
}

Write-Step "Node.js"
$node = Get-Command node -ErrorAction SilentlyContinue
if ($node) {
    $nodeVersion = (node --version) -replace 'v', ''
    $major = [int]($nodeVersion.Split('.')[0])
    if ($major -ge 22) {
        Write-Pass "Node v$nodeVersion"
    } else {
        Write-Warn "Node v$nodeVersion found; v22 LTS recommended. Some dependencies may not resolve correctly on older versions."
    }
} else {
    Write-Fail "Node.js not found. Install Node 22 LTS from nodejs.org."
    $failed = $true
}

Write-Step "pnpm (via Corepack)"
if (Get-Command pnpm -ErrorAction SilentlyContinue) {
    Write-Pass (pnpm --version)
} else {
    Write-Warn "pnpm not found on PATH. Run: corepack enable   (then re-open this terminal)"
}

Write-Step "Docker Desktop"
$docker = Get-Command docker -ErrorAction SilentlyContinue
if ($docker) {
    $dockerInfo = docker info 2>&1
    if ($LASTEXITCODE -eq 0) {
        Write-Pass "Docker Desktop is running"
    } else {
        Write-Fail "Docker CLI found but the daemon isn't responding. Start Docker Desktop and wait for it to say 'running'."
        $failed = $true
    }
} else {
    Write-Fail "Docker not found. Install Docker Desktop (with WSL2 backend) from docker.com."
    $failed = $true
}

Write-Step "Required ports free (3000, 3001, 5432, 7233, 8088, 9000, 9001)"
$ports = 3000, 3001, 5432, 7233, 8088, 9000, 9001
foreach ($port in $ports) {
    $inUse = Get-NetTCPConnection -LocalPort $port -ErrorAction SilentlyContinue
    if ($inUse) {
        Write-Warn "Port $port is already in use. If that's a previous VentureOS run, this is fine; otherwise expect a conflict."
    } else {
        Write-Pass "Port $port is free"
    }
}

Write-Step "Repository location"
Write-Pass "Repo root: $repoRoot"
if (-not (Test-Path (Join-Path $repoRoot "pnpm-workspace.yaml"))) {
    Write-Fail "pnpm-workspace.yaml not found at repo root — is this script running from inside the VentureOS repo's scripts\ folder?"
    $failed = $true
}

Write-Host ""
if ($failed) {
    Write-Host "Preflight found blocking issues. Resolve the [FAIL] items above before continuing." -ForegroundColor Red
    exit 1
} else {
    Write-Host "Preflight passed (warnings, if any, are non-blocking)." -ForegroundColor Green
}
