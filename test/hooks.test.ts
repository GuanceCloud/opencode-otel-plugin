import type { Hooks, Plugin } from "@opencode-ai/plugin"
import { ROOT_CONTEXT, trace } from "@opentelemetry/api"
import { BasicTracerProvider, InMemorySpanExporter, SimpleSpanProcessor } from "@opentelemetry/sdk-trace-base"
import { afterEach, describe, expect, it, vi } from "vitest"
import { OpenCodeOtelPlugin } from "../src/index.js"
import { TraceLifecycle } from "../src/lifecycle.js"
import { createTelemetry } from "../src/telemetry.js"
import { createFileLogger } from "../src/filelog.js"

vi.mock("../src/telemetry.js", () => ({ createTelemetry: vi.fn() }))
vi.mock("../src/filelog.js", () => ({ createFileLogger: vi.fn() }))

afterEach(() => vi.restoreAllMocks())

async function setup() {
  const exporter = new InMemorySpanExporter()
  const provider = new BasicTracerProvider({ spanProcessors: [new SimpleSpanProcessor(exporter)] })
  const log = vi.fn().mockResolvedValue(undefined)
  vi.mocked(createFileLogger).mockReturnValue(log)
  vi.mocked(createTelemetry).mockReturnValue({
    tracer: provider.getTracer("test"),
    contextFor: (span) => trace.setSpan(ROOT_CONTEXT, span),
    recordWorkflow: vi.fn(), recordOperation: vi.fn(), recordTokenUsage: vi.fn(),
    forceFlush: () => provider.forceFlush(), shutdown: () => provider.shutdown(),
  })
  const hooks = await OpenCodeOtelPlugin({ directory: "/tmp" } as Parameters<Plugin>[0], {
    enabled: true, captureContent: "full",
  })
  return { hooks, exporter, provider, log }
}

describe("host hook isolation", () => {
  it("completes tools with missing args, output and metadata and preserves host results", async () => {
    const { hooks, exporter, provider } = await setup()
    try {
      const input = { tool: "db2", sessionID: "session", callID: "call", args: undefined }
      const result = { title: "db2", output: undefined, metadata: undefined }
      await expect(hooks["tool.execute.before"]!(input, { args: undefined })).resolves.toBeUndefined()
      await expect(hooks["tool.execute.after"]!(input,
        result as unknown as Parameters<NonNullable<Hooks["tool.execute.after"]>>[1],
      )).resolves.toBeUndefined()
      expect(result).toEqual({ title: "db2", output: undefined, metadata: undefined })
      const tool = exporter.getFinishedSpans().find((span) => span.name === "tool:db2")
      expect(tool?.attributes.tool_result_status).toBe("success")
      expect(tool?.attributes["gen_ai.tool.call.result"]).toBe("[Unserializable]")
      await hooks.dispose!()
    } finally { await provider.shutdown() }
  })

  it.each([
    ["chat.message", "onChatMessage"], ["chat.params", "onChatParams"],
    ["tool.execute.before", "onToolBefore"], ["tool.execute.after", "onToolAfter"],
    ["event", "onEvent"], ["dispose", "dispose"],
  ] as const)("contains sync and async failures from %s, including logger failures", async (hook, method) => {
    const { hooks, provider, log } = await setup()
    try {
      const spy = vi.spyOn(TraceLifecycle.prototype, method)
      const invoke = hooks[hook] as (...args: unknown[]) => Promise<void>
      const output = Object.freeze({ output: "business result" })
      spy.mockImplementationOnce(() => { throw new Error("secret payload") })
      await expect(invoke({ event: {} }, output)).resolves.toBeUndefined()
      expect(log).toHaveBeenCalledWith("warn", "failed", { stage: "hook", hook })
      expect(JSON.stringify(log.mock.calls)).not.toContain("secret payload")
      log.mockRejectedValueOnce(new Error("logger failed"))
      spy.mockRejectedValueOnce(new Error("secret payload"))
      await expect(invoke({ event: {} }, output)).resolves.toBeUndefined()
      spy.mockResolvedValueOnce(undefined)
      await expect(invoke({ event: {} }, output)).resolves.toBeUndefined()
      expect(spy).toHaveBeenCalledTimes(3)
      expect(output).toEqual({ output: "business result" })
    } finally { await provider.shutdown() }
  })
})
