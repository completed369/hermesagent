[CmdletBinding()]
param(
  [string]$ProductRepo = 'completed369/hermesagent',
  [string]$OpsRepo = 'completed369/ventureos-ops',
  [string]$ProductEnvironmentName = 'public-command-center',
  [switch]$ConfigureCloudflareSecrets
)

$ErrorActionPreference = 'Stop'
Set-StrictMode -Version Latest

function Invoke-GhChecked {
  param(
    [Parameter(Mandatory = $true)]
    [string[]]$Arguments
  )

  & gh @Arguments
  if ($LASTEXITCODE -ne 0) {
    throw "gh command failed: gh $($Arguments -join ' ')"
  }
}

function Test-GhRepoExists {
  param(
    [Parameter(Mandatory = $true)]
    [string]$Repository
  )

  & gh repo view $Repository --json nameWithOwner,isPrivate 2>$null | Out-Null
  return $LASTEXITCODE -eq 0
}

function Set-GhRepositorySecretExact {
  param(
    [Parameter(Mandatory = $true)]
    [string]$Repository,
    [Parameter(Mandatory = $true)]
    [string]$Name,
    [Parameter(Mandatory = $true)]
    [string]$Value
  )

  $ghCommand = Get-Command gh -ErrorAction Stop
  $startInfo = New-Object System.Diagnostics.ProcessStartInfo
  $startInfo.FileName = $ghCommand.Source
  $startInfo.Arguments = "secret set $Name --repo $Repository"
  $startInfo.UseShellExecute = $false
  $startInfo.RedirectStandardInput = $true
  $startInfo.RedirectStandardOutput = $true
  $startInfo.RedirectStandardError = $true
  $startInfo.CreateNoWindow = $true

  $process = New-Object System.Diagnostics.Process
  $process.StartInfo = $startInfo

  try {
    if (-not $process.Start()) {
      throw "Failed to start gh while setting repository secret $Name."
    }

    # Write, rather than WriteLine, so the secret is stored byte-for-byte without a trailing newline.
    $process.StandardInput.Write($Value)
    $process.StandardInput.Close()
    $process.WaitForExit()

    $stdout = $process.StandardOutput.ReadToEnd()
    $stderr = $process.StandardError.ReadToEnd()

    if ($process.ExitCode -ne 0) {
      throw "Failed to set repository secret $Name. gh stderr: $stderr"
    }

    # gh normally emits no secret value. Suppress stdout defensively rather than relaying it.
    $null = $stdout
  }
  finally {
    $process.Dispose()
  }
}

function Set-GhRepositorySecretFromSecureString {
  param(
    [Parameter(Mandatory = $true)]
    [string]$Repository,
    [Parameter(Mandatory = $true)]
    [string]$Name,
    [Parameter(Mandatory = $true)]
    [Security.SecureString]$Value
  )

  $bstr = [Runtime.InteropServices.Marshal]::SecureStringToBSTR($Value)
  try {
    $plain = [Runtime.InteropServices.Marshal]::PtrToStringBSTR($bstr)
    Set-GhRepositorySecretExact -Repository $Repository -Name $Name -Value $plain
  }
  finally {
    if ($null -ne $bstr -and $bstr -ne [IntPtr]::Zero) {
      [Runtime.InteropServices.Marshal]::ZeroFreeBSTR($bstr)
    }
    Remove-Variable plain -ErrorAction SilentlyContinue
  }
}

Write-Host '=== VentureOS Agent Operator Bootstrap ==='
Write-Host "Product repository: $ProductRepo"
Write-Host "Private operations repository: $OpsRepo"
Write-Host "Public fallback environment: $ProductEnvironmentName"
Write-Host ''

if (-not (Get-Command gh -ErrorAction SilentlyContinue)) {
  throw 'GitHub CLI (gh) is required but was not found in PATH.'
}

Write-Host 'Checking GitHub authentication...'
Invoke-GhChecked -Arguments @('auth', 'status')

$currentLogin = (& gh api user --jq '.login').Trim()
if ($LASTEXITCODE -ne 0 -or [string]::IsNullOrWhiteSpace($currentLogin)) {
  throw 'Could not resolve the authenticated GitHub account.'
}

$expectedOwner = $OpsRepo.Split('/')[0]
if ($currentLogin -ne $expectedOwner) {
  throw "Authenticated GitHub user '$currentLogin' does not match expected owner '$expectedOwner'."
}

Write-Host ''
Write-Host 'Creating private operations repository if needed...'
if (Test-GhRepoExists -Repository $OpsRepo) {
  $repoJson = & gh repo view $OpsRepo --json nameWithOwner,isPrivate,defaultBranchRef | ConvertFrom-Json
  if (-not $repoJson.isPrivate) {
    throw "$OpsRepo already exists but is not private. Stop before storing confidential material."
  }
  Write-Host "$OpsRepo already exists and is private."
}
else {
  Invoke-GhChecked -Arguments @(
    'repo',
    'create',
    $OpsRepo,
    '--private',
    '--description',
    'Private VentureOS founder command center and operator state',
    '--add-readme'
  )
  Write-Host "Created private repository $OpsRepo."
}

$opsRepoJson = & gh repo view $OpsRepo --json nameWithOwner,isPrivate,defaultBranchRef,url | ConvertFrom-Json
if (-not $opsRepoJson.isPrivate) {
  throw "$OpsRepo is not private. Stop before storing confidential material."
}

if ($null -eq $opsRepoJson.defaultBranchRef -or $opsRepoJson.defaultBranchRef.name -ne 'main') {
  $currentDefaultBranch = $opsRepoJson.defaultBranchRef.name
  if ([string]::IsNullOrWhiteSpace($currentDefaultBranch)) {
    throw "$OpsRepo does not have an initialized default branch."
  }

  Write-Host "Renaming private operations default branch '$currentDefaultBranch' to 'main'..."
  Invoke-GhChecked -Arguments @(
    'api',
    '--method',
    'POST',
    "repos/$OpsRepo/branches/$currentDefaultBranch/rename",
    '-f',
    'new_name=main'
  )
}

Write-Host ''
Write-Host "Creating/updating secretless public fallback environment '$ProductEnvironmentName'..."
$productEnvironmentPayload = @{
  deployment_branch_policy = @{
    protected_branches = $true
    custom_branch_policies = $false
  }
} | ConvertTo-Json -Depth 4 -Compress

$productEnvironmentPayload | & gh api `
  --method PUT `
  "repos/$ProductRepo/environments/$ProductEnvironmentName" `
  --input - | Out-Null
if ($LASTEXITCODE -ne 0) {
  throw "Failed to create/update GitHub environment $ProductEnvironmentName."
}

Write-Host 'Keeping the public-repository progress deployment disabled...'
Invoke-GhChecked -Arguments @(
  'variable',
  'set',
  'VENTUREOS_PROGRESS_DEPLOY_ENABLED',
  '--repo',
  $ProductRepo,
  '--body',
  'false'
)

if ($ConfigureCloudflareSecrets) {
  Write-Host ''
  Write-Host 'Cloudflare credential setup for the PRIVATE operations repository'
  Write-Host 'Use a token scoped only to Account -> Workers Scripts Write for this first phase.'
  Write-Host 'Do not paste the token into chat, GitHub issues, documentation, or command history.'

  $accountId = Read-Host 'Cloudflare Account ID'
  if ([string]::IsNullOrWhiteSpace($accountId)) {
    throw 'Cloudflare Account ID cannot be empty.'
  }

  $token = Read-Host 'Cloudflare API token (input hidden)' -AsSecureString

  Set-GhRepositorySecretExact `
    -Repository $OpsRepo `
    -Name 'CLOUDFLARE_ACCOUNT_ID' `
    -Value $accountId.Trim()
  Set-GhRepositorySecretFromSecureString `
    -Repository $OpsRepo `
    -Name 'CLOUDFLARE_API_TOKEN' `
    -Value $token

  Remove-Variable token -ErrorAction SilentlyContinue
  Remove-Variable accountId -ErrorAction SilentlyContinue
  Write-Host 'Cloudflare Actions secret names were configured in the private operations repository.'
}
else {
  Write-Host ''
  Write-Host 'Cloudflare secrets were not configured.'
  Write-Host 'Re-run this script later with -ConfigureCloudflareSecrets after creating the scoped token.'
}

Write-Host ''
Write-Host 'Verifying non-secret bootstrap state...'
Invoke-GhChecked -Arguments @('repo', 'view', $OpsRepo, '--json', 'nameWithOwner,isPrivate,defaultBranchRef,url')
Invoke-GhChecked -Arguments @(
  'variable',
  'get',
  'VENTUREOS_PROGRESS_DEPLOY_ENABLED',
  '--repo',
  $ProductRepo
)

Write-Host ''
Write-Host "Actions secret names currently configured in PRIVATE repo '$OpsRepo':"
& gh secret list --repo $OpsRepo
if ($LASTEXITCODE -ne 0) {
  throw "Failed to list Actions secret names for $OpsRepo."
}

Write-Host ''
Write-Host "Public fallback environment secret names in '$ProductRepo' (should remain empty):"
& gh secret list --repo $ProductRepo --env $ProductEnvironmentName
if ($LASTEXITCODE -ne 0) {
  throw "Failed to list environment secret names for $ProductEnvironmentName."
}

Write-Host ''
Write-Host 'BOOTSTRAP_RESULT=PASS'
Write-Host 'Public-repository automatic progress deployment remains disabled.'
Write-Host 'Cloudflare deployment credentials, when configured, exist only in the private operations repository.'
Write-Host 'No DNS, Cloudflare Access, VPS, private-staging, production, provider, or spending change was performed.'
