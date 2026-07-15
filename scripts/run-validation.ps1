#Requires -Version 7.0
# Full local validation suite: format check -> lint -> typecheck -> unit
# tests -> integration tests -> production build. Stops immediately and
# shows the real error on the first failing step. See
# docs/LOCAL_VERIFICATION_CHECKLIST.md for what each step proves.
. "$PSScriptRoot\_common.ps1"
Set-Location (Get-RepoRoot)

$steps = @(
    @{ Name = "Format check"; Command = "pnpm"; Args = @("run", "format:check") },
    @{ Name = "Lint"; Command = "pnpm"; Args = @("run", "lint") },
    @{ Name = "Typecheck"; Command = "pnpm"; Args = @("run", "typecheck") },
    @{ Name = "Unit tests"; Command = "pnpm"; Args = @("run", "test:unit") },
    @{ Name = "Integration tests"; Command = "pnpm"; Args = @("--filter", "@ventureos/api", "test:integration") },
    @{ Name = "Production build"; Command = "pnpm"; Args = @("run", "build") }
)

$results = @()

foreach ($step in $steps) {
    Write-Step $step.Name
    cmd /c "$($step.Command) $($step.Args -join ' ')"
    $exitCode = $LASTEXITCODE
    if ($exitCode -eq 0) {
        Write-Pass "$($step.Name) passed"
        $results += [PSCustomObject]@{ Step = $step.Name; Result = "PASS" }
    } else {
        Write-Fail "$($step.Name) failed (exit code $exitCode) — see the real error output above."
        $results += [PSCustomObject]@{ Step = $step.Name; Result = "FAIL" }
        Write-Host ""
        Write-Host "Validation stopped at: $($step.Name)" -ForegroundColor Red
        Write-Host ""
        $results | Format-Table -AutoSize
        exit $exitCode
    }
}

Write-Host ""
Write-Host "All validation steps passed." -ForegroundColor Green
$results | Format-Table -AutoSize
