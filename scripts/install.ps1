[CmdletBinding()]
param(
  [ValidateSet("gtrace", "otlp", "otel")][string]$Type = "gtrace",
  [string]$Endpoint,
  [string]$XToken,
  [string]$TracePath,
  [string]$MetricsPath,
  [string[]]$Header = @(),
  [string[]]$Tag = @(),
  [string]$CaptureContent = "preview",
  [string]$ConfigFile,
  [string]$OpenCodeConfig,
  [string]$PluginDir,
  [switch]$EnableScript,
  [switch]$DisableScript,
  [switch]$NoConfig
)

Set-StrictMode -Version Latest
$ErrorActionPreference = "Stop"

function Write-InstallLog([string]$Message) {
  Write-Host "[install] $Message"
}

function Remove-PathIfPresent([string]$Path) {
  if (Test-Path -LiteralPath $Path) {
    Remove-Item -LiteralPath $Path -Recurse -Force
  }
}

function Resolve-Node {
  $command = Get-Command node -ErrorAction SilentlyContinue
  if ($command) { return $command.Source }

  $candidates = @(
    (Join-Path $env:ProgramFiles "nodejs\node.exe"),
    (Join-Path ${env:ProgramFiles(x86)} "nodejs\node.exe"),
    (Join-Path $env:LOCALAPPDATA "Programs\nodejs\node.exe")
  ) | Where-Object { $_ }

  foreach ($candidate in $candidates) {
    if (Test-Path -LiteralPath $candidate -PathType Leaf) { return $candidate }
  }

  throw "Missing required command: node"
}

function Test-NodeVersion([string]$NodeBin) {
  $version = (& $NodeBin -p "Number(process.versions.node.split('.' )[0])" 2>$null | Out-String).Trim()
  if (-not $version -or [int]$version -lt 20) {
    $raw = (& $NodeBin --version 2>$null | Out-String).Trim()
    throw "Node.js >= 20 is required. Found: $raw at $NodeBin"
  }
}

$RepoRoot = if ($env:REPO_ROOT) { $env:REPO_ROOT } else { Split-Path -Parent $PSScriptRoot }
$OpenCodeHome = if ($env:OPENCODE_HOME) { $env:OPENCODE_HOME } else { Join-Path $env:USERPROFILE ".config\opencode" }
if (-not $OpenCodeConfig) {
  $OpenCodeConfig = if ($env:OPENCODE_CONFIG_FILE) { $env:OPENCODE_CONFIG_FILE } else { Join-Path $OpenCodeHome "opencode.json" }
}
if (-not $ConfigFile) {
  $ConfigFile = if ($env:GTRACE_CONFIG_FILE) { $env:GTRACE_CONFIG_FILE } else { Join-Path $OpenCodeHome "gtrace.json" }
}
if (-not $PluginDir) {
  $PluginDir = Join-Path $OpenCodeHome "plugins\opencode-otel-plugin"
}
if (-not $Endpoint) { $Endpoint = if ($env:GTRACE_ENDPOINT) { $env:GTRACE_ENDPOINT } else { $env:OPENCODE_OTEL_ENDPOINT } }
if (-not $XToken) { $XToken = if ($env:GTRACE_X_TOKEN) { $env:GTRACE_X_TOKEN } else { $env:X_TOKEN } }
if (-not $TracePath) { $TracePath = if ($env:GTRACE_TRACE_PATH) { $env:GTRACE_TRACE_PATH } else { $env:OPENCODE_OTEL_TRACE_PATH } }
if (-not $MetricsPath) { $MetricsPath = if ($env:GTRACE_METRICS_PATH) { $env:GTRACE_METRICS_PATH } else { $env:OPENCODE_OTEL_METRICS_PATH } }
if ($Type -eq "otel") { $Type = "otlp" }

$DistPath = Join-Path $RepoRoot "dist\index.js"
$PackagePath = Join-Path $RepoRoot "package.json"
$NodeModulesPath = Join-Path $RepoRoot "node_modules"
$ConfigHelper = Join-Path $RepoRoot "scripts\install-config.mjs"

if (-not (Test-Path -LiteralPath $DistPath -PathType Leaf)) { throw "Cannot find $DistPath" }
if (-not (Test-Path -LiteralPath $PackagePath -PathType Leaf)) { throw "Cannot find $PackagePath" }
if (-not (Test-Path -LiteralPath $NodeModulesPath -PathType Container)) {
  throw "Cannot find prepackaged runtime dependencies under $NodeModulesPath. Rebuild the release package first."
}
if (-not (Test-Path -LiteralPath $ConfigHelper -PathType Leaf)) { throw "Cannot find $ConfigHelper" }

$NodeBin = Resolve-Node
Test-NodeVersion $NodeBin

$ConfigAlreadyExists = Test-Path -LiteralPath $ConfigFile -PathType Leaf
if (-not $TracePath -and ($Endpoint -or -not $ConfigAlreadyExists)) {
  $TracePath = if ($Type -eq "gtrace") { "v1/write/otel-llm" } else { "otel/v1/traces" }
}
if (-not $MetricsPath -and ($Endpoint -or -not $ConfigAlreadyExists)) {
  $MetricsPath = if ($Type -eq "gtrace") { "v1/write/otel-metrics" } else { "otel/v1/metrics" }
}

[IO.Directory]::CreateDirectory($PluginDir) | Out-Null
Remove-PathIfPresent (Join-Path $PluginDir "dist")
Remove-PathIfPresent (Join-Path $PluginDir "node_modules")
Copy-Item -LiteralPath (Join-Path $RepoRoot "dist") -Destination (Join-Path $PluginDir "dist") -Recurse
Copy-Item -LiteralPath $NodeModulesPath -Destination (Join-Path $PluginDir "node_modules") -Recurse
Copy-Item -LiteralPath $PackagePath -Destination (Join-Path $PluginDir "package.json")
if (Test-Path -LiteralPath (Join-Path $RepoRoot "package-lock.json") -PathType Leaf) {
  Copy-Item -LiteralPath (Join-Path $RepoRoot "package-lock.json") -Destination (Join-Path $PluginDir "package-lock.json")
}
if (Test-Path -LiteralPath (Join-Path $RepoRoot "README.md") -PathType Leaf) {
  Copy-Item -LiteralPath (Join-Path $RepoRoot "README.md") -Destination (Join-Path $PluginDir "README.md")
}
if (Test-Path -LiteralPath (Join-Path $RepoRoot "LICENSE") -PathType Leaf) {
  Copy-Item -LiteralPath (Join-Path $RepoRoot "LICENSE") -Destination (Join-Path $PluginDir "LICENSE")
}
Write-InstallLog "installed plugin files: $PluginDir"

if (-not $NoConfig) {
  $env:OPENCODE_CONFIG_FILE_RUNTIME = $OpenCodeConfig
  $env:OPENCODE_PLUGIN_URL_RUNTIME = $PluginDir
  $env:OPENCODE_PLUGIN_NAME_RUNTIME = "opencode-otel-plugin"
  $env:OPENCODE_CAPTURE_CONTENT_RUNTIME = $CaptureContent
  & $NodeBin $ConfigHelper write-opencode-config
  if ($LASTEXITCODE -ne 0) { throw "Failed to update $OpenCodeConfig" }
  Write-InstallLog "updated OpenCode config: $OpenCodeConfig"

  $ScriptEnabled = if ($EnableScript) { "true" } elseif ($DisableScript) { "false" } else { "" }
  if ($Endpoint -or (Test-Path -LiteralPath $ConfigFile) -or $ScriptEnabled) {
    $env:GTRACE_CONFIG_FILE_RUNTIME = $ConfigFile
    $env:GTRACE_ENDPOINT_RUNTIME = $Endpoint
    $env:GTRACE_TRACE_PATH_RUNTIME = $TracePath
    $env:GTRACE_METRICS_PATH_RUNTIME = $MetricsPath
    $env:GTRACE_INSTALL_TYPE_RUNTIME = $Type
    $env:GTRACE_X_TOKEN_RUNTIME = $XToken
    $env:GTRACE_SCRIPT_ENABLED_RUNTIME = $ScriptEnabled
    $env:GTRACE_TAGS_RUNTIME = ConvertTo-Json -InputObject @($Tag) -Compress
    $env:GTRACE_HEADERS_RUNTIME = ConvertTo-Json -InputObject @($Header) -Compress
    & $NodeBin $ConfigHelper write-gtrace-config
    if ($LASTEXITCODE -ne 0) { throw "Failed to update $ConfigFile" }
    Write-InstallLog "updated gtrace config: $ConfigFile"
    if ($Endpoint) { Write-InstallLog "configured endpoint: $Endpoint" }
    if ($TracePath) { Write-InstallLog "configured trace path: $TracePath" }
    if ($MetricsPath) { Write-InstallLog "configured metrics path: $MetricsPath" }
    if ($XToken) { Write-InstallLog "configured X-Token: <redacted>" }
  } else {
    Write-InstallLog "skipped gtrace config because -Endpoint was not provided"
  }
} else {
  Write-InstallLog "skipped config because -NoConfig was set"
}

Write-Host ""
Write-Host "OpenCode plugin install complete."
Write-Host ""
Write-Host "Installed plugin directory:"
Write-Host "  $PluginDir"
Write-Host ""
Write-Host "Next steps:"
Write-Host "  1. Restart OpenCode"
Write-Host "  2. Run one conversation"
Write-Host "  3. Check ~/.config/opencode/gtrace-hook.log for:"
Write-Host "     - uploaded spans"
Write-Host "     - uploaded metrics"
