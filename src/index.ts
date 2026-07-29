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

  const hooks: Hooks = {
    "chat.message": async (hookInput, output) => {
      await lifecycle.onChatMessage(hookInput, output)
    },
    "chat.params": async (hookInput, output) => {
      await lifecycle.onChatParams(hookInput, output)
    },
    "tool.execute.before": async (hookInput, output) => {
      await lifecycle.onToolBefore(hookInput, output)
    },
    "tool.execute.after": async (hookInput, output) => {
      await lifecycle.onToolAfter(hookInput, output)
    },
    event: async ({ event }) => {
      await lifecycle.onEvent(
        event as unknown as {
          type: string
          properties: Record<string, unknown>
        },
      )
    },
    dispose: async () => {
      await lifecycle.dispose()
    },
  }
  return hooks
}

const pluginModule: PluginModule = {
  id: "opencode-otel-plugin",
  server: OpenCodeOtelPlugin,
}

export default pluginModule
