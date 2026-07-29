# OpenCode OTel Plugin

一个面向 OpenCode 的可观测插件。插件订阅 OpenCode 官方 Hook，按照
[gtrace AI semantic conventions](https://github.com/GuanceCloud/gtrace-ai-semantic-conventions)
生成 Agent Trace 和 Metrics，并通过 **OTLP/HTTP Protobuf** 上报到
DataKit、GTrace OpenWay 或其他 OpenTelemetry Collector。传输配置和双信号
上报方式与 `codex-otel-plugin` 保持一致。

## Trace 结构

每个用户 turn 生成一条独立 Trace：

```text
invoke_agent
├── llm
├── tool:<name>
│   └── skill:<name>
├── llm
└── assistant
```

- `invoke_agent`：从 `chat.message` 开始，到 `session.idle` 或
  `session.error` 结束。
- `llm`：每次 `chat.params` 启动，在对应 assistant message 完成时结束。
- `tool:<name>`：严格对应 `tool.execute.before/after`。
- `skill:<name>`：仅当工具参数明确包含可读取的 `SKILL.md` 路径时创建，
  并作为对应 tool span 的子节点。
- `assistant`：最终文本输出事件，不重复记录 token。

采集模型、Provider、token、缓存 token、reasoning token、finish reason、
TTFT、工具调用、会话状态以及经过脱敏和截断的输入输出。

同批派生并上报：

- `gen_ai.workflow.duration`
- `gen_ai.agent.operation.count`
- `gen_ai.agent.operation.duration`
- `gen_ai.client.token.usage`

## 要求

- OpenCode 1.18 或更高版本
- Node.js 20+ 用于构建和测试
- OpenCode 自带的 Bun 运行时用于加载插件
- DataKit 已开启 OpenTelemetry HTTP Trace 接收

DataKit 默认接收地址：

```text
Trace:   http://127.0.0.1:9529/otel/v1/traces
Metrics: http://127.0.0.1:9529/otel/v1/metrics
```

## 构建

```bash
cd /home/liurui/code/opencode-otel-plugin
npm install
npm run check
npm test
npm run build
npm run smoke:otlp
```

构建入口是 `dist/index.js`。

## 给客户通过 Git 安装

建议按源码仓方式交付，不把任何真实 token、客户 endpoint、日志文件提交到仓库。

客户侧安装步骤：

```bash
git clone <your-git-url> opencode-otel-plugin
cd opencode-otel-plugin
npm install
```

说明：

- `npm install` 会自动执行 `prepare`，生成 `dist/index.js`。
- OpenCode 运行插件时依赖当前目录下的 `node_modules`，因此不建议只拷贝 `dist/`。
- 客户如果使用只读部署流程，也可以显式执行一次 `npm run build`。

然后在客户机器上写入 `~/.config/opencode/opencode.json`：

```json
{
  "plugin": [
    [
      "file:///path/to/opencode-otel-plugin",
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

再写入 `~/.config/opencode/gtrace.json`：

```json
{
  "enabled": true,
  "endpoint": "https://llm-openway.guance.com",
  "tracePath": "v1/write/otel-llm",
  "metricsPath": "v1/write/otel-metrics",
  "headers": {
    "X-Token": "<customer-token>",
    "To-Headless": "true"
  }
}
```

重启 OpenCode 后执行一次最小对话，再检查：

```bash
tail -n 20 ~/.config/opencode/gtrace-hook.log
```

看到 `uploaded spans` 和 `uploaded metrics`，说明接入成功。

## 启用插件

推荐在 `~/.config/opencode/opencode.json` 中只声明插件本身。上报地址、鉴权头和
资源属性统一放到 `~/.config/opencode/gtrace.json` 或项目 `.opencode/gtrace.json`：

```json
{
  "plugin": [
    [
      "file:///home/liurui/code/opencode-otel-plugin",
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

完整示例见 `examples/opencode.json`。`gtrace.json` 示例见
`examples/gtrace.json`。修改配置后重启 OpenCode。

> 自定义插件已负责导出 Trace，因此建议关闭 OpenCode 原生的
> `experimental.openTelemetry`，避免重复上报。

也可以把同样的配置放入项目根目录 `opencode.json`，仅对该项目启用。

### gtrace.json

插件会按 OpenCode 自己的顺序读取：

1. `~/.config/opencode/gtrace.json`
2. 当前项目 `.opencode/gtrace.json`

项目级配置会覆盖全局同名字段。`endpoint + tracePath + metricsPath + headers`
的写法与 `codex-otel-plugin` 保持一致：

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

可直接使用 `examples/gtrace.json` 作为模板。

说明：

- `enabled` 现在只控制 OpenCode 这边的插件开关。
- `codex-otel-plugin` 与 OpenCode 插件各自维护自己的 `gtrace.json`，互不影响。
- 默认会把上报结果日志写入 `~/.config/opencode/gtrace-hook.log`。

## 发布到 Git 前的处理

建议发布前检查这几项：

- 不提交 `~/.config/opencode/gtrace.json` 这类本机配置文件。
- 不提交真实 `X-Token`、Authorization、Cookie。
- 不提交 `~/.config/opencode/gtrace-hook.log` 或其他排查日志。
- 不提交 `node_modules/`、`owl-reports/`、临时打包文件。
- `examples/gtrace.json` 里只保留占位符。
- 提交前执行一次：

```bash
npm run check
npm test
npm run build
```

如果你打算给客户固定版本，建议打 Git tag，例如 `v0.1.0`，让客户按 tag 克隆或下载，避免直接跟随主干变更。

## 配置

| 插件参数 | 环境变量 | 默认值 |
| --- | --- | --- |
| `enabled` | `OPENCODE_OTEL_ENABLED` | `true` |
| `endpoint` | `OPENCODE_OTEL_ENDPOINT` | `http://127.0.0.1:9529` |
| `tracePath` | `OPENCODE_OTEL_TRACE_PATH` | `otel/v1/traces` |
| `metricsPath` | `OPENCODE_OTEL_METRICS_PATH` | `otel/v1/metrics` |
| `otelTracesUrl` | `OPENCODE_OTEL_TRACES_URL` | 空 |
| `otelMetricsUrl` | `OPENCODE_OTEL_METRICS_URL` | 空 |
| `headers` | `OPENCODE_OTEL_HEADERS` | `{}` |
| `publicKey` | `OPENCODE_OTEL_PUBLIC_KEY` | 空 |
| `secretKey` | `OPENCODE_OTEL_SECRET_KEY` | 空 |
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

插件参数优先于环境变量；环境变量优先于 `gtrace.json`。如果三者都没有，则回退到
本地 DataKit 默认值。

## 排查日志

可直接查看本地诊断日志：

```bash
tail -n 100 ~/.config/opencode/gtrace-hook.log
```

日志中只记录：

- `gtrace disabled`
- `uploaded spans`
- `uploaded metrics`
- `failed`

`captureContent` 支持：

- `none`：不发送提示词、回复、工具参数和结果，只保留长度及技术元数据。
- `preview`：默认；发送最多 1024 字符的脱敏预览。
- `full`：发送到 `maxAttributeLength` 限制内的脱敏内容。

带认证的 Collector 可以使用对象形式的 `headers`，或使用环境变量。环境变量
同时支持 JSON 对象和逗号分隔的 `key=value`：

```bash
export OPENCODE_OTEL_HEADERS='Authorization=Bearer xxx,x-scope=production'
```

如果设置 `otelTracesUrl` / `otelMetricsUrl`，它们会覆盖
`endpoint + tracePath/metricsPath`。未提供 Authorization header 时，也可以
使用 `publicKey` / `secretKey` 自动生成 Basic Auth。

## 数据安全

发送前会递归屏蔽常见敏感字段，包括：

- Authorization、Cookie
- API Key、Access Token、Refresh Token
- Password、Secret、Private Key
- 文本中的 Bearer Token 和常见 `sk-*` Token

所有自由文本属性都会进行长度限制。生产环境如果不需要内容排障，建议设置：

```json
{
  "captureContent": "none"
}
```

## 已知边界

- OpenCode Hook 不直接暴露底层 HTTP 请求开始时间，因此 `llm` 开始时间取
  `chat.params` 执行时间。
- TTFT 取首次 text/reasoning part 的时间与 `chat.params` 时间之差。
- 只有工具参数中明确出现且可以读取的 `SKILL.md` 才会上报 skill span，避免
  根据文本提及误判。
- OpenCode 异常事件若未携带 `sessionID`，插件无法可靠地把它关联到某一条
  活跃 Trace。
- OpenCode 用于生成会话标题的内部 `title` agent 调用默认不进入用户 turn，
  避免额外产生无响应 token 的伪 `llm` span。

## 开发命令

```bash
npm run check
npm test
npm run build
```
