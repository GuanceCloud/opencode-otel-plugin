import type { Hooks, Plugin, PluginModule } from "@opencode-ai/plugin"
import { resolveConfig } from "./config.js"
import { createFileLogger } from "./filelog.js"
import { TraceLifecycle, type LifecycleLogger } from "./lifecycle.js"
import { createTelemetry } from "./telemetry.js"

export { resolveConfig, type PluginConfig, type ContentCaptureMode } from "./config.js"
export { sanitize, stringifySanitized } from "./redaction.js"

const PERSISTED_MESSAGES = new Set([
  "gtrace disabled",
  "uploaded spans",
  "uploaded metrics",
  "failed",
])

export const OpenCodeOtelPlugin: Plugin = async (input, options = {}) => {
  const config = resolveConfig(options, process.env, { cwd: input.directory })
  const fileLog = createFileLogger(config)
  if (!config.enabled) {
    await fileLog("info", "gtrace disabled", undefined)
    return {}
  }

  const log: LifecycleLogger = async (level, message, extra = {}) => {
    if (!PERSISTED_MESSAGES.has(message)) return
    await fileLog(level, message, extra)
  }

  const runtime = createTelemetry(config, log)
  const lifecycle = new TraceLifecycle(runtime, config, input.directory, log)

  // Telemetry failures must not reject a host hook and abort business execution.
  const safely = async (hook: string, action: () => Promise<void>): Promise<void> => {
    try {
      await action()
    } catch {
      try {
        // Do not log the exception: it may contain tool output or credentials.
        await log("warn", "failed", { stage: "hook", hook })
      } catch {
        // Diagnostic logging must also fail open.
      }
    }
  }

  const hooks: Hooks = {
    "chat.message": async (hookInput, output) => {
      await safely("chat.message", () => lifecycle.onChatMessage(hookInput, output))
    },
    "chat.params": async (hookInput, output) => {
      await safely("chat.params", () => lifecycle.onChatParams(hookInput, output))
    },
    "tool.execute.before": async (hookInput, output) => {
      await safely("tool.execute.before", () => lifecycle.onToolBefore(hookInput, output))
    },
    "tool.execute.after": async (hookInput, output) => {
      await safely("tool.execute.after", () => lifecycle.onToolAfter(hookInput, output))
    },
    event: async ({ event }) => {
      await safely("event", () => lifecycle.onEvent(
        event as unknown as {
          type: string
          properties: Record<string, unknown>
        },
      ))
    },
    dispose: async () => {
      await safely("dispose", () => lifecycle.dispose())
    },
  }
  return hooks
}

const pluginModule: PluginModule = {
  id: "opencode-otel-plugin",
  server: OpenCodeOtelPlugin,
}

export default pluginModule
