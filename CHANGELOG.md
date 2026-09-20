# Changelog

All notable changes to this project will be documented in this file.

## [0.1.6] - 2026-09-20

### Security

- Replaced credential-like values in customer installation examples with explicit placeholders

### Changed

- Updated pinned-version installation examples for the current release
- Removed the type-only OpenCode SDK and development caches from the bundled runtime, reducing archive size and avoiding unrelated Node.js engine warnings during packaging

## [0.1.5] - 2026-09-08

### Fixed

- Prevented missing MCP values from causing telemetry serialization failures
- Isolated telemetry hook and diagnostic logger failures from OpenCode business execution

### Added

- Added regression coverage for missing MCP fields and hook failure isolation
- Added versioned archives and SHA-256 checksums to release assets

## [0.1.4] - 2026-07-30

### Added

- Windows PowerShell release installer: `install-release.ps1`
- Windows local installer: `scripts/install.ps1`

### Changed

- Added Windows installation examples to README and customer install documentation
- Included `install-release.ps1` in release assets

## [0.1.3] - 2026-07-30

### Changed

- Stopped running `npm ci` on customer machines during installation
- Bundled production runtime dependencies directly into the release archive
- Reduced installer sensitivity to host Node/npm dependency-engine warnings

### Documentation

- Clarified that runtime dependencies are prepackaged in the release asset
- Updated customer install guide to reference `v0.1.3`

## [0.1.2] - 2026-07-30

### Changed

- Simplified `README.md` into a shorter customer-facing overview
- Removed remaining Chinese text from repository files
- Kept release installation as the primary delivery path

### Documentation

- Updated customer install guide to reference `v0.1.2`

## [0.1.1] - 2026-07-30

### Added

- Release-based installer workflow for customer deployment
- `install-release.sh` for GitHub Release installation
- `scripts/install.sh` for local runtime installation into `~/.config/opencode`
- `scripts/install-config.mjs` for updating `opencode.json` and `gtrace.json`
- `scripts/package-release.sh` for generating release assets
- Customer-facing installation guide in `docs/install-customer.md`

### Changed

- Switched recommended installation method from Git source checkout to fixed release installer semantics
- Auto-configure `experimental.openTelemetry=false` during installation
- Auto-inject `To-Headless=true` for GTrace installs
- Simplified customer installation and upgrade flow to a single `curl | bash` command

## [0.1.0] - 2026-07-30

### Added

- Initial OpenCode OTel plugin release
- OTLP trace and metrics export for OpenCode hooks
- `gtrace.json` support under `~/.config/opencode`
- Minimal upload success/failure logging in `~/.config/opencode/gtrace-hook.log`
