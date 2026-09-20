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
cp -R "$REPO_ROOT/node_modules" "$RUNTIME_DIR/node_modules"
cp "$REPO_ROOT/package.json" "$RUNTIME_DIR/package.json"
cp "$REPO_ROOT/package-lock.json" "$RUNTIME_DIR/package-lock.json"
cp "$REPO_ROOT/README.md" "$RUNTIME_DIR/README.md"
cp "$REPO_ROOT/LICENSE" "$RUNTIME_DIR/LICENSE"
cp "$REPO_ROOT/install-release.sh" "$OUTPUT_DIR/install-release.sh"
cp "$REPO_ROOT/install-release.ps1" "$OUTPUT_DIR/install-release.ps1"
cp "$REPO_ROOT/scripts/install.sh" "$RUNTIME_DIR/scripts/install.sh"
cp "$REPO_ROOT/scripts/install.ps1" "$RUNTIME_DIR/scripts/install.ps1"
cp "$REPO_ROOT/scripts/install-config.mjs" "$RUNTIME_DIR/scripts/install-config.mjs"

(cd "$RUNTIME_DIR" && npm prune --omit=dev --ignore-scripts >/dev/null)
find "$RUNTIME_DIR/node_modules" -type d -name '.vite' -prune -exec rm -rf -- {} +
find "$RUNTIME_DIR/node_modules" -type d -empty -delete

# Production package command shims are not used by the runtime. npm creates
# them as Unix symlinks, which Windows tar.exe cannot reliably extract without
# symlink privileges. Keep the release archive regular-file-only.
rm -rf "$RUNTIME_DIR/node_modules/.bin"

if find "$RUNTIME_DIR" -type l -print -quit | grep -q .; then
  echo "Release staging directory contains symbolic links:" >&2
  find "$RUNTIME_DIR" -type l -print >&2
  exit 1
fi

ARCHIVE_PATH="$OUTPUT_DIR/opencode-otel-plugin.tar.gz"
COPYFILE_DISABLE=1 tar --format=ustar -czf "$ARCHIVE_PATH" -C "$RUNTIME_DIR" .

if tar -tvzf "$ARCHIVE_PATH" | awk 'substr($1, 1, 1) == "l" { found=1 } END { exit(found ? 0 : 1) }'; then
  echo "Release archive contains symbolic links" >&2
  exit 1
fi
if tar -tzf "$ARCHIVE_PATH" | grep -Eq '(^|/)(__MACOSX/|\._)'; then
  echo "Release archive contains macOS metadata" >&2
  exit 1
fi
if gzip -dc "$ARCHIVE_PATH" | grep -aEq 'LIBARCHIVE\.xattr|SCHILY\.xattr'; then
  echo "Release archive contains extended attributes" >&2
  exit 1
fi

VERSION="$(node -p 'require("./package.json").version')"
cp "$ARCHIVE_PATH" "$OUTPUT_DIR/opencode-otel-plugin-v$VERSION.tar.gz"
(
  cd "$OUTPUT_DIR"
  sha256sum opencode-otel-plugin.tar.gz > opencode-otel-plugin.tar.gz.sha256
  sha256sum "opencode-otel-plugin-v$VERSION.tar.gz" > "opencode-otel-plugin-v$VERSION.tar.gz.sha256"
  sha256sum install-release.sh install-release.ps1 opencode-otel-plugin.tar.gz \
    "opencode-otel-plugin-v$VERSION.tar.gz" \
    opencode-otel-plugin.tar.gz.sha256 "opencode-otel-plugin-v$VERSION.tar.gz.sha256" > SHA256SUMS
)

printf 'Wrote release assets:\n'
printf '  %s\n' "$OUTPUT_DIR/install-release.sh"
printf '  %s\n' "$OUTPUT_DIR/install-release.ps1"
printf '  %s\n' "$OUTPUT_DIR/opencode-otel-plugin.tar.gz"
