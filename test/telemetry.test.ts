import { createServer } from "node:http"
import { AddressInfo } from "node:net"
import { afterEach, describe, expect, it } from "vitest"
import { resolveConfig } from "../src/config.js"
import { createTelemetry } from "../src/telemetry.js"

const servers: ReturnType<typeof createServer>[] = []

afterEach(async () => {
  await Promise.all(
    servers.splice(0).map(
      (server) =>
        new Promise<void>((resolve, reject) =>
          server.close((error) => (error ? reject(error) : resolve())),
        ),
    ),
  )
})

describe("OTLP 双信号导出", () => {
  it("分别向 tracePath 和 metricsPath 发送 Protobuf", async () => {
    const requests: Array<{ url: string; contentType?: string; body: Buffer }> = []
    const server = createServer((request, response) => {
      const chunks: Buffer[] = []
      request.on("data", (chunk: Buffer) => chunks.push(chunk))
      request.on("end", () => {
        requests.push({
          url: request.url ?? "",
          contentType: request.headers["content-type"],
          body: Buffer.concat(chunks),
        })
        response.statusCode = 200
        response.end()
      })
    })
    servers.push(server)
    await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve))
    const address = server.address() as AddressInfo
    const config = resolveConfig(
      {
        endpoint: `http://127.0.0.1:${address.port}`,
        tracePath: "v1/write/otel-llm",
        metricsPath: "v1/write/otel-metrics",
        batchDelayMs: 50,
      },
      {},
    )
    const runtime = createTelemetry(config)
    const span = runtime.tracer.startSpan("invoke_agent")
    span.end()
    const metricAttributes = {
      agent_runtime: "opencode",
      "gen_ai.conversation.id": "test-session",
      session_id: "test-session",
    }
    runtime.recordWorkflow(1000, { ...metricAttributes, final_status: "completed" })
    runtime.recordOperation(100, {
      ...metricAttributes,
      "gen_ai.operation.name": "chat",
      status: "completed",
    })
    runtime.recordTokenUsage(42, {
      ...metricAttributes,
      "gen_ai.token.type": "input",
    })
    await runtime.forceFlush()
    await runtime.shutdown()

    const trace = requests.find((request) => request.url === "/v1/write/otel-llm")
    const metrics = requests.find((request) => request.url === "/v1/write/otel-metrics")
    expect(trace?.contentType).toContain("application/x-protobuf")
    expect(metrics?.contentType).toContain("application/x-protobuf")
    expect(trace?.body.length).toBeGreaterThan(100)
    expect(metrics?.body.length).toBeGreaterThan(300)
  })
})
