# Changelog

All notable changes to this project will be documented in this file.

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
