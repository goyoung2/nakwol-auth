param(
  [Parameter(Mandatory=$true)][string]$Profile,
  [Parameter(Mandatory=$true)][string]$Wrangler,
  [switch]$PlanOnly
)
$ErrorActionPreference = 'Stop'
$taskRoot = Split-Path $PSScriptRoot -Parent
$taskProfile = Get-Content -LiteralPath $Profile -Raw | ConvertFrom-Json
$taskUpload = Join-Path $taskRoot 'deploy/vercel-auth-production'
$taskProject = Get-Content -LiteralPath (Join-Path $taskUpload '.vercel/project.json') -Raw | ConvertFrom-Json
if ($taskProfile.databaseName -ne 'nakwol-auth' -or $taskProfile.worker -ne 'nakwol-auth' -or
    $taskProfile.vercelProjectName -ne 'nakwol-auth-vercel' -or
    $taskProject.projectId -ne $taskProfile.vercelProjectId -or
    $taskProject.orgId -ne $taskProfile.vercelTeamId) { throw 'Production target mismatch. No secret was requested or registered.' }
$taskConfig = Join-Path (Split-Path $Profile -Parent) 'readonly.wrangler.json'
$taskBinding = Get-Content -LiteralPath $taskConfig -Raw | ConvertFrom-Json
if ($taskBinding.account_id -ne $taskProfile.accountId -or $taskBinding.d1_databases[0].database_id -ne $taskProfile.databaseId) { throw 'Cloudflare target mismatch.' }
if ($PlanOnly) {
  [pscustomobject]@{ operation='Register one new Discord Secret in existing Worker then Vercel Production'; targetVerified=$true; schemaReady=(@($taskProfile.missingSchema).Count -eq 0); secretRequested=$false; productionDeploymentStillRequired=$true }
  return
}
$taskBranch = & git -C $taskRoot branch --show-current
if ($taskBranch -ne 'stable') { throw 'Promote the reviewed source to stable before registering an operational credential.' }
if (@($taskProfile.missingSchema).Count -ne 0) { throw 'Required production schema is missing. Finish preflight before resetting Discord Secret.' }
$taskChecked = [DateTimeOffset]::Parse($taskProfile.checkedAt)
if (($taskChecked -gt [DateTimeOffset]::UtcNow.AddMinutes(1)) -or ($taskChecked -lt [DateTimeOffset]::UtcNow.AddHours(-1))) { throw 'Refresh the read-only production profile first.' }
Write-Host 'Use the EXISTING Discord application. Paste its newly generated Client Secret here; input is hidden.'
$taskSecure = Read-Host -Prompt 'New Discord Client Secret' -AsSecureString
$taskBstr = [Runtime.InteropServices.Marshal]::SecureStringToBSTR($taskSecure)
$taskPreviousAccount = $env:CLOUDFLARE_ACCOUNT_ID
try {
  $taskSecret = [Runtime.InteropServices.Marshal]::PtrToStringBSTR($taskBstr)
  if ([string]::IsNullOrWhiteSpace($taskSecret) -or $taskSecret.Contains("`n") -or $taskSecret.Contains("`r")) { throw 'Invalid Secret input.' }
  $env:CLOUDFLARE_ACCOUNT_ID = $taskProfile.accountId
  $taskPreviousErrorAction = $ErrorActionPreference
  try {
    $ErrorActionPreference = 'Continue'
    $taskRegisterOutput = $taskSecret | & node (Join-Path $PSScriptRoot 'register-production-secret.mjs') --profile $Profile --wrangler $Wrangler --secret-name DISCORD_CLIENT_SECRET 2>&1
  } finally { $ErrorActionPreference = $taskPreviousErrorAction }
  if ($LASTEXITCODE -ne 0) {
    if ($taskRegisterOutput -match 'VERCEL_SECRET_REGISTRATION_FAILED_KEEP_NEW_CLOUDFLARE_SECRET') { throw 'Cloudflare has the new Secret, but Vercel registration failed. Retry with the SAME value; do not reset Discord again.' }
    throw 'Cloudflare Secret registration failed. No Vercel credential write was attempted.'
  }
  Write-Host 'Both server Secret stores updated. Vercel must be redeployed and real login verified before switching services.'
} finally {
  $taskSecret = $null
  $taskRegisterOutput = $null
  $env:CLOUDFLARE_ACCOUNT_ID = $taskPreviousAccount
  [Runtime.InteropServices.Marshal]::ZeroFreeBSTR($taskBstr)
  $taskSecure.Dispose()
}
