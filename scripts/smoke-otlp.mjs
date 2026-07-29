import { resolveConfig } from "../dist/config.js"
import { TraceLifecycle } from "../dist/lifecycle.js"
import { createTelemetry } from "../dist/telemetry.js"

const sessionID = `opencode-otel-smoke-${Date.now()}`
const now = Date.now()
const config = resolveConfig({
  endpoint: process.env.OPENCODE_OTEL_ENDPOINT ?? "http://127.0.0.1:9529/otel/v1/traces",
  serviceName: process.env.OPENCODE_OTEL_SERVICE_NAME ?? "gtrace-opencode-smoke",
  environment: "smoke",
  agentVersion: "1.18.8",
  captureContent: "preview",
  batchDelayMs: 50,
})
const runtime = createTelemetry(config)
const lifecycle = new TraceLifecycle(runtime, config, process.cwd(), async (level, message, extra) => {
  if (level === "warn" || level === "error") {
    console.error(`[${level}] ${message}`, extra ?? {})
  }
})

await lifecycle.onChatMessage(
  {
    sessionID,
    agent: "smoke",
    model: { providerID: "test", modelID: "smoke-model" },
  },
  {
    message: {
      id: `${sessionID}-user`,
      sessionID,
      role: "user",
      time: { created: now },
      agent: "smoke",
      model: { providerID: "test", modelID: "smoke-model" },
    },
    parts: [
      {
        id: `${sessionID}-user-part`,
        sessionID,
        messageID: `${sessionID}-user`,
        type: "text",
        text: "DataKit OTLP/HTTP Protobuf smoke test",
      },
    ],
  },
)
await lifecycle.onChatParams(
  {
    sessionID,
    agent: "smoke",
    model: { id: "smoke-model", providerID: "test", name: "Smoke Model" },
    provider: { info: { id: "test", name: "Test" } },
  },
  { temperature: 0, topP: 1, topK: 0, maxOutputTokens: 32 },
)
await lifecycle.onEvent({
  type: "message.part.updated",
  properties: {
    part: {
      id: `${sessionID}-assistant-part`,
      sessionID,
      messageID: `${sessionID}-assistant`,
      type: "text",
      text: "smoke test completed",
      time: { start: now + 5, end: now + 10 },
    },
  },
})
await lifecycle.onEvent({
  type: "message.updated",
  properties: {
    info: {
      id: `${sessionID}-assistant`,
      sessionID,
      role: "assistant",
      time: { created: now + 5, completed: now + 10 },
      modelID: "smoke-model",
      providerID: "test",
      cost: 0,
      tokens: { input: 8, output: 4, reasoning: 0, cache: { read: 0, write: 0 } },
      finish: "stop",
    },
  },
})
await lifecycle.onEvent({
  type: "session.idle",
  properties: { sessionID },
})
await lifecycle.dispose()

console.log(
  JSON.stringify({
    status: "exported",
    sessionID,
    traceUrl: config.traceUrl,
    metricsUrl: config.metricsEnabled ? config.metricsUrl : "disabled",
    serviceName: config.serviceName,
  }),
)
