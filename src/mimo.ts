import { readFileSync } from "node:fs"
import type { Plugin } from "@opencode-ai/plugin"
import { OpenCodeOtelPlugin } from "./index.js"

// MiMo's loader invokes every export. Expose only the host plugin function.
const MiMoOtelPlugin: Plugin = async (input, options = {}) => {
  try {
    let installedOptions: Record<string, unknown> = {}
    try {
      const parsed: unknown = JSON.parse(readFileSync(new URL("../mimo-options.json", import.meta.url), "utf8"))
      if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) return {}
      installedOptions = parsed as Record<string, unknown>
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== "ENOENT") return {}
    }
    return await OpenCodeOtelPlugin(input, { ...installedOptions, ...options, variant: "mimo" })
  } catch {
    // Telemetry initialization must not prevent the host from starting. Avoid
    // printing errors because configuration and exporter errors may contain secrets.
    return {}
  }
}
export default MiMoOtelPlugin
