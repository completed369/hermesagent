# Shared helpers for VentureOS local scripts. Dot-sourced by the others.

function Write-Pass($msg) { Write-Host "  [PASS] $msg" -ForegroundColor Green }
function Write-Warn($msg) { Write-Host "  [WARN] $msg" -ForegroundColor Yellow }
function Write-Fail($msg) { Write-Host "  [FAIL] $msg" -ForegroundColor Red }
function Write-Step($msg) { Write-Host "`n== $msg ==" -ForegroundColor Cyan }

function Get-RepoRoot {
    # scripts/ is always directly under the repo root.
    return (Resolve-Path (Join-Path $PSScriptRoot "..")).Path
}

function Stop-OnFailure($exitCode, $stepName) {
    if ($exitCode -ne 0) {
        Write-Fail "$stepName failed (exit code $exitCode). Stopping — see the real error above."
        exit $exitCode
    }
}
