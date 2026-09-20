# OpenCode OTel Plugin

An OpenCode observability plugin that exports traces and metrics to DataKit,
GTrace OpenWay, or another OTLP/HTTP collector.

It follows the same overall delivery model as `codex-otel-plugin`:

- GitHub Release based installation
- `gtrace.json` driven endpoint and auth configuration
- dual export for traces and metrics
- fail-open behavior that does not block the host

## What it exports

Each user turn is modeled as one trace:

```text
invoke_agent
├── llm
├── tool:<name>
│   └── skill:<name>
├── llm
└── assistant
```

Derived metrics:

- `gen_ai.workflow.duration`
- `gen_ai.agent.operation.count`
- `gen_ai.agent.operation.duration`
- `gen_ai.client.token.usage`

## Requirements

- OpenCode 1.18+
- Node.js 20+ for the installer config helper only
- Linux/macOS with `bash`, `curl`, `tar`, and `gzip`
- Windows PowerShell 5.1+ or PowerShell 7+, with `tar.exe`

## Install

```bash
curl -fsSL https://github.com/GuanceCloud/opencode-otel-plugin/releases/latest/download/install-release.sh \
  | bash -s -- latest \
      --endpoint https://llm-openway.guance.com \
      --x-token <token> \
      --tag agent_id=<agent-id> \
      --tag agent_name=<agent-name>
```

The installer will:

- install the plugin into `~/.config/opencode/plugins/opencode-otel-plugin`
- unpack prebuilt runtime dependencies bundled in the release archive
- update `~/.config/opencode/opencode.json`
- update `~/.config/opencode/gtrace.json`
- set `experimental.openTelemetry=false`
- inject `To-Headless=true` for `gtrace` installs

Restart OpenCode after installation.

Windows PowerShell:

```powershell
$installer = Join-Path $env:TEMP "opencode-otel-install.ps1"
Invoke-WebRequest https://github.com/GuanceCloud/opencode-otel-plugin/releases/latest/download/install-release.ps1 -OutFile $installer
powershell.exe -NoProfile -ExecutionPolicy Bypass -File $installer -Version latest -Endpoint https://llm-openway.guance.com -XToken "<token>" -Tag @("agent_id=<agent-id>","agent_name=<agent-name>")
```

## Minimal config shape

`~/.config/opencode/gtrace.json`

```json
{
  "enabled": true,
  "endpoint": "https://llm-openway.guance.com",
  "tracePath": "v1/write/otel-llm",
  "metricsPath": "v1/write/otel-metrics",
  "headers": {
    "X-Token": "<your-token>",
    "To-Headless": "true"
  }
}
```

The plugin reads:

1. `~/.config/opencode/gtrace.json`
2. project `.opencode/gtrace.json`

Project config overrides global config.

## Verify

After restarting OpenCode, run one conversation and check:

```bash
tail -n 20 ~/.config/opencode/gtrace-hook.log
```

Expected success markers:

- `uploaded spans`
- `uploaded metrics`

## Build

```bash
npm install
npm run check
npm test
npm run build
```

Release packaging:

```bash
npm run package:release
```

## Docs

- Customer install guide: [docs/install-customer.md](docs/install-customer.md)
- Changelog: [CHANGELOG.md](CHANGELOG.md)

### MiMo Code

The shared plugin supports a native MiMo host variant:

```bash
bash install-release.sh --variant mimo --endpoint https://your-collector.example
```

PowerShell uses `-Variant mimo`. The configuration directory is resolved from
`MIMOCODE_CONFIG_DIR`, then `MIMOCODE_HOME/config`, then
`XDG_CONFIG_HOME/mimocode`, and finally `~/.config/mimocode`.
Relative `MIMOCODE_HOME` or `MIMOCODE_CONFIG_DIR` values are rejected; relative
`XDG_CONFIG_HOME` values are ignored.
The installer registers `dist/mimo.js` in `mimocode.jsonc` when present, otherwise
`mimocode.json`, preserving comments and unrelated settings. This entry exports
only a plugin function for compatibility with MiMo's plugin loader. Its persisted
`mimo-options.json` records the configuration directory, so a normal MiMo launch
needs no environment wrapper. `--no-config` updates retain these runtime options
and do not change user or telemetry configuration.

MiMo reads its own `gtrace.json` and project `.mimocode/gtrace.json`, writes
`gtrace-hook.log` in its configuration directory, and reports `agent_runtime=mimo`.
Use `MIMOCODE_OTEL_*` for runtime overrides; `OPENCODE_OTEL_*` runtime settings do
not leak into MiMo. The plugin code and package name remain shared with OpenCode.

Before removing plugin files, unregister it using the installed helper:

```bash
node "$MIMOCODE_CONFIG_DIR/plugins/opencode-otel-plugin/scripts/install-config.mjs" \
  remove-mimo-config "$MIMOCODE_CONFIG_DIR"
```

The directory argument must be absolute. This edits only this plugin's registration
in both MiMo configuration files, preserving provider/authentication settings,
other plugins, and telemetry configuration. Connector removal runs this step
before deleting the plugin files.

These changes require a new plugin release before published connector installers
can use `--variant mimo`; older installers reject the variant. Each LLM span uses
the host's transformed message hook to capture the current user input or completed
tool responses. Tool requests and responses are emitted as structured `tool_call`
and `tool_call_response` parts after content redaction and truncation.
