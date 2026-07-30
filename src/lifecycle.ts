import {
  SpanStatusCode,
  type Attributes,
  type Context,
  type Span,
  type SpanOptions,
} from "@opentelemetry/api"
import type { PluginConfig } from "./config.js"
import { captureText, preview, stringifySanitized } from "./redaction.js"
import { detectSkills, type SkillInfo } from "./skills.js"
import type { TelemetryRuntime } from "./telemetry.js"

type LogLevel = "debug" | "info" | "warn" | "error"

export interface LifecycleLogger {
  (level: LogLevel, message: string, extra?: Record<string, unknown>): Promise<void>
}

interface SessionInfo {
  title?: string
  version?: string
  created?: number
  updated?: number
  directory?: string
}

interface LlmState {
  span: Span
  context: Context
  startedAt: number
  firstTokenAt?: number
  model: string
  provider: string
}

interface SkillSpanState {
  span: Span
  name: string
  startedAt: number
}

interface ToolState {
  span: Span
  sessionID: string
  toolName: string
  startedAt: number
  skills: SkillSpanState[]
}

interface TokenUsage {
  input: number
  output: number
  reasoning: number
  cacheRead: number
  cacheWrite: number
}

interface TurnState {
  sessionID: string
  span: Span
  context: Context
  startedAt: number
  inputText: string
  inputMessages?: string
  outputText: string
  outputMessages?: string
  responseModel?: string
  responseProvider?: string
  finishReason?: string
  activeLlm?: LlmState
  lastLlmSpanID?: string
  toolCount: number
  usage: TokenUsage
}

interface UserMessageLike {
  id: string
  sessionID: string
  role: "user"
  time: { created: number }
  agent: string
  model: { providerID: string; modelID: string }
  system?: string
}

interface AssistantMessageLike {
  id: string
  sessionID: string
  role: "assistant"
  time: { created: number; completed?: number }
  error?: { name?: string; data?: unknown }
  modelID: string
  providerID: string
  cost: number
  tokens: {
    input: number
    output: number
    reasoning: number
    cache: { read: number; write: number }
  }
  finish?: string
}

interface PartLike {
  id: string
  sessionID: string
  messageID: string
  type: string
  text?: string
  time?: { start?: number; end?: number; created?: number }
  callID?: string
  tool?: string
  state?: {
    status?: string
    error?: string
    output?: string
  }
}

function attributes(values: Record<string, unknown>): Attributes {
  const result: Attributes = {}
  for (const [key, value] of Object.entries(values)) {
    if (typeof value === "string" || typeof value === "number" || typeof value === "boolean") {
      result[key] = value
      continue
    }
    if (!Array.isArray(value)) continue
    if (value.every((item) => typeof item === "string")) result[key] = value as string[]
    else if (value.every((item) => typeof item === "number")) result[key] = value as number[]
    else if (value.every((item) => typeof item === "boolean")) result[key] = value as boolean[]
  }
  return result
}

function errorType(error: unknown): string {
  if (error && typeof error === "object" && "name" in error && typeof error.name === "string") {
    return error.name
  }
  if (error instanceof Error) return error.name
  return "UnknownError"
}

function errorMessage(error: unknown): string | undefined {
  if (error instanceof Error) return error.message
  if (!error || typeof error !== "object") return undefined
  const value = error as { message?: unknown; data?: { message?: unknown } }
  if (typeof value.message === "string") return value.message
  if (typeof value.data?.message === "string") return value.data.message
  return undefined
}

function textFromParts(parts: PartLike[]): string {
  return parts
    .filter((part) => part.type === "text" && typeof part.text === "string")
    .map((part) => part.text)
    .join("")
}

function messagePayload(role: string, parts: PartLike[], config: PluginConfig): string | undefined {
  if (config.captureContent === "none") return undefined
  const content = parts
    .filter((part) => part.type === "text" || part.type === "reasoning")
    .map((part) => ({
      type: part.type,
      content:
        typeof part.text === "string"
          ? captureText(part.text, config.captureContent, config.maxAttributeLength)
          : undefined,
    }))
  return stringifySanitized([{ role, parts: content }], config.maxAttributeLength)
}

function finishReason(reason?: string): string | undefined {
  if (!reason) return undefined
  if (reason === "tool-calls" || reason === "tool_calls") return "tool_call"
  if (reason === "stop") return "stop"
  if (reason === "length") return "length"
  return reason
}

function skillAttributes(skill: SkillInfo, callID: string): Attributes {
  return attributes({
    "gen_ai.operation.name": "skill",
    "gen_ai.skill.name": skill.name,
    "gen_ai.skill.path": skill.path,
    "gen_ai.skill.source.type": skill.sourceType,
    "gen_ai.skill.result.status": "completed",
    "gen_ai.skill.description": skill.description,
    "gen_ai.skill.version": skill.version,
    "skill.name": skill.name,
    "skill.path": skill.path,
    "skill.description": skill.description,
    "skill.source.type": skill.sourceType,
    "skill.result_status": "completed",
    skill_call_id: callID,
    status: "ok",
  })
}

export class TraceLifecycle {
  private readonly turns = new Map<string, TurnState>()
  private readonly tools = new Map<string, ToolState>()
  private readonly parts = new Map<string, Map<string, PartLike>>()
  private readonly sessions = new Map<string, SessionInfo>()
  private readonly completedMessages = new Set<string>()

  constructor(
    private readonly runtime: TelemetryRuntime,
    private readonly config: PluginConfig,
    private readonly directory: string,
    private readonly log: LifecycleLogger,
  ) {}

  async onChatMessage(
    input: {
      sessionID: string
      agent?: string
      model?: { providerID: string; modelID: string }
      variant?: string
    },
    output: { message: UserMessageLike; parts: PartLike[] },
  ): Promise<void> {
    const existing = this.turns.get(input.sessionID)
    if (existing) this.finishTurn(existing, "cancelled")

    this.storeParts(output.parts)
    const userText = textFromParts(output.parts)
    if (!userText.trim() && output.parts.length === 0) return

    const session = this.sessions.get(input.sessionID)
    const inputPreview = preview(userText, this.config.maxAttributeLength)
    const inputMessages = messagePayload("user", output.parts, this.config)
    const span = this.runtime.tracer.startSpan("invoke_agent", {
      startTime: output.message.time.created,
      attributes: attributes({
        "gen_ai.conversation.id": input.sessionID,
        session_id: input.sessionID,
        "gen_ai.operation.name": "invoke_agent",
        "gen_ai.request.model": input.model?.modelID ?? output.message.model.modelID,
        "gen_ai.provider.name": input.model?.providerID ?? output.message.model.providerID,
        "gen_ai.agent.name": input.agent ?? output.message.agent ?? this.config.agentName,
        "gen_ai.input.messages": inputMessages,
        input_preview:
          this.config.captureContent === "none" ? undefined : inputPreview.value,
        input_length: inputPreview.length,
        "gen_ai.request.variant": input.variant,
        "session.title": session?.title,
        "session.version": session?.version,
        session_create_at: session?.created,
        session_updated_at: session?.updated,
        status: "ok",
      }),
    })
    this.turns.set(input.sessionID, {
      sessionID: input.sessionID,
      span,
      context: this.runtime.contextFor(span),
      startedAt: output.message.time.created,
      inputText: userText,
      inputMessages,
      outputText: "",
      toolCount: 0,
      usage: { input: 0, output: 0, reasoning: 0, cacheRead: 0, cacheWrite: 0 },
    })
    await this.log("debug", "turn created", {
      sessionID: input.sessionID,
      agent: input.agent ?? output.message.agent,
      providerID: input.model?.providerID ?? output.message.model.providerID,
      modelID: input.model?.modelID ?? output.message.model.modelID,
      inputLength: userText.length,
      inputParts: output.parts.length,
    })
  }

  async onChatParams(
    input: {
      sessionID: string
      agent: string
      model: { id: string; providerID: string; name?: string }
      provider?: { id?: string; name?: string; info?: { id?: string; name?: string } }
    },
    output: {
      temperature: number
      topP: number
      topK: number
      maxOutputTokens: number | undefined
    },
  ): Promise<void> {
    // OpenCode uses an internal title agent to generate session titles.
    // It is not part of the user turn model flow.
    if (input.agent === "title") return
    const turn = this.ensureTurn(input.sessionID)
    if (turn.activeLlm) this.finishLlm(turn, undefined, "unset")
    await this.log("debug", "llm request started", {
      sessionID: input.sessionID,
      providerID: input.provider?.info?.id ?? input.provider?.id ?? input.model.providerID,
      modelID: input.model.id,
      temperature: output.temperature,
      topP: output.topP,
      topK: output.topK,
      maxOutputTokens: output.maxOutputTokens,
    })

    const startedAt = Date.now()
    const span = this.runtime.tracer.startSpan(
      "llm",
      {
        startTime: startedAt,
        attributes: attributes({
          "gen_ai.conversation.id": input.sessionID,
          session_id: input.sessionID,
          "gen_ai.operation.name": "chat",
          "gen_ai.request.model": input.model.id,
          "gen_ai.request.model_name": input.model.name,
          "gen_ai.provider.name":
            input.provider?.info?.id ?? input.provider?.id ?? input.model.providerID,
          "gen_ai.input.messages": turn.toolCount === 0 ? turn.inputMessages : undefined,
          input_preview:
            turn.toolCount === 0 && this.config.captureContent !== "none"
              ? preview(turn.inputText, this.config.maxAttributeLength).value
              : undefined,
          input_length: turn.toolCount === 0 ? turn.inputText.length : undefined,
          "gen_ai.request.temperature": output.temperature,
          "gen_ai.request.top_p": output.topP,
          "gen_ai.request.top_k": output.topK,
          "gen_ai.request.max_tokens": output.maxOutputTokens,
          "gen_ai.agent.name": input.agent,
          status: "ok",
        }),
      },
      turn.context,
    )
    turn.activeLlm = {
      span,
      context: this.runtime.contextFor(span),
      startedAt,
      model: input.model.id,
      provider: input.provider?.info?.id ?? input.provider?.id ?? input.model.providerID,
    }
  }

  async onToolBefore(
    input: { tool: string; sessionID: string; callID: string },
    output: { args: unknown },
  ): Promise<void> {
    const turn = this.ensureTurn(input.sessionID)
    const key = this.toolKey(input.sessionID, input.callID)
    const previous = this.tools.get(key)
    if (previous) this.finishTool(previous, "error", "DuplicateToolCall")
    await this.log("debug", "tool execution started", {
      sessionID: input.sessionID,
      callID: input.callID,
      tool: input.tool,
    })

    const span = this.runtime.tracer.startSpan(
      `tool:${input.tool}`,
      {
        attributes: attributes({
          "gen_ai.conversation.id": input.sessionID,
          session_id: input.sessionID,
          "gen_ai.operation.name": "execute_tool",
          "gen_ai.tool.name": input.tool,
          "gen_ai.tool.call.id": input.callID,
          "gen_ai.tool.call.arguments":
            this.config.captureContent === "none"
              ? undefined
              : stringifySanitized(output.args, this.config.maxAttributeLength),
          tool_command:
            this.config.captureContent === "none"
              ? undefined
              : this.toolCommand(input.tool, output.args),
          "triggered_by.llm_span_id": turn.lastLlmSpanID,
          status: "ok",
        }),
      },
      turn.context,
    )
    const toolState: ToolState = {
      span,
      sessionID: input.sessionID,
      toolName: input.tool,
      startedAt: Date.now(),
      skills: [],
    }
    this.tools.set(key, toolState)
    turn.toolCount += 1

    for (const skill of await detectSkills(output.args, this.directory)) {
      if (toolState.skills.length === 0) {
        span.setAttributes(
          attributes({
            "gen_ai.skill.name": skill.name,
            "gen_ai.skill.path": skill.path,
            "gen_ai.skill.source.type": skill.sourceType,
            "gen_ai.skill.description": skill.description,
            "gen_ai.skill.version": skill.version,
            "skill.name": skill.name,
            "skill.path": skill.path,
            "skill.source.type": skill.sourceType,
            skill_call_id: input.callID,
          }),
        )
      }
      toolState.skills.push({
        span: this.runtime.tracer.startSpan(
          `skill:${skill.name}`,
          { attributes: skillAttributes(skill, input.callID) },
          this.runtime.contextFor(span),
        ),
        name: skill.name,
        startedAt: Date.now(),
      })
    }
  }

  async onToolAfter(
    input: { tool: string; sessionID: string; callID: string; args: unknown },
    output: { title: string; output: string; metadata: unknown },
  ): Promise<void> {
    const key = this.toolKey(input.sessionID, input.callID)
    const state = this.tools.get(key)
    if (!state) return

    state.span.setAttributes(
      attributes({
        "gen_ai.tool.call.result":
          this.config.captureContent === "none"
            ? undefined
            : stringifySanitized(output.output, this.config.maxAttributeLength),
        "gen_ai.tool.result.title": output.title,
        "gen_ai.tool.result.metadata":
          this.config.captureContent === "none"
            ? undefined
            : stringifySanitized(output.metadata, this.config.maxAttributeLength),
        tool_result_status: "success",
        status: "ok",
      }),
    )
    this.finishTool(state, "ok")
    this.tools.delete(key)
    await this.log("debug", "tool execution completed", {
      sessionID: input.sessionID,
      callID: input.callID,
      tool: input.tool,
      title: output.title,
    })
  }

  async onEvent(event: {
    type: string
    properties: Record<string, unknown>
  }): Promise<void> {
    if (event.type === "session.created" || event.type === "session.updated") {
      const info = event.properties.info as
        | {
            id: string
            title?: string
            version?: string
            directory?: string
            time?: { created?: number; updated?: number }
          }
        | undefined
      if (info?.id) {
        this.sessions.set(info.id, {
          title: info.title,
          version: info.version,
          directory: info.directory,
          created: info.time?.created,
          updated: info.time?.updated,
        })
        await this.log("debug", "session metadata updated", {
          sessionID: info.id,
          title: info.title,
          version: info.version,
          directory: info.directory,
          eventType: event.type,
        })
      }
      return
    }

    if (event.type === "message.part.updated") {
      const part = event.properties.part as PartLike | undefined
      if (!part) return
      this.storeParts([part])
      const turn = this.turns.get(part.sessionID)
      if (part.type === "tool" && part.callID && part.state?.status === "error") {
        const key = this.toolKey(part.sessionID, part.callID)
        const tool = this.tools.get(key)
        if (tool) {
          const type = part.state.error ? "ToolExecutionError" : "UnknownToolError"
          tool.span.setAttributes(
            attributes({
              "gen_ai.tool.call.result":
                this.config.captureContent === "none"
                  ? undefined
                  : stringifySanitized(part.state.error ?? "", this.config.maxAttributeLength),
              tool_result_status: "error",
              reason:
                this.config.captureContent === "none"
                  ? undefined
                  : stringifySanitized(part.state.error ?? "", this.config.maxAttributeLength),
            }),
          )
          this.finishTool(tool, "error", type)
          this.tools.delete(key)
          await this.log("warn", "tool execution failed", {
            sessionID: part.sessionID,
            callID: part.callID,
            tool: tool.toolName,
            errorType: type,
          })
        }
      }
      if (
        turn?.activeLlm &&
        turn.activeLlm.firstTokenAt === undefined &&
        (part.type === "text" || part.type === "reasoning")
      ) {
        const firstTokenAt = part.time?.start ?? Date.now()
        turn.activeLlm.firstTokenAt = firstTokenAt
        turn.activeLlm.span.setAttribute(
          "ttft",
          Math.max(0, firstTokenAt - turn.activeLlm.startedAt),
        )
      }
      return
    }

    if (event.type === "message.updated") {
      const message = event.properties.info as UserMessageLike | AssistantMessageLike | undefined
      if (message?.role !== "assistant" || (!message.time.completed && !message.error)) return
      await this.onAssistantCompleted(message)
      return
    }

    if (event.type === "session.idle") {
      const sessionID = event.properties.sessionID
      if (typeof sessionID !== "string") return
      await this.log("debug", "received session.idle", { sessionID })
      const turn = this.turns.get(sessionID)
      if (turn) {
        if (turn.activeLlm) this.finishLlm(turn, undefined, "unset")
        this.finishTurn(turn, "completed")
      }
      await this.runtime.forceFlush().catch((error: unknown) =>
        this.log("warn", "otlp forceFlush failed", { error: errorMessage(error) }),
      )
      return
    }

    if (event.type === "session.error") {
      const sessionID = event.properties.sessionID
      if (typeof sessionID !== "string") return
      const turn = this.turns.get(sessionID)
      if (!turn) return
      const error = event.properties.error
      await this.log("warn", "received session.error", {
        sessionID,
        errorType: errorType(error),
        errorMessage: errorMessage(error),
      })
      this.finishTurn(turn, "cancelled", error)
      await this.runtime.forceFlush().catch((flushError: unknown) =>
        this.log("warn", "otlp forceFlush failed", { error: errorMessage(flushError) }),
      )
    }
  }

  async dispose(): Promise<void> {
    await this.log("info", "trace lifecycle dispose started", {
      activeTurns: this.turns.size,
      activeTools: this.tools.size,
    })
    for (const turn of [...this.turns.values()]) this.finishTurn(turn, "cancelled")
    await this.runtime.shutdown()
    await this.log("info", "trace lifecycle dispose completed")
  }

  private async onAssistantCompleted(message: AssistantMessageLike): Promise<void> {
    if (this.completedMessages.has(message.id)) return
    this.completedMessages.add(message.id)
    const turn = this.turns.get(message.sessionID)
    if (!turn) return

    const parts = [...(this.parts.get(message.id)?.values() ?? [])]
    const outputText = textFromParts(parts)
    if (outputText) {
      turn.outputText = outputText
      turn.outputMessages = messagePayload("assistant", parts, this.config)
    }
    turn.responseModel = message.modelID
    turn.responseProvider = message.providerID
    turn.finishReason = finishReason(message.finish)
    turn.usage.input += message.tokens.input
    turn.usage.output += message.tokens.output
    turn.usage.reasoning += message.tokens.reasoning
    turn.usage.cacheRead += message.tokens.cache.read
    turn.usage.cacheWrite += message.tokens.cache.write

    if (turn.activeLlm) this.finishLlm(turn, message, message.error ? "error" : "ok", parts)
    await this.log("debug", "assistant message completed", {
      sessionID: message.sessionID,
      messageID: message.id,
      providerID: message.providerID,
      modelID: message.modelID,
      finishReason: turn.finishReason,
      outputLength: outputText.length,
      inputTokens: message.tokens.input,
      outputTokens: message.tokens.output,
      reasoningTokens: message.tokens.reasoning,
      hasError: Boolean(message.error),
    })

    if (outputText && finishReason(message.finish) !== "tool_call") {
      const completedAt = message.time.completed ?? Date.now()
      const outputPreview = preview(outputText, this.config.maxAttributeLength)
      const span = this.runtime.tracer.startSpan(
        "assistant",
        {
          startTime: completedAt,
          attributes: attributes({
            "gen_ai.conversation.id": message.sessionID,
            session_id: message.sessionID,
            "gen_ai.output.messages": messagePayload("assistant", parts, this.config),
            "gen_ai.output.type": "text",
            "gen_ai.provider.name": message.providerID,
            "gen_ai.request.model": message.modelID,
            "gen_ai.response.model": message.modelID,
            output_preview:
              this.config.captureContent === "none" ? undefined : outputPreview.value,
            output_length: outputPreview.length,
            output_kind: "text",
            status: message.error ? "error" : "ok",
            "error.type": message.error ? errorType(message.error) : undefined,
          }),
        },
        turn.context,
      )
      if (message.error) {
        span.setStatus({ code: SpanStatusCode.ERROR, message: errorMessage(message.error) })
      } else {
        span.setStatus({ code: SpanStatusCode.OK })
      }
      span.end(completedAt)
    }
  }

  private finishLlm(
    turn: TurnState,
    message: AssistantMessageLike | undefined,
    status: "ok" | "error" | "unset",
    parts: PartLike[] = [],
  ): void {
    const llm = turn.activeLlm
    if (!llm) return
    const outputText = textFromParts(parts)
    const outputPreview = preview(outputText, this.config.maxAttributeLength)
    llm.span.setAttributes(
      attributes({
        "gen_ai.response.model": message?.modelID,
        "gen_ai.provider.name": message?.providerID,
        "gen_ai.usage.input_tokens": message?.tokens.input,
        "gen_ai.usage.output_tokens": message?.tokens.output,
        "gen_ai.usage.reasoning.output_tokens": message?.tokens.reasoning,
        "gen_ai.usage.cache_read.input_tokens": message?.tokens.cache.read,
        "gen_ai.usage.cache_write.input_tokens": message?.tokens.cache.write,
        "gen_ai.response.finish_reasons": finishReason(message?.finish)
          ? [finishReason(message?.finish)]
          : undefined,
        "gen_ai.output.messages": messagePayload("assistant", parts, this.config),
        "gen_ai.output.type": outputText ? "text" : undefined,
        output_preview:
          this.config.captureContent === "none" ? undefined : outputPreview.value,
        output_length: outputPreview.length,
        output_kind: finishReason(message?.finish) === "tool_call" ? "tool_call" : "text",
        "gen_ai.response.cost": message?.cost,
        status,
        "error.type": message?.error ? errorType(message.error) : undefined,
        "error.message": message?.error
          ? captureText(
              errorMessage(message.error) ?? "",
              this.config.captureContent,
              this.config.maxAttributeLength,
            )
          : undefined,
      }),
    )
    if (status === "error") {
      llm.span.setStatus({ code: SpanStatusCode.ERROR, message: errorMessage(message?.error) })
    } else if (status === "ok") {
      llm.span.setStatus({ code: SpanStatusCode.OK })
    }
    const endedAt = message?.time.completed ?? Date.now()
    const metricStatus = status === "error" ? "error" : "completed"
    const metricAttributes = attributes({
      agent_runtime: "opencode",
      "gen_ai.conversation.id": turn.sessionID,
      session_id: turn.sessionID,
      "gen_ai.operation.name": "chat",
      status: metricStatus,
      "gen_ai.provider.name": message?.providerID ?? llm.provider,
      "gen_ai.request.model": llm.model,
      "gen_ai.response.model": message?.modelID,
      "error.type": message?.error ? errorType(message.error) : undefined,
    })
    if (status !== "unset") {
      this.runtime.recordOperation(Math.max(0, endedAt - llm.startedAt), metricAttributes)
      this.runtime.recordTokenUsage(message?.tokens.input ?? 0, {
        ...metricAttributes,
        "gen_ai.token.type": "input",
      })
      this.runtime.recordTokenUsage(message?.tokens.output ?? 0, {
        ...metricAttributes,
        "gen_ai.token.type": "output",
      })
    }
    turn.lastLlmSpanID = llm.span.spanContext().spanId
    llm.span.end(endedAt)
    turn.activeLlm = undefined
    void this.log("debug", "llm request finished", {
      sessionID: turn.sessionID,
      modelID: llm.model,
      providerID: llm.provider,
      status,
      durationMs: Math.max(0, endedAt - llm.startedAt),
      outputLength: outputText.length,
      errorType: message?.error ? errorType(message.error) : undefined,
    })
  }

  private finishTurn(
    turn: TurnState,
    finalStatus: "completed" | "cancelled",
    error?: unknown,
  ): void {
    if (turn.activeLlm) this.finishLlm(turn, undefined, error ? "error" : "unset")
    for (const [key, tool] of [...this.tools]) {
      if (!key.startsWith(`${turn.sessionID}:`)) continue
      this.finishTool(tool, "error", error ? errorType(error) : "Cancelled")
      this.tools.delete(key)
    }

    const outputPreview = preview(turn.outputText, this.config.maxAttributeLength)
    const session = this.sessions.get(turn.sessionID)
    turn.span.setAttributes(
      attributes({
        "gen_ai.output.messages": turn.outputMessages,
        "gen_ai.output.type": turn.outputText ? "text" : undefined,
        "gen_ai.response.model": turn.responseModel,
        "gen_ai.provider.name": turn.responseProvider,
        "gen_ai.response.finish_reasons": turn.finishReason ? [turn.finishReason] : undefined,
        output_preview:
          this.config.captureContent === "none" ? undefined : outputPreview.value,
        output_length: outputPreview.length,
        "gen_ai.usage.input_tokens": turn.usage.input,
        "gen_ai.usage.output_tokens": turn.usage.output,
        "gen_ai.usage.reasoning.output_tokens": turn.usage.reasoning,
        "gen_ai.usage.cache_read.input_tokens": turn.usage.cacheRead,
        "gen_ai.usage.cache_write.input_tokens": turn.usage.cacheWrite,
        tool_count: turn.toolCount,
        final_status: finalStatus,
        "session.title": session?.title,
        session_updated_at: session?.updated,
        status: error || finalStatus === "cancelled" ? "error" : "ok",
        "error.type": error ? errorType(error) : undefined,
        "error.message": error
          ? captureText(
              errorMessage(error) ?? "",
              this.config.captureContent,
              this.config.maxAttributeLength,
            )
          : undefined,
      }),
    )
    if (error) {
      turn.span.setStatus({ code: SpanStatusCode.ERROR, message: errorMessage(error) })
    } else {
      turn.span.setStatus({ code: SpanStatusCode.OK })
    }
    this.runtime.recordWorkflow(Math.max(0, Date.now() - turn.startedAt), {
      agent_runtime: "opencode",
      "gen_ai.conversation.id": turn.sessionID,
      session_id: turn.sessionID,
      final_status: finalStatus,
      "error.type": error ? errorType(error) : undefined,
    })
    turn.span.end()
    this.turns.delete(turn.sessionID)
    void this.log("info", "turn finished", {
      sessionID: turn.sessionID,
      finalStatus,
      toolCount: turn.toolCount,
      inputTokens: turn.usage.input,
      outputTokens: turn.usage.output,
      reasoningTokens: turn.usage.reasoning,
      errorType: error ? errorType(error) : undefined,
      errorMessage: error ? errorMessage(error) : undefined,
    })
  }

  private finishTool(state: ToolState, status: "ok" | "error", type?: string): void {
    const endedAt = Date.now()
    for (const skillState of state.skills) {
      const skill = skillState.span
      if (status === "error") {
        skill.setAttributes(
          attributes({
            status: "error",
            "error.type": type,
            "gen_ai.skill.result.status": "error",
            "skill.result_status": "error",
          }),
        )
        skill.setStatus({ code: SpanStatusCode.ERROR })
      } else {
        skill.setStatus({ code: SpanStatusCode.OK })
      }
      skill.end()
      this.runtime.recordOperation(Math.max(0, endedAt - skillState.startedAt), {
        agent_runtime: "opencode",
        "gen_ai.conversation.id": state.sessionID,
        session_id: state.sessionID,
        "gen_ai.operation.name": "skill",
        status: status === "error" ? "error" : "completed",
        "gen_ai.skill.name": skillState.name,
        "error.type": status === "error" ? type ?? "_OTHER" : undefined,
      })
    }
    if (status === "error") {
      state.span.setAttributes(
        attributes({
          status: "error",
          "error.type": type,
          tool_result_status: "error",
          reason: type,
        }),
      )
      state.span.setStatus({ code: SpanStatusCode.ERROR })
    } else {
      state.span.setStatus({ code: SpanStatusCode.OK })
    }
    state.span.end()
    this.runtime.recordOperation(Math.max(0, endedAt - state.startedAt), {
      agent_runtime: "opencode",
      "gen_ai.conversation.id": state.sessionID,
      session_id: state.sessionID,
      "gen_ai.operation.name": "execute_tool",
      status: status === "error" ? "error" : "completed",
      "gen_ai.tool.name": state.toolName,
      "error.type": status === "error" ? type ?? "_OTHER" : undefined,
    })
    void this.log("debug", "tool span finished", {
      sessionID: state.sessionID,
      tool: state.toolName,
      status,
      errorType: type,
      durationMs: Math.max(0, endedAt - state.startedAt),
      skillCount: state.skills.length,
    })
  }

  private ensureTurn(sessionID: string): TurnState {
    const existing = this.turns.get(sessionID)
    if (existing) return existing
    const startedAt = Date.now()
    const span = this.runtime.tracer.startSpan("invoke_agent", {
      startTime: startedAt,
      attributes: attributes({
        "gen_ai.conversation.id": sessionID,
        session_id: sessionID,
        "gen_ai.operation.name": "invoke_agent",
        "gen_ai.agent.name": this.config.agentName,
        status: "ok",
      }),
    })
    const turn: TurnState = {
      sessionID,
      span,
      context: this.runtime.contextFor(span),
      startedAt,
      inputText: "",
      inputMessages: undefined,
      outputText: "",
      toolCount: 0,
      usage: { input: 0, output: 0, reasoning: 0, cacheRead: 0, cacheWrite: 0 },
    }
    this.turns.set(sessionID, turn)
    return turn
  }

  private storeParts(parts: PartLike[]): void {
    for (const part of parts) {
      const items = this.parts.get(part.messageID) ?? new Map<string, PartLike>()
      items.set(part.id, part)
      this.parts.set(part.messageID, items)
    }
  }

  private toolKey(sessionID: string, callID: string): string {
    return `${sessionID}:${callID}`
  }

  private toolCommand(tool: string, args: unknown): string | undefined {
    if (!args || typeof args !== "object") return undefined
    const values = args as Record<string, unknown>
    const command = values.command ?? values.cmd ?? values.path ?? values.filePath
    if (typeof command !== "string") return undefined
    return stringifySanitized(`${tool} ${command}`, this.config.maxAttributeLength)
  }
}
