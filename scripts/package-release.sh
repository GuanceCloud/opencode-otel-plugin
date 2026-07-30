#!/usr/bin/env bash
set -euo pipefail

REPO_ROOT="${REPO_ROOT:-$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)}"
OUTPUT_DIR="${1:-$REPO_ROOT/release-assets}"
STAGE_DIR="$(mktemp -d)"
trap 'rm -rf "$STAGE_DIR"' EXIT

mkdir -p "$OUTPUT_DIR"

cd "$REPO_ROOT"
npm run check
npm test
npm run build

RUNTIME_DIR="$STAGE_DIR/opencode-otel-plugin"
mkdir -p "$RUNTIME_DIR/scripts"

cp -R "$REPO_ROOT/dist" "$RUNTIME_DIR/dist"
cp "$REPO_ROOT/package.json" "$RUNTIME_DIR/package.json"
cp "$REPO_ROOT/package-lock.json" "$RUNTIME_DIR/package-lock.json"
cp "$REPO_ROOT/README.md" "$RUNTIME_DIR/README.md"
cp "$REPO_ROOT/LICENSE" "$RUNTIME_DIR/LICENSE"
cp "$REPO_ROOT/install-release.sh" "$OUTPUT_DIR/install-release.sh"
cp "$REPO_ROOT/scripts/install.sh" "$RUNTIME_DIR/scripts/install.sh"
cp "$REPO_ROOT/scripts/install-config.mjs" "$RUNTIME_DIR/scripts/install-config.mjs"

tar -czf "$OUTPUT_DIR/opencode-otel-plugin.tar.gz" -C "$RUNTIME_DIR" .

printf 'Wrote release assets:\n'
printf '  %s\n' "$OUTPUT_DIR/install-release.sh"
printf '  %s\n' "$OUTPUT_DIR/opencode-otel-plugin.tar.gz"
