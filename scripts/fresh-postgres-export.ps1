$ErrorActionPreference = 'Stop'

function Read-MaskedText([string]$Prompt) {
  $secure = Read-Host $Prompt -AsSecureString
  $pointer = [Runtime.InteropServices.Marshal]::SecureStringToBSTR($secure)
  try {
    return [Runtime.InteropServices.Marshal]::PtrToStringBSTR($pointer)
  }
  finally {
    [Runtime.InteropServices.Marshal]::ZeroFreeBSTR($pointer)
    $secure.Dispose()
  }
}

function Restore-EnvironmentValue([string]$Name, $Value) {
  if ($null -eq $Value) { Remove-Item "Env:$Name" -ErrorAction SilentlyContinue }
  else { Set-Item "Env:$Name" $Value }
}

$requiredScript = Join-Path (Get-Location) 'scripts\freshPostgresExport.mjs'
if (-not (Test-Path .\package.json) -or -not (Test-Path $requiredScript)) {
  throw 'Run this script from the root of the UniInfo project.'
}
if (-not (Get-Command node -ErrorAction SilentlyContinue)) {
  throw 'Node.js was not found on PATH.'
}

$hostName = Read-Host 'PostgreSQL host from your provider Connect panel'
$port = Read-Host 'PostgreSQL port [5432]'
if ([string]::IsNullOrWhiteSpace($port)) { $port = '5432' }
$database = Read-Host 'Database name [postgres]'
if ([string]::IsNullOrWhiteSpace($database)) { $database = 'postgres' }
$username = Read-Host 'Database username from your provider Connect panel'
$caPath = Read-Host 'Full path to downloaded database root CA certificate'

if ([string]::IsNullOrWhiteSpace($hostName) -or [string]::IsNullOrWhiteSpace($username)) {
  throw 'Database host and username are required.'
}
if (-not (Test-Path $caPath -PathType Leaf)) {
  throw 'The CA certificate path does not exist. Download the root certificate from the database provider dashboard.'
}

$databasePassword = Read-MaskedText 'New database password (masked; not saved to a file)'
$exportKey = Read-MaskedText '64-character hexadecimal AES-256 backup key from your password manager (masked)'
if ($exportKey -notmatch '^[0-9a-fA-F]{64}$') {
  $databasePassword = $null
  $exportKey = $null
  throw 'The backup encryption key must be 64 hexadecimal characters. Generate one locally and store it in your password manager.'
}

$confirm = Read-Host "This is a read-only public-schema export from '$hostName' database '$database'. Type EXPORT to continue"
if ($confirm -cne 'EXPORT') {
  $databasePassword = $null
  $exportKey = $null
  Write-Host 'Export cancelled; no connection was made.'
  exit 2
}

$stamp = Get-Date -Format 'yyyyMMdd-HHmmss'
$outputDirectory = Join-Path $env:USERPROFILE "Backups\UniInfo\FreshExports\$stamp"
New-Item -ItemType Directory -Path $outputDirectory -Force | Out-Null

$envNames = @('PGHOST','PGPORT','PGDATABASE','PGUSER','PGPASSWORD','PGSSLMODE','PGSSLROOTCERT','FRESH_EXPORT_ENCRYPTION_KEY','FRESH_EXPORT_DIR')
$original = @{}
foreach ($name in $envNames) { $original[$name] = [Environment]::GetEnvironmentVariable($name, 'Process') }

try {
  $env:PGHOST = $hostName
  $env:PGPORT = $port
  $env:PGDATABASE = $database
  $env:PGUSER = $username
  $env:PGPASSWORD = $databasePassword
  $env:PGSSLMODE = 'verify-full'
  $env:PGSSLROOTCERT = (Resolve-Path $caPath).Path
  $env:FRESH_EXPORT_ENCRYPTION_KEY = $exportKey
  $env:FRESH_EXPORT_DIR = $outputDirectory

  node $requiredScript
  if ($LASTEXITCODE -ne 0) { throw "Fresh export helper failed with exit code $LASTEXITCODE." }
}
finally {
  foreach ($name in $envNames) { Restore-EnvironmentValue $name $original[$name] }
  $databasePassword = $null
  $exportKey = $null
  [GC]::Collect()
}
