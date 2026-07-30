# OpenCode OTel Plugin Customer Installation Guide

Date: 2026-07-30  
Applicable release: `v0.1.2` and later

## 1. Requirements

- OpenCode is already installed
- Linux or macOS
- Access to GitHub Releases
- The host has:
  - `bash`
  - `curl`
  - `tar`
  - `gzip`
  - Node.js 20+

## 2. One-line installation

Replace the parameters below with customer-specific values and run:

```bash
curl -fsSL https://github.com/GuanceCloud/opencode-otel-plugin/releases/latest/download/install-release.sh \
  | bash -s -- latest \
      --endpoint https://llm-openway.guance.com \
      --x-token <your-token> \
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
      --tag agent_name=Nioma AI
```

## 3. What the installer does

The installer automatically:

- downloads the GitHub Release package
- installs the plugin into `~/.config/opencode/plugins/opencode-otel-plugin`
- installs runtime dependencies
- writes or updates `~/.config/opencode/opencode.json`
- writes or updates `~/.config/opencode/gtrace.json`
- disables native OpenCode `experimental.openTelemetry`
- injects `To-Headless=true` automatically for GTrace installs

## 4. After installation

After the installer finishes:

1. Restart OpenCode
2. Run one minimal conversation
3. Check the local diagnostic log

```bash
tail -n 20 ~/.config/opencode/gtrace-hook.log
```

If you see the following log messages, trace and metrics upload is working:

- `uploaded spans`
- `uploaded metrics`

## 5. Common options

Optional example:

```bash
curl -fsSL https://github.com/GuanceCloud/opencode-otel-plugin/releases/latest/download/install-release.sh \
  | bash -s -- latest \
      --endpoint https://llm-openway.guance.com \
      --x-token <your-token> \
      --tag agent_id=<agent-id> \
      --tag agent_name=<agent-name> \
      --capture-content preview
```

Common options:

- `--endpoint`: upload endpoint
- `--x-token`: GTrace / Dataway authentication token
- `--tag KEY=VALUE`: writes resource attributes into `resourceAttributes`
- `--capture-content`: one of `none`, `preview`, or `full`

## 6. Installed file locations

- OpenCode main config:
  - `~/.config/opencode/opencode.json`
- Plugin upload config:
  - `~/.config/opencode/gtrace.json`
- Plugin diagnostic log:
  - `~/.config/opencode/gtrace-hook.log`
- Plugin install directory:
  - `~/.config/opencode/plugins/opencode-otel-plugin`

## 7. Upgrade

To upgrade, rerun the same install command:

```bash
curl -fsSL https://github.com/GuanceCloud/opencode-otel-plugin/releases/latest/download/install-release.sh \
  | bash -s -- latest \
      --endpoint https://llm-openway.guance.com \
      --x-token <your-token> \
      --tag agent_id=<agent-id> \
      --tag agent_name=<agent-name>
```

If you want to pin a fixed version, replace `latest` with a specific release tag, for example:

```bash
curl -fsSL https://github.com/GuanceCloud/opencode-otel-plugin/releases/latest/download/install-release.sh \
  | bash -s -- v0.1.2 \
      --endpoint https://llm-openway.guance.com \
      --x-token <your-token>
```

## 8. Troubleshooting

If no data appears after installation, check these first:

1. `~/.config/opencode/gtrace-hook.log`
2. `~/.config/opencode/gtrace.json`
3. `~/.config/opencode/opencode.json`
4. Whether OpenCode was restarted
5. Whether `endpoint` and `X-Token` are correct

For further diagnosis, keep the most recent section of `gtrace-hook.log`.
