import { mkdtempSync, mkdirSync, writeFileSync } from "node:fs"
import { join } from "node:path"
import { tmpdir } from "node:os"
import { describe, expect, it } from "vitest"
import { parseHeaders, resolveConfig } from "../src/config.js"

function emptyContext() {
  const base = mkdtempSync(join(tmpdir(), "opencode-otel-empty-"))
  const home = join(base, "home")
  const cwd = join(base, "workspace")
  mkdirSync(home, { recursive: true })
  mkdirSync(cwd, { recursive: true })
  return { home, cwd }
}

describe("配置解析", () => {
  it("使用适合 DataKit 的默认 OTLP 地址", () => {
    const config = resolveConfig({}, {}, emptyContext())
    expect(config.endpoint).toBe("http://127.0.0.1:9529")
    expect(config.traceUrl).toBe("http://127.0.0.1:9529/otel/v1/traces")
    expect(config.metricsUrl).toBe("http://127.0.0.1:9529/otel/v1/metrics")
    expect(config.captureContent).toBe("preview")
  })

  it("支持环境变量和插件参数，插件参数优先", () => {
    const config = resolveConfig(
      { serviceName: "from-options", captureContent: "none" },
      {
        OPENCODE_OTEL_SERVICE_NAME: "from-env",
        OPENCODE_OTEL_ENDPOINT: "http://collector:4318/v1/traces",
      },
      emptyContext(),
    )
    expect(config.serviceName).toBe("from-options")
    expect(config.endpoint).toBe("http://collector:4318/v1/traces")
    expect(config.traceUrl).toBe("http://collector:4318/v1/traces")
    expect(config.metricsUrl).toBe("http://collector:4318/v1/metrics")
    expect(config.captureContent).toBe("none")
  })

  it("支持 codex-otel-plugin 风格的 endpoint + signal path", () => {
    const config = resolveConfig(
      {
        endpoint: "https://llm-openway.guance.com",
        tracePath: "v1/write/otel-llm",
        metricsPath: "v1/write/otel-metrics",
      },
      {},
    )
    expect(config.traceUrl).toBe("https://llm-openway.guance.com/v1/write/otel-llm")
    expect(config.metricsUrl).toBe("https://llm-openway.guance.com/v1/write/otel-metrics")
  })

  it("默认读取 ~/.config/opencode/gtrace.json 与项目 .opencode/gtrace.json", () => {
    const base = mkdtempSync(join(tmpdir(), "opencode-otel-config-"))
    const home = join(base, "home")
    const cwd = join(base, "workspace")
    mkdirSync(join(home, ".config", "opencode"), { recursive: true })
    mkdirSync(join(cwd, ".opencode"), { recursive: true })
    writeFileSync(
      join(home, ".config", "opencode", "gtrace.json"),
      JSON.stringify({
        endpoint: "https://global.example.com",
        tracePath: "global/traces",
        metricsPath: "global/metrics",
        headers: { "X-Token": "global-token" },
        tags: ["agent_id=global-agent"],
      }),
    )
    writeFileSync(
      join(cwd, ".opencode", "gtrace.json"),
      JSON.stringify({
        endpoint: "https://local.example.com/",
        tracePath: "/v1/write/otel-llm/",
        metricsPath: "/v1/write/otel-metrics/",
        resourceAttributes: { app_id: "local-app" },
        tags: ["agent_name=local-name"],
        timeout_ms: 25000,
      }),
    )

    const config = resolveConfig({}, {}, { home, cwd })
    expect(config.enabled).toBe(true)
    expect(config.endpoint).toBe("https://local.example.com")
    expect(config.traceUrl).toBe("https://local.example.com/v1/write/otel-llm")
    expect(config.metricsUrl).toBe("https://local.example.com/v1/write/otel-metrics")
    expect(config.headers["X-Token"]).toBe("global-token")
    expect(config.resourceAttributes.agent_id).toBeUndefined()
    expect(config.resourceAttributes.agent_name).toBe("local-name")
    expect(config.resourceAttributes.app_id).toBe("local-app")
    expect(config.exportTimeoutMs).toBe(25000)
  })

  it("OpenCode 自己的 gtrace.json 可以关闭插件", () => {
    const base = mkdtempSync(join(tmpdir(), "opencode-otel-enabled-"))
    const home = join(base, "home")
    const cwd = join(base, "workspace")
    mkdirSync(join(home, ".config", "opencode"), { recursive: true })
    mkdirSync(cwd, { recursive: true })
    writeFileSync(
      join(home, ".config", "opencode", "gtrace.json"),
      JSON.stringify({
        enabled: false,
        endpoint: "https://llm-openway.guance.com",
        tracePath: "v1/write/otel-llm",
        metricsPath: "v1/write/otel-metrics",
      }),
    )

    const config = resolveConfig({}, {}, { home, cwd })
    expect(config.enabled).toBe(false)
    expect(config.traceUrl).toBe("https://llm-openway.guance.com/v1/write/otel-llm")
  })

  it("解析 OTLP 请求头", () => {
    expect(parseHeaders("Authorization=Bearer token,x-scope=demo")).toEqual({
      Authorization: "Bearer token",
      "x-scope": "demo",
    })
    expect(parseHeaders('{"X-Token":"demo","To-Headless":"true"}')).toEqual({
      "X-Token": "demo",
      "To-Headless": "true",
    })
  })
})
