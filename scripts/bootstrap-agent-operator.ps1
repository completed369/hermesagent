[CmdletBinding()]
param(
  [string]$ProductRepo = 'completed369/hermesagent',
  [string]$OpsRepo = 'completed369/ventureos-ops',
  [string]$EnvironmentName = 'public-command-center',
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

function Set-GhEnvironmentSecretFromString {
  param(
    [Parameter(Mandatory = $true)]
    [string]$Name,
    [Parameter(Mandatory = $true)]
    [string]$Value
  )

  $Value | & gh secret set $Name --repo $ProductRepo --env $EnvironmentName
  if ($LASTEXITCODE -ne 0) {
    throw "Failed to set environment secret $Name"
  }
}

function Set-GhEnvironmentSecretFromSecureString {
  param(
    [Parameter(Mandatory = $true)]
    [string]$Name,
    [Parameter(Mandatory = $true)]
    [Security.SecureString]$Value
  )

  $bstr = [Runtime.InteropServices.Marshal]::SecureStringToBSTR($Value)
  try {
    $plain = [Runtime.InteropServices.Marshal]::PtrToStringBSTR($bstr)
    $plain | & gh secret set $Name --repo $ProductRepo --env $EnvironmentName
    if ($LASTEXITCODE -ne 0) {
      throw "Failed to set environment secret $Name"
    }
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
Write-Host "Deployment environment: $EnvironmentName"
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
  $repoJson = & gh repo view $OpsRepo --json nameWithOwner,isPrivate | ConvertFrom-Json
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

Write-Host ''
Write-Host "Creating/updating GitHub environment '$EnvironmentName'..."
$environmentPayload = @{
  deployment_branch_policy = @{
    protected_branches = $true
    custom_branch_policies = $false
  }
} | ConvertTo-Json -Depth 4 -Compress

$environmentPayload | & gh api `
  --method PUT `
  "repos/$ProductRepo/environments/$EnvironmentName" `
  --input - | Out-Null
if ($LASTEXITCODE -ne 0) {
  throw "Failed to create/update GitHub environment $EnvironmentName."
}

Write-Host 'Restricting automatic progress deployment until bootstrap verification is complete...'
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
  Write-Host 'Cloudflare credential setup'
  Write-Host 'Use a token scoped only to Account -> Workers Scripts Write for this first phase.'
  Write-Host 'Do not paste the token into chat, GitHub issues, documentation, or command history.'

  $accountId = Read-Host 'Cloudflare Account ID'
  if ([string]::IsNullOrWhiteSpace($accountId)) {
    throw 'Cloudflare Account ID cannot be empty.'
  }

  $token = Read-Host 'Cloudflare API token (input hidden)' -AsSecureString

  Set-GhEnvironmentSecretFromString -Name 'CLOUDFLARE_ACCOUNT_ID' -Value $accountId.Trim()
  Set-GhEnvironmentSecretFromSecureString -Name 'CLOUDFLARE_API_TOKEN' -Value $token

  Remove-Variable token -ErrorAction SilentlyContinue
  Remove-Variable accountId -ErrorAction SilentlyContinue
  Write-Host 'Cloudflare environment secret names were configured.'
}
else {
  Write-Host ''
  Write-Host 'Cloudflare secrets were not configured.'
  Write-Host 'Re-run this script later with -ConfigureCloudflareSecrets after creating the scoped token.'
}

Write-Host ''
Write-Host 'Verifying non-secret bootstrap state...'
Invoke-GhChecked -Arguments @('repo', 'view', $OpsRepo, '--json', 'nameWithOwner,isPrivate,url')
Invoke-GhChecked -Arguments @(
  'variable',
  'get',
  'VENTUREOS_PROGRESS_DEPLOY_ENABLED',
  '--repo',
  $ProductRepo
)

Write-Host ''
Write-Host "Environment secret names currently configured for '$EnvironmentName':"
& gh secret list --repo $ProductRepo --env $EnvironmentName
if ($LASTEXITCODE -ne 0) {
  throw "Failed to list environment secret names for $EnvironmentName."
}

Write-Host ''
Write-Host 'BOOTSTRAP_RESULT=PASS'
Write-Host 'Automatic progress deployment remains disabled.'
Write-Host 'No DNS, Cloudflare Access, VPS, private-staging, production, provider, or spending change was performed.'
