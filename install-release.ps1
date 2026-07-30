[CmdletBinding()]
param(
  [string]$Version = "latest",
  [ValidateSet("gtrace", "otlp", "otel")][string]$Type = "gtrace",
  [string]$Endpoint,
  [string]$XToken,
  [string]$TracePath,
  [string]$MetricsPath,
  [string[]]$Header = @(),
  [string[]]$Tag = @(),
  [string]$CaptureContent,
  [switch]$EnableScript,
  [switch]$DisableScript,
  [string]$ConfigFile,
  [string]$OpenCodeConfig,
  [string]$PluginDir,
  [switch]$NoConfig
)

Set-StrictMode -Version Latest
$ErrorActionPreference = "Stop"

$Repo = if ($env:OPENCODE_OTEL_REPO) { $env:OPENCODE_OTEL_REPO } else { "GuanceCloud/opencode-otel-plugin" }
$ReleaseAssetName = if ($env:OPENCODE_OTEL_RELEASE_ASSET_NAME) { $env:OPENCODE_OTEL_RELEASE_ASSET_NAME } else { "opencode-otel-plugin.tar.gz" }
$ArchiveUrl = $env:OPENCODE_OTEL_ARCHIVE_URL

function Resolve-ReleaseRef([string]$InputVersion) {
  if ([string]::IsNullOrWhiteSpace($InputVersion) -or $InputVersion -eq "latest") { return "latest" }
  if ($InputVersion.StartsWith("v")) { return $InputVersion }
  return "v$InputVersion"
}

function Get-ArchiveUrl([string]$Ref) {
  if ($Ref -eq "latest") {
    return "https://github.com/$Repo/releases/latest/download/$ReleaseAssetName"
  }
  return "https://github.com/$Repo/releases/download/$Ref/$ReleaseAssetName"
}

function Require-Command([string]$Name) {
  if (-not (Get-Command $Name -ErrorAction SilentlyContinue)) {
    throw "Missing required command: $Name"
  }
}

Require-Command tar

$ResolvedVersion = Resolve-ReleaseRef $Version
if (-not $ArchiveUrl) {
  $ArchiveUrl = Get-ArchiveUrl $ResolvedVersion
}

$TempRoot = Join-Path ([IO.Path]::GetTempPath()) ("opencode-otel-" + [Guid]::NewGuid().ToString("N"))
$ArchivePath = Join-Path $TempRoot "opencode-otel-plugin.tar.gz"
$RepoPath = Join-Path $TempRoot "repo"
[IO.Directory]::CreateDirectory($RepoPath) | Out-Null

try {
  Write-Host "Downloading $ArchiveUrl"
  Invoke-WebRequest -Uri $ArchiveUrl -OutFile $ArchivePath

  Write-Host "Installing plugin from temporary archive"
  tar -xzf $ArchivePath -C $RepoPath
  if ($LASTEXITCODE -ne 0) {
    throw "Failed to extract release archive with tar."
  }

  $InstallScript = Join-Path $RepoPath "scripts\install.ps1"
  if (-not (Test-Path -LiteralPath $InstallScript -PathType Leaf)) {
    throw "Cannot find install script in extracted archive: $InstallScript"
  }

  $params = @{
    Type = $Type
  }
  if ($PSBoundParameters.ContainsKey("Endpoint")) { $params.Endpoint = $Endpoint }
  if ($PSBoundParameters.ContainsKey("XToken")) { $params.XToken = $XToken }
  if ($PSBoundParameters.ContainsKey("TracePath")) { $params.TracePath = $TracePath }
  if ($PSBoundParameters.ContainsKey("MetricsPath")) { $params.MetricsPath = $MetricsPath }
  if ($Header.Count -gt 0) { $params.Header = $Header }
  if ($Tag.Count -gt 0) { $params.Tag = $Tag }
  if ($PSBoundParameters.ContainsKey("CaptureContent")) { $params.CaptureContent = $CaptureContent }
  if ($EnableScript) { $params.EnableScript = $true }
  if ($DisableScript) { $params.DisableScript = $true }
  if ($PSBoundParameters.ContainsKey("ConfigFile")) { $params.ConfigFile = $ConfigFile }
  if ($PSBoundParameters.ContainsKey("OpenCodeConfig")) { $params.OpenCodeConfig = $OpenCodeConfig }
  if ($PSBoundParameters.ContainsKey("PluginDir")) { $params.PluginDir = $PluginDir }
  if ($NoConfig) { $params.NoConfig = $true }

  & $InstallScript @params
} finally {
  if (Test-Path -LiteralPath $TempRoot) {
    Remove-Item -LiteralPath $TempRoot -Recurse -Force
  }
}
