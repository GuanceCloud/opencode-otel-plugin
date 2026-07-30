# OpenCode OTel Plugin 客户安装说明

适用日期：2026-07-30  
适用 Release：`v0.1.0` 及后续版本

## 1. 安装要求

- 已安装 OpenCode
- Linux / macOS 环境
- 机器可访问 GitHub Release
- 本机具备：
  - `bash`
  - `curl`
  - `tar`
  - `gzip`
  - Node.js 20+

## 2. 一键安装

将下面命令中的参数替换为客户自己的值后执行：

```bash
curl -fsSL https://github.com/GuanceCloud/opencode-otel-plugin/releases/latest/download/install-release.sh \
  | bash -s -- latest \
      --endpoint https://llm-openway.guance.com \
      --x-token <your-token> \
      --tag agent_id=<agent-id> \
      --tag agent_name=<agent-name>
```

示例：

```bash
curl -fsSL https://github.com/GuanceCloud/opencode-otel-plugin/releases/latest/download/install-release.sh \
  | bash -s -- latest \
      --endpoint https://llm-openway.guance.com \
      --x-token agent_ca7a50af033e43fc9f53c7664d31d04a \
      --tag agent_id=agent_9cf885f06aaf11f1831e47f206e21a2d \
      --tag agent_name=牛码AI
```

## 3. 安装脚本会做什么

安装脚本会自动完成以下动作：

- 下载 GitHub Release 安装包
- 安装插件到 `~/.config/opencode/plugins/opencode-otel-plugin`
- 安装插件运行时依赖
- 写入或更新 `~/.config/opencode/opencode.json`
- 写入或更新 `~/.config/opencode/gtrace.json`
- 自动关闭 OpenCode 原生 `experimental.openTelemetry`
- 自动补齐 GTrace 所需请求头 `To-Headless=true`

## 4. 安装后操作

安装完成后：

1. 重启 OpenCode
2. 执行一次最小对话
3. 查看本地日志

```bash
tail -n 20 ~/.config/opencode/gtrace-hook.log
```

如果看到以下日志，说明上报正常：

- `uploaded spans`
- `uploaded metrics`

## 5. 常用参数

可选参数示例：

```bash
curl -fsSL https://github.com/GuanceCloud/opencode-otel-plugin/releases/latest/download/install-release.sh \
  | bash -s -- latest \
      --endpoint https://llm-openway.guance.com \
      --x-token <your-token> \
      --tag agent_id=<agent-id> \
      --tag agent_name=<agent-name> \
      --capture-content preview
```

常用参数说明：

- `--endpoint`：上报地址
- `--x-token`：GTrace / Dataway 鉴权 token
- `--tag KEY=VALUE`：写入 `resourceAttributes`
- `--capture-content`：可选 `none` / `preview` / `full`

## 6. 安装后的配置位置

- OpenCode 主配置：
  - `~/.config/opencode/opencode.json`
- 插件上报配置：
  - `~/.config/opencode/gtrace.json`
- 插件诊断日志：
  - `~/.config/opencode/gtrace-hook.log`
- 插件安装目录：
  - `~/.config/opencode/plugins/opencode-otel-plugin`

## 7. 升级

升级时直接重新执行安装命令即可：

```bash
curl -fsSL https://github.com/GuanceCloud/opencode-otel-plugin/releases/latest/download/install-release.sh \
  | bash -s -- latest \
      --endpoint https://llm-openway.guance.com \
      --x-token <your-token> \
      --tag agent_id=<agent-id> \
      --tag agent_name=<agent-name>
```

如果要固定版本，可将 `latest` 替换为具体版本号，例如：

```bash
curl -fsSL https://github.com/GuanceCloud/opencode-otel-plugin/releases/latest/download/install-release.sh \
  | bash -s -- v0.1.0 \
      --endpoint https://llm-openway.guance.com \
      --x-token <your-token>
```

## 8. 排查

如果安装后没有数据，优先检查：

1. `~/.config/opencode/gtrace-hook.log`
2. `~/.config/opencode/gtrace.json`
3. `~/.config/opencode/opencode.json`
4. OpenCode 是否已重启
5. `endpoint` 和 `X-Token` 是否正确

如需进一步排查，保留最近一段 `gtrace-hook.log` 即可。
