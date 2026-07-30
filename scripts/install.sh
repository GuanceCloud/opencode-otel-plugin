#!/usr/bin/env bash
set -euo pipefail

REPO_ROOT="${REPO_ROOT:-$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)}"
OPENCODE_HOME="${OPENCODE_HOME:-$HOME/.config/opencode}"
OPENCODE_CONFIG_FILE="${OPENCODE_CONFIG_FILE:-$OPENCODE_HOME/opencode.json}"
CONFIG_FILE="${GTRACE_CONFIG_FILE:-$OPENCODE_HOME/gtrace.json}"
PLUGIN_NAME="${PLUGIN_NAME:-opencode-otel-plugin}"
PLUGIN_DIR="${PLUGIN_DIR:-$OPENCODE_HOME/plugins/$PLUGIN_NAME}"
INSTALL_TYPE="${OPENCODE_OTEL_INSTALL_TYPE:-gtrace}"
ENDPOINT="${GTRACE_ENDPOINT:-${OPENCODE_OTEL_ENDPOINT:-}}"
TRACE_PATH="${GTRACE_TRACE_PATH:-${OPENCODE_OTEL_TRACE_PATH:-}}"
METRICS_PATH="${GTRACE_METRICS_PATH:-${OPENCODE_OTEL_METRICS_PATH:-}}"
X_TOKEN="${GTRACE_X_TOKEN:-${X_TOKEN:-}}"
CAPTURE_CONTENT="${OPENCODE_OTEL_CAPTURE_CONTENT:-preview}"
WRITE_CONFIG=1
SCRIPT_ENABLED=""
TAGS=()
HEADERS=()
TRACE_PATH_EXPLICIT=0
METRICS_PATH_EXPLICIT=0

if [[ -n "$TRACE_PATH" ]]; then
  TRACE_PATH_EXPLICIT=1
fi
if [[ -n "$METRICS_PATH" ]]; then
  METRICS_PATH_EXPLICIT=1
fi

log() {
  printf '[install] %s\n' "$1"
}

resolve_node() {
  if command -v node >/dev/null 2>&1; then
    command -v node
    return 0
  fi

  for candidate in \
    "$HOME"/.nvm/versions/node/*/bin/node \
    "$HOME"/.volta/bin/node \
    /opt/homebrew/bin/node \
    /usr/local/bin/node \
    /usr/bin/node
  do
    if [[ -x "$candidate" ]]; then
      printf '%s' "$candidate"
      return 0
    fi
  done

  echo "Missing required command: node" >&2
  exit 1
}

resolve_npm() {
  if command -v npm >/dev/null 2>&1; then
    command -v npm
    return 0
  fi

  for candidate in \
    "$HOME"/.nvm/versions/node/*/bin/npm \
    "$HOME"/.volta/bin/npm \
    /opt/homebrew/bin/npm \
    /usr/local/bin/npm \
    /usr/bin/npm
  do
    if [[ -x "$candidate" ]]; then
      printf '%s' "$candidate"
      return 0
    fi
  done

  echo "Missing required command: npm" >&2
  exit 1
}

check_node_version() {
  local node_bin="$1"
  local major
  major="$("$node_bin" -p 'Number(process.versions.node.split(".")[0])' 2>/dev/null || true)"
  if [[ -z "$major" || "$major" -lt 20 ]]; then
    echo "Node.js >= 20 is required. Found: $("$node_bin" -v 2>/dev/null || echo unknown) at $node_bin" >&2
    exit 1
  fi
}

usage() {
  cat <<HELP
Usage:
  scripts/install.sh [--type gtrace|otlp] [--endpoint URL] [--x-token TOKEN] [--trace-path PATH] [--metrics-path PATH] [--header KEY=VALUE] [--tag KEY=VALUE] [--capture-content VALUE] [--enable-script|--disable-script] [--no-config]

Options:
  --type              Config preset. Default: gtrace. Values: gtrace, otlp.
  --endpoint          Receiver base URL, for example https://llm-openway.guance.com.
  --x-token           Dataway/GTrace X-Token. The value is written to gtrace.json and never printed.
  --trace-path        Trace route. Defaults to v1/write/otel-llm for gtrace and otel/v1/traces for otlp.
  --metrics-path      Metrics route. Defaults to v1/write/otel-metrics for gtrace and otel/v1/metrics for otlp.
  --header            Extra HTTP header as KEY=VALUE. Can be repeated.
  --tag               Global resource attribute as KEY=VALUE. Written to resourceAttributes. Can be repeated.
  --capture-content   Plugin captureContent option. Default: preview.
  --config-file       gtrace.json path. Default: ~/.config/opencode/gtrace.json.
  --opencode-config   OpenCode config path. Default: ~/.config/opencode/opencode.json.
  --plugin-dir        Plugin install directory. Default: ~/.config/opencode/plugins/opencode-otel-plugin.
  --enable-script     Set enabled=true in gtrace.json.
  --disable-script    Set enabled=false in gtrace.json.
  --no-config         Install plugin files only; do not create or update config files.
HELP
}

while [[ "$#" -gt 0 ]]; do
  case "$1" in
    --no-config)
      WRITE_CONFIG=0
      ;;
    --enable-script|--enable)
      SCRIPT_ENABLED=true
      ;;
    --disable-script|--disable)
      SCRIPT_ENABLED=false
      ;;
    --type)
      shift
      [[ "$#" -gt 0 ]] || { echo "--type requires a value" >&2; exit 2; }
      INSTALL_TYPE="$1"
      ;;
    --type=*)
      INSTALL_TYPE="${1#*=}"
      ;;
    --endpoint)
      shift
      [[ "$#" -gt 0 ]] || { echo "--endpoint requires a URL" >&2; exit 2; }
      ENDPOINT="$1"
      ;;
    --endpoint=*)
      ENDPOINT="${1#*=}"
      ;;
    --trace-path)
      shift
      [[ "$#" -gt 0 ]] || { echo "--trace-path requires a path" >&2; exit 2; }
      TRACE_PATH="$1"
      TRACE_PATH_EXPLICIT=1
      ;;
    --trace-path=*)
      TRACE_PATH="${1#*=}"
      TRACE_PATH_EXPLICIT=1
      ;;
    --metrics-path)
      shift
      [[ "$#" -gt 0 ]] || { echo "--metrics-path requires a path" >&2; exit 2; }
      METRICS_PATH="$1"
      METRICS_PATH_EXPLICIT=1
      ;;
    --metrics-path=*)
      METRICS_PATH="${1#*=}"
      METRICS_PATH_EXPLICIT=1
      ;;
    --x-token)
      shift
      [[ "$#" -gt 0 ]] || { echo "--x-token requires a token" >&2; exit 2; }
      X_TOKEN="$1"
      ;;
    --x-token=*)
      X_TOKEN="${1#*=}"
      ;;
    --header)
      shift
      [[ "$#" -gt 0 ]] || { echo "--header requires KEY=VALUE" >&2; exit 2; }
      HEADERS+=("$1")
      ;;
    --header=*)
      HEADERS+=("${1#*=}")
      ;;
    --tag)
      shift
      [[ "$#" -gt 0 ]] || { echo "--tag requires KEY=VALUE" >&2; exit 2; }
      TAGS+=("$1")
      ;;
    --tag=*)
      TAGS+=("${1#*=}")
      ;;
    --capture-content)
      shift
      [[ "$#" -gt 0 ]] || { echo "--capture-content requires a value" >&2; exit 2; }
      CAPTURE_CONTENT="$1"
      ;;
    --capture-content=*)
      CAPTURE_CONTENT="${1#*=}"
      ;;
    --config-file)
      shift
      [[ "$#" -gt 0 ]] || { echo "--config-file requires a path" >&2; exit 2; }
      CONFIG_FILE="$1"
      ;;
    --config-file=*)
      CONFIG_FILE="${1#*=}"
      ;;
    --opencode-config)
      shift
      [[ "$#" -gt 0 ]] || { echo "--opencode-config requires a path" >&2; exit 2; }
      OPENCODE_CONFIG_FILE="$1"
      ;;
    --opencode-config=*)
      OPENCODE_CONFIG_FILE="${1#*=}"
      ;;
    --plugin-dir)
      shift
      [[ "$#" -gt 0 ]] || { echo "--plugin-dir requires a path" >&2; exit 2; }
      PLUGIN_DIR="$1"
      ;;
    --plugin-dir=*)
      PLUGIN_DIR="${1#*=}"
      ;;
    -h|--help)
      usage
      exit 0
      ;;
    *)
      echo "Unknown argument: $1" >&2
      exit 2
      ;;
  esac
  shift
done

if [[ ! -f "$REPO_ROOT/dist/index.js" ]]; then
  echo "Cannot find dist/index.js under $REPO_ROOT. Build the release package first." >&2
  exit 1
fi
if [[ ! -f "$REPO_ROOT/package.json" ]]; then
  echo "Cannot find package.json under $REPO_ROOT" >&2
  exit 1
fi

NODE_BIN="$(resolve_node)"
NPM_BIN="$(resolve_npm)"
check_node_version "$NODE_BIN"

case "$INSTALL_TYPE" in
  gtrace|otlp|otel)
    ;;
  *)
    echo "Unsupported --type: $INSTALL_TYPE. Supported values: gtrace, otlp" >&2
    exit 2
    ;;
esac
if [[ "$INSTALL_TYPE" == "otel" ]]; then
  INSTALL_TYPE="otlp"
fi

if [[ -z "$TRACE_PATH" && ( -n "$ENDPOINT" || ! -f "$CONFIG_FILE" || "$TRACE_PATH_EXPLICIT" -eq 1 ) ]]; then
  if [[ "$INSTALL_TYPE" == "gtrace" ]]; then
    TRACE_PATH="v1/write/otel-llm"
  else
    TRACE_PATH="otel/v1/traces"
  fi
fi
if [[ -z "$METRICS_PATH" && ( -n "$ENDPOINT" || ! -f "$CONFIG_FILE" || "$METRICS_PATH_EXPLICIT" -eq 1 ) ]]; then
  if [[ "$INSTALL_TYPE" == "gtrace" ]]; then
    METRICS_PATH="v1/write/otel-metrics"
  else
    METRICS_PATH="otel/v1/metrics"
  fi
fi

sync_plugin_runtime() {
  mkdir -p "$PLUGIN_DIR"
  rm -rf "$PLUGIN_DIR/dist"
  cp -R "$REPO_ROOT/dist" "$PLUGIN_DIR/dist"
  cp "$REPO_ROOT/package.json" "$PLUGIN_DIR/package.json"
  if [[ -f "$REPO_ROOT/package-lock.json" ]]; then
    cp "$REPO_ROOT/package-lock.json" "$PLUGIN_DIR/package-lock.json"
  fi
  if [[ -f "$REPO_ROOT/README.md" ]]; then
    cp "$REPO_ROOT/README.md" "$PLUGIN_DIR/README.md"
  fi
  if [[ -f "$REPO_ROOT/LICENSE" ]]; then
    cp "$REPO_ROOT/LICENSE" "$PLUGIN_DIR/LICENSE"
  fi
}

install_runtime_deps() {
  (cd "$PLUGIN_DIR" && "$NPM_BIN" ci --omit=dev --ignore-scripts >/dev/null)
}

write_opencode_config() {
  OPENCODE_CONFIG_FILE_RUNTIME="$OPENCODE_CONFIG_FILE" \
  OPENCODE_PLUGIN_URL_RUNTIME="file://$PLUGIN_DIR" \
  OPENCODE_PLUGIN_NAME_RUNTIME="$PLUGIN_NAME" \
  OPENCODE_CAPTURE_CONTENT_RUNTIME="$CAPTURE_CONTENT" \
  "$NODE_BIN" "$REPO_ROOT/scripts/install-config.mjs" write-opencode-config
}

write_gtrace_config() {
  local tags_json='[]'
  local headers_json='[]'
  if [[ "${#TAGS[@]}" -gt 0 ]]; then
    tags_json="$(printf '%s\n' "${TAGS[@]}" | "$NODE_BIN" -e 'const fs=require("fs"); const lines=fs.readFileSync(0,"utf8").split(/\n/).map(s=>s.trim()).filter(Boolean); process.stdout.write(JSON.stringify(lines));')"
  fi
  if [[ "${#HEADERS[@]}" -gt 0 ]]; then
    headers_json="$(printf '%s\n' "${HEADERS[@]}" | "$NODE_BIN" -e 'const fs=require("fs"); const lines=fs.readFileSync(0,"utf8").split(/\n/).map(s=>s.trim()).filter(Boolean); process.stdout.write(JSON.stringify(lines));')"
  fi

  GTRACE_CONFIG_FILE_RUNTIME="$CONFIG_FILE" \
  GTRACE_ENDPOINT_RUNTIME="$ENDPOINT" \
  GTRACE_TRACE_PATH_RUNTIME="$TRACE_PATH" \
  GTRACE_METRICS_PATH_RUNTIME="$METRICS_PATH" \
  GTRACE_INSTALL_TYPE_RUNTIME="$INSTALL_TYPE" \
  GTRACE_X_TOKEN_RUNTIME="$X_TOKEN" \
  GTRACE_SCRIPT_ENABLED_RUNTIME="$SCRIPT_ENABLED" \
  GTRACE_TAGS_RUNTIME="$tags_json" \
  GTRACE_HEADERS_RUNTIME="$headers_json" \
  "$NODE_BIN" "$REPO_ROOT/scripts/install-config.mjs" write-gtrace-config
}

sync_plugin_runtime
install_runtime_deps
log "installed plugin files: $PLUGIN_DIR"

if [[ "$WRITE_CONFIG" -eq 1 ]]; then
  write_opencode_config
  log "updated OpenCode config: $OPENCODE_CONFIG_FILE"

  if [[ -n "$ENDPOINT" || -f "$CONFIG_FILE" || -n "$SCRIPT_ENABLED" ]]; then
    write_gtrace_config
    log "updated gtrace config: $CONFIG_FILE"
    if [[ -n "$ENDPOINT" ]]; then
      log "configured endpoint: $ENDPOINT"
    fi
    if [[ -n "$TRACE_PATH" ]]; then
      log "configured trace path: $TRACE_PATH"
    fi
    if [[ -n "$METRICS_PATH" ]]; then
      log "configured metrics path: $METRICS_PATH"
    fi
    if [[ -n "$X_TOKEN" ]]; then
      log "configured X-Token: <redacted>"
    fi
  else
    log "skipped gtrace config because --endpoint was not provided"
  fi
else
  log "skipped config because --no-config was set"
fi

cat <<EOF

OpenCode plugin install complete.

Installed plugin directory:
  $PLUGIN_DIR

Next steps:
  1. Restart OpenCode
  2. Run one conversation
  3. Check ~/.config/opencode/gtrace-hook.log for:
     - uploaded spans
     - uploaded metrics
EOF
