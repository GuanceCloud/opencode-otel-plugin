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
