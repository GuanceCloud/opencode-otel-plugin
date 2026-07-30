import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises"
import { tmpdir } from "node:os"
import { join } from "node:path"
import { ROOT_CONTEXT, trace } from "@opentelemetry/api"
import {
  BasicTracerProvider,
  InMemorySpanExporter,
  SimpleSpanProcessor,
} from "@opentelemetry/sdk-trace-base"
import { afterEach, describe, expect, it } from "vitest"
import { resolveConfig } from "../src/config.js"
import { TraceLifecycle } from "../src/lifecycle.js"
import type { TelemetryRuntime } from "../src/telemetry.js"

const temporaryDirectories: string[] = []

afterEach(async () => {
  await Promise.all(temporaryDirectories.splice(0).map((path) => rm(path, { recursive: true })))
})

describe("trace lifecycle", () => {
  it("builds agent, LLM, tool, skill, and assistant spans that match the gtrace structure", async () => {
    const exporter = new InMemorySpanExporter()
    const provider = new BasicTracerProvider({
      spanProcessors: [new SimpleSpanProcessor(exporter)],
    })
    const recorded = {
      workflows: 0,
      operations: 0,
      tokens: 0,
    }
    const runtime: TelemetryRuntime = {
      tracer: provider.getTracer("test"),
      contextFor(span) {
        return trace.setSpan(ROOT_CONTEXT, span)
      },
      recordWorkflow() {
        recorded.workflows += 1
      },
      recordOperation() {
        recorded.operations += 1
      },
      recordTokenUsage() {
        recorded.tokens += 1
      },
      forceFlush: () => provider.forceFlush(),
      shutdown: () => provider.shutdown(),
    }
    const directory = await mkdtemp(join(tmpdir(), "opencode-otel-plugin-"))
    temporaryDirectories.push(directory)
    const skillPath = join(directory, "demo-skill", "SKILL.md")
    await mkdir(join(directory, "demo-skill"), { recursive: true })
    await writeFile(
      skillPath,
      "---\nname: demo-skill\ndescription: Test skill\nversion: 1.0.0\n---\n",
    )

    const config = resolveConfig({ agentVersion: "1.18.8", captureContent: "preview" }, {})
    const lifecycle = new TraceLifecycle(runtime, config, directory, async () => undefined)
    const now = Date.now()

    await lifecycle.onEvent({
      type: "session.created",
      properties: {
        info: {
          id: "session-1",
          title: "Test Session",
          version: "1.18.8",
          directory,
          time: { created: now - 10, updated: now },
        },
      },
    })
    await lifecycle.onChatMessage(
      {
        sessionID: "session-1",
        agent: "build",
        model: { providerID: "openai", modelID: "gpt-test" },
      },
      {
        message: {
          id: "user-1",
          sessionID: "session-1",
          role: "user",
          time: { created: now },
          agent: "build",
          model: { providerID: "openai", modelID: "gpt-test" },
        },
        parts: [
          {
            id: "user-part-1",
            sessionID: "session-1",
            messageID: "user-1",
            type: "text",
            text: "Please run the test",
          },
        ],
      },
    )
    await lifecycle.onChatParams(
      {
        sessionID: "session-1",
        agent: "title",
        model: { id: "title-model", providerID: "openai", name: "Title Model" },
        provider: { info: { id: "openai" } },
      },
      { temperature: 0.2, topP: 1, topK: 0, maxOutputTokens: 64 },
    )
    await lifecycle.onChatParams(
      {
        sessionID: "session-1",
        agent: "build",
        model: { id: "gpt-test", providerID: "openai", name: "GPT Test" },
        provider: { info: { id: "openai" } },
      },
      { temperature: 0.2, topP: 1, topK: 0, maxOutputTokens: 4096 },
    )
    await lifecycle.onEvent({
      type: "message.updated",
      properties: {
        info: {
          id: "assistant-1",
          sessionID: "session-1",
          role: "assistant",
          time: { created: now + 1, completed: now + 2 },
          modelID: "gpt-test",
          providerID: "openai",
          cost: 0.01,
          tokens: { input: 10, output: 3, reasoning: 1, cache: { read: 2, write: 0 } },
          finish: "tool-calls",
        },
      },
    })
    await lifecycle.onToolBefore(
      { tool: "read", sessionID: "session-1", callID: "call-1" },
      { args: { filePath: skillPath } },
    )
    await lifecycle.onToolAfter(
      { tool: "read", sessionID: "session-1", callID: "call-1", args: { filePath: skillPath } },
      { title: "Read", output: "skill loaded", metadata: {} },
    )
    await lifecycle.onChatParams(
      {
        sessionID: "session-1",
        agent: "build",
        model: { id: "gpt-test", providerID: "openai" },
        provider: { info: { id: "openai" } },
      },
      { temperature: 0.2, topP: 1, topK: 0, maxOutputTokens: 4096 },
    )
    await lifecycle.onEvent({
      type: "message.part.updated",
      properties: {
        part: {
          id: "assistant-part-2",
          sessionID: "session-1",
          messageID: "assistant-2",
          type: "text",
          text: "Done",
          time: { start: now + 3, end: now + 4 },
        },
      },
    })
    await lifecycle.onEvent({
      type: "message.updated",
      properties: {
        info: {
          id: "assistant-2",
          sessionID: "session-1",
          role: "assistant",
          time: { created: now + 3, completed: now + 4 },
          modelID: "gpt-test",
          providerID: "openai",
          cost: 0.02,
          tokens: { input: 20, output: 5, reasoning: 2, cache: { read: 4, write: 1 } },
          finish: "stop",
        },
      },
    })
    await lifecycle.onEvent({
      type: "session.idle",
      properties: { sessionID: "session-1" },
    })

    const spans = exporter.getFinishedSpans()
    expect(spans.map((span) => span.name).sort()).toEqual(
      ["assistant", "invoke_agent", "llm", "llm", "skill:demo-skill", "tool:read"].sort(),
    )

    const root = spans.find((span) => span.name === "invoke_agent")
    const tool = spans.find((span) => span.name === "tool:read")
    const skill = spans.find((span) => span.name === "skill:demo-skill")
    const assistant = spans.find((span) => span.name === "assistant")
    expect(root).toBeDefined()
    expect(tool?.parentSpanContext?.spanId).toBe(root?.spanContext().spanId)
    expect(skill?.parentSpanContext?.spanId).toBe(tool?.spanContext().spanId)
    expect(assistant?.parentSpanContext?.spanId).toBe(root?.spanContext().spanId)
    expect(root?.attributes["gen_ai.usage.input_tokens"]).toBe(30)
    expect(root?.attributes["gen_ai.usage.output_tokens"]).toBe(8)
    expect(root?.attributes.tool_count).toBe(1)
    expect(root?.attributes.final_status).toBe("completed")
    expect(recorded).toEqual({ workflows: 1, operations: 4, tokens: 4 })

    await lifecycle.dispose()
  })
})
