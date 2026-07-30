# OpenCode OTel Plugin

An observability plugin for OpenCode. It subscribes to official OpenCode hooks,
builds Agent Traces and Metrics based on the
[gtrace AI semantic conventions](https://github.com/GuanceCloud/gtrace-ai-semantic-conventions),
and exports them through **OTLP/HTTP Protobuf** to DataKit, GTrace OpenWay, or
other OpenTelemetry collectors. Its transport configuration and dual-signal
export model follow the same pattern as `codex-otel-plugin`.

## Trace structure

Each user turn becomes one trace:

```text
invoke_agent
├── llm
├── tool:<name>
│   └── skill:<name>
├── llm
└── assistant
```

- `invoke_agent`: starts from `chat.message` and ends at `session.idle` or `session.error`
- `llm`: starts at each `chat.params` event and ends when the matching assistant message completes
- `tool:<name>`: maps directly to `tool.execute.before/after`
- `skill:<name>`: created only when tool arguments contain a readable `SKILL.md` path, and is attached as a child of the tool span
- `assistant`: final text output event without duplicating token accounting

Collected data includes model, provider, token usage, cache tokens, reasoning
tokens, finish reason, TTFT, tool calls, session status, and redacted/truncated
input and output content.

Derived metrics exported from the same turn:

- `gen_ai.workflow.duration`
- `gen_ai.agent.operation.count`
- `gen_ai.agent.operation.duration`
- `gen_ai.client.token.usage`

## Requirements

- OpenCode 1.18 or later
- Node.js 20+
- Linux/macOS with `curl`, `tar`, and `gzip`
- OpenCode's bundled Bun runtime for plugin loading
- DataKit or GTrace OpenWay with OTLP HTTP ingestion enabled

Default DataKit endpoints:

```text
Trace:   http://127.0.0.1:9529/otel/v1/traces
Metrics: http://127.0.0.1:9529/otel/v1/metrics
```

## Quick install

The recommended installation path is the fixed GitHub Release installer rather
than a Git source checkout:

```bash
curl -fsSL https://github.com/GuanceCloud/opencode-otel-plugin/releases/latest/download/install-release.sh \
  | bash -s -- latest \
      --endpoint https://llm-openway.guance.com \
      --x-token <token> \
      --tag agent_id=<agent-id> \
      --tag agent_name=<agent-name>
```

Example:

```bash
curl -fsSL https://github.com/GuanceCloud/opencode-otel-plugin/releases/latest/download/install-release.sh \
  | bash -s -- latest \
      --endpoint https://llm-openway.guance.com \
      --x-token agent_ca7a50af033e43fc9f53c7664d31d04a \
      --tag agent_id=agent_9cf885f06aaf11f1831e47f206e21a2d \
      --tag agent_name=NiomaAI
```

The installer automatically:

- downloads `opencode-otel-plugin.tar.gz` from GitHub Release
- installs the plugin into `~/.config/opencode/plugins/opencode-otel-plugin`
- installs runtime dependencies
- updates `~/.config/opencode/opencode.json`
- updates `~/.config/opencode/gtrace.json`
- sets `experimental.openTelemetry=false`
- injects `To-Headless: true` in `gtrace` mode

Restart OpenCode after installation.

## Development and build

```bash
cd /home/liurui/code/opencode-otel-plugin
npm install
npm run check
npm test
npm run build
npm run smoke:otlp
```

Build output entrypoint: `dist/index.js`

## Plugin activation

The installer writes the plugin entry into `~/.config/opencode/opencode.json`.
The default result is equivalent to:

```json
{
  "plugin": [
    [
      "file:///home/liurui/.config/opencode/plugins/opencode-otel-plugin",
      {
        "captureContent": "preview"
      }
    ]
  ],
  "experimental": {
    "openTelemetry": false
  }
}
```

See `examples/opencode.json` and `examples/gtrace.json` for complete examples.
Restart OpenCode after changing configuration.

> This custom plugin already exports traces, so OpenCode native
> `experimental.openTelemetry` should stay disabled to avoid duplicate uploads.

You can also place the same configuration in a project-local `opencode.json`.

### gtrace.json

The plugin reads configuration in this order:

1. `~/.config/opencode/gtrace.json`
2. project-local `.opencode/gtrace.json`

Project-level values override global values with the same keys. The
`endpoint + tracePath + metricsPath + headers` pattern matches
`codex-otel-plugin`.

```json
{
  "enabled": true,
  "endpoint": "https://llm-openway.guance.com",
  "tracePath": "v1/write/otel-llm",
  "metricsPath": "v1/write/otel-metrics",
  "headers": {
    "X-Token": "<your-token>",
    "To-Headless": "true"
  },
  "resourceAttributes": {
    "deployment.environment": "prod",
    "app_id": "opencode-monitor",
    "app_name": "OpenCode OTEL",
    "agent_type": "assistant",
    "agent_source": "opencode"
  }
}
```

Use `examples/gtrace.json` as the template.

Notes:

- `enabled` only controls the OpenCode plugin side
- `codex-otel-plugin` and this OpenCode plugin keep separate `gtrace.json` files
- upload diagnostics are written to `~/.config/opencode/gtrace-hook.log`
- the installer injects `headers.To-Headless=true` unless you override it later

## Release preparation

Before publishing, verify:

- do not commit local config files such as `~/.config/opencode/gtrace.json`
- do not commit real `X-Token`, `Authorization`, or `Cookie` values
- do not commit `~/.config/opencode/gtrace-hook.log` or other troubleshooting logs
- do not commit `node_modules/`, `owl-reports/`, or temporary packaging output
- keep placeholders only in `examples/gtrace.json`
- run:

```bash
npm run check
npm test
npm run build
```

For customer delivery, publish a GitHub Release instead of telling users to
clone the main branch. Upload these two fixed assets:

- `install-release.sh`
- `opencode-otel-plugin.tar.gz`

Packaging command:

```bash
npm run package:release
```

This generates the assets under `release-assets/`. Then:

1. create a Git tag such as `v0.1.1`
2. create the matching GitHub Release
3. upload `release-assets/install-release.sh`
4. upload `release-assets/opencode-otel-plugin.tar.gz`

## Configuration

| Plugin option | Environment variable | Default |
| --- | --- | --- |
| `enabled` | `OPENCODE_OTEL_ENABLED` | `true` |
| `endpoint` | `OPENCODE_OTEL_ENDPOINT` | `http://127.0.0.1:9529` |
| `tracePath` | `OPENCODE_OTEL_TRACE_PATH` | `otel/v1/traces` |
| `metricsPath` | `OPENCODE_OTEL_METRICS_PATH` | `otel/v1/metrics` |
| `otelTracesUrl` | `OPENCODE_OTEL_TRACES_URL` | empty |
| `otelMetricsUrl` | `OPENCODE_OTEL_METRICS_URL` | empty |
| `headers` | `OPENCODE_OTEL_HEADERS` | `{}` |
| `publicKey` | `OPENCODE_OTEL_PUBLIC_KEY` | empty |
| `secretKey` | `OPENCODE_OTEL_SECRET_KEY` | empty |
| `metricsEnabled` | `OPENCODE_OTEL_METRICS_ENABLED` | `true` |
| `serviceName` | `OPENCODE_OTEL_SERVICE_NAME` | `gtrace-opencode` |
| `environment` | `OPENCODE_OTEL_ENV` | `dev` |
| `agentId` | `OPENCODE_OTEL_AGENT_ID` | `opencode` |
| `agentName` | `OPENCODE_OTEL_AGENT_NAME` | `OpenCode` |
| `agentVersion` | `OPENCODE_OTEL_AGENT_VERSION` | `unknown` |
| `captureContent` | `OPENCODE_OTEL_CAPTURE_CONTENT` | `preview` |
| `maxAttributeLength` | `OPENCODE_OTEL_MAX_ATTRIBUTE_LENGTH` | `4096` |
| `batchDelayMs` | `OPENCODE_OTEL_BATCH_DELAY_MS` | `500` |
| `exportTimeoutMs` | `OPENCODE_OTEL_EXPORT_TIMEOUT_MS` | `10000` |
| `resourceAttributes` | `OPENCODE_OTEL_RESOURCE_ATTRIBUTES` | `{}` |
| `debug` | `OPENCODE_OTEL_DEBUG` | `false` |
| `hookLogFile` | `OPENCODE_OTEL_HOOK_LOG_FILE` | `~/.config/opencode/gtrace-hook.log` |

Plugin options override environment variables, and environment variables
override `gtrace.json`. If none are provided, the plugin falls back to local
DataKit defaults.

## Troubleshooting log

Check the local diagnostic log directly:

```bash
tail -n 100 ~/.config/opencode/gtrace-hook.log
```

Only these messages are persisted:

- `gtrace disabled`
- `uploaded spans`
- `uploaded metrics`
- `failed`

For release-based installs, the simplest validation command is:

```bash
tail -n 20 ~/.config/opencode/gtrace-hook.log
```

If you see `uploaded spans` and `uploaded metrics`, installation, config, and
export are working.

`captureContent` values:

- `none`: do not send prompts, replies, tool arguments, or results; keep only length and technical metadata
- `preview`: default; send a redacted preview up to 1024 characters
- `full`: send redacted content up to `maxAttributeLength`

Authenticated collectors can use object-style `headers` or environment
variables. Environment variables support both JSON objects and comma-separated
`key=value` pairs:

```bash
export OPENCODE_OTEL_HEADERS='Authorization=Bearer xxx,x-scope=production'
```

If `otelTracesUrl` or `otelMetricsUrl` is set, it overrides
`endpoint + tracePath/metricsPath`. If no `Authorization` header is provided,
`publicKey` and `secretKey` can be used to generate Basic Auth automatically.

## Data safety

Before export, the plugin recursively redacts common sensitive fields:

- Authorization, Cookie
- API Key, Access Token, Refresh Token
- Password, Secret, Private Key
- Bearer tokens in free text and common `sk-*` tokens

All free-text attributes are length-limited. In production environments where
content-level troubleshooting is unnecessary, set:

```json
{
  "captureContent": "none"
}
```

## Known limits

- OpenCode hooks do not expose the exact lower-level HTTP request start time, so `llm` spans start at `chat.params`
- TTFT is measured from `chat.params` to the first text/reasoning part
- skill spans are emitted only when tool arguments explicitly contain a readable `SKILL.md`, which avoids false positives from plain text mentions
- if an OpenCode error event does not carry `sessionID`, the plugin cannot reliably attach it to an active trace
- the internal `title` agent used by OpenCode for session titles is excluded from user turns, avoiding fake `llm` spans with no response tokens

## Development commands

```bash
npm run check
npm test
npm run build
```

Customer installation guide: [docs/install-customer.md](docs/install-customer.md)  
Changelog: [CHANGELOG.md](CHANGELOG.md)
