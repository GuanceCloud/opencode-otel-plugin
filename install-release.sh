#!/usr/bin/env bash
set -euo pipefail

REPO="${OPENCODE_OTEL_REPO:-GuanceCloud/opencode-otel-plugin}"
REF="${OPENCODE_OTEL_VERSION:-${OPENCODE_OTEL_REF:-latest}}"
RELEASE_ASSET_NAME="${OPENCODE_OTEL_RELEASE_ASSET_NAME:-opencode-otel-plugin.tar.gz}"

latest_release_api_url() {
  printf 'https://api.github.com/repos/%s/releases/latest' "$REPO"
}

resolve_release_ref() {
  local ref="$1"
  if [[ "$ref" != "latest" ]]; then
    printf '%s' "$ref"
    return 0
  fi

  local api_url="${OPENCODE_OTEL_RELEASE_API_URL:-$(latest_release_api_url)}"
  local response
  local tag
  response="$(curl -fsSL -H 'Accept: application/vnd.github+json' "$api_url" 2>/dev/null || true)"
  if [[ -z "$response" ]]; then
    printf '%s' "latest"
    return 0
  fi
  tag="$(printf '%s' "$response" | sed -n 's/.*"tag_name"[[:space:]]*:[[:space:]]*"\([^"]*\)".*/\1/p')"
  if [[ -z "$tag" ]]; then
    printf '%s' "latest"
    return 0
  fi
  printf '%s' "$tag"
}

release_archive_url() {
  local ref="$1"
  if [[ "$ref" == "latest" ]]; then
    printf 'https://github.com/%s/releases/latest/download/%s' "$REPO" "$RELEASE_ASSET_NAME"
    return 0
  fi
  printf 'https://github.com/%s/releases/download/%s/%s' "$REPO" "$ref" "$RELEASE_ASSET_NAME"
}

RESOLVED_REF="${REF}"
ARCHIVE_URL="${OPENCODE_OTEL_ARCHIVE_URL:-}"

case "${1:-}" in
  -h|--help)
    cat <<HELP
Usage:
  install-release.sh [latest|vX.Y.Z|X.Y.Z] [install options]

Examples:
  curl -fsSL <installer-url> | bash -s -- latest --endpoint https://llm-openway.guance.com --x-token <token>
  curl -fsSL <installer-url> | bash -s -- v0.1.3 --endpoint https://llm-openway.guance.com --x-token <token> --tag agent_name=OpenCode

Install options are passed to scripts/install.sh:
  --type gtrace|otlp
  --endpoint URL
  --x-token TOKEN
  --trace-path PATH
  --metrics-path PATH
  --header KEY=VALUE
  --tag KEY=VALUE        Global resource attribute; can be repeated.
  --capture-content VALUE
  --enable-script
  --disable-script
  --config-file PATH
  --opencode-config PATH
  --plugin-dir PATH
  --no-config

Environment variables:
  OPENCODE_OTEL_REPO                GitHub repo. Default: GuanceCloud/opencode-otel-plugin
  OPENCODE_OTEL_VERSION             Release version. Default: latest
  OPENCODE_OTEL_RELEASE_ASSET_NAME  Release asset name. Default: opencode-otel-plugin.tar.gz
  OPENCODE_OTEL_RELEASE_API_URL     Override latest-release API endpoint.
  OPENCODE_OTEL_ARCHIVE_URL         Full release tar.gz URL override.
HELP
    exit 0
    ;;
esac

if [[ "$#" -gt 0 && "$1" != --* ]]; then
  case "$1" in
    latest)
      REF="latest"
      ;;
    v*)
      REF="$1"
      ;;
    *)
      REF="v$1"
      ;;
  esac
  shift
fi

need() {
  if ! command -v "$1" >/dev/null 2>&1; then
    echo "Missing required command: $1" >&2
    exit 1
  fi
}

need curl
need tar
need gzip

if [[ -z "$ARCHIVE_URL" ]]; then
  RESOLVED_REF="$(resolve_release_ref "$REF")"
  ARCHIVE_URL="$(release_archive_url "$RESOLVED_REF")"
else
  RESOLVED_REF="$REF"
fi

TMP_DIR="$(mktemp -d)"
trap 'rm -rf "$TMP_DIR"' EXIT

mkdir -p "$TMP_DIR/repo"
echo "Downloading $ARCHIVE_URL"
curl -fsSL "$ARCHIVE_URL" | tar -xz --strip-components=1 -C "$TMP_DIR/repo"

echo "Installing plugin from temporary archive"
bash "$TMP_DIR/repo/scripts/install.sh" "$@"
