import { appendFileSync, mkdirSync } from "node:fs"
import { dirname } from "node:path"
import type { PluginConfig } from "./config.js"

export type FileLogLevel = "debug" | "info" | "warn" | "error"

export interface FileLogger {
  (level: FileLogLevel, message: string, extra?: Record<string, unknown>): Promise<void>
}

function serialize(level: FileLogLevel, message: string, extra: Record<string, unknown>): string {
  const payload: Record<string, unknown> = {
    ts: new Date().toISOString(),
    message,
  }
  if (Object.keys(extra).length > 0) payload.extra = extra
  return `${JSON.stringify(payload)}\n`
}

export function createFileLogger(config: PluginConfig): FileLogger {
  return async (level, message, extra = {}) => {
    if (level === "debug" && !config.debug) return
    try {
      mkdirSync(dirname(config.hookLogFile), { recursive: true })
      appendFileSync(config.hookLogFile, serialize(level, message, extra), "utf8")
    } catch {
      // Local diagnostic logging must never break the main flow.
    }
  }
}
