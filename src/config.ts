import { readFileSync } from "node:fs"
import { homedir } from "node:os"
import { join } from "node:path"

export type ContentCaptureMode = "none" | "preview" | "full"

export interface PluginConfig {
  enabled: boolean
  endpoint: string
  tracePath: string
  metricsPath: string
  traceUrl: string
  metricsUrl: string
  headers: Record<string, string>
  metricsEnabled: boolean
  serviceName: string
  environment: string
  agentId: string
  agentName: string
  agentVersion: string
  captureContent: ContentCaptureMode
  maxAttributeLength: number
  batchDelayMs: number
  exportTimeoutMs: number
  resourceAttributes: Record<string, string | number | boolean>
  debug: boolean
  hookLogFile: string
  configSourceFiles: string[]
  configSourceWarnings: string[]
}

export interface ResolveConfigContext {
  cwd?: string
  home?: string
}

const DEFAULT_ENDPOINT = "http://127.0.0.1:9529"
const DEFAULT_TRACE_PATH = "otel/v1/traces"
const DEFAULT_METRICS_PATH = "otel/v1/metrics"

function booleanValue(value: unknown, fallback: boolean): boolean {
  if (typeof value === "boolean") return value
  if (typeof value !== "string") return fallback
  const normalized = value.trim().toLowerCase()
  if (["1", "true", "yes", "on"].includes(normalized)) return true
  if (["0", "false", "no", "off"].includes(normalized)) return false
  return fallback
}

function integerValue(value: unknown, fallback: number, minimum: number, maximum: number): number {
  const parsed = typeof value === "number" ? value : Number.parseInt(String(value ?? ""), 10)
  if (!Number.isFinite(parsed)) return fallback
  return Math.min(maximum, Math.max(minimum, Math.trunc(parsed)))
}

function stringValue(value: unknown, fallback: string): string {
  if (typeof value !== "string") return fallback
  const trimmed = value.trim()
  return trimmed || fallback
}

function endpointValue(value: unknown, fallback: string): string {
  return stringValue(value, fallback).replace(/\/+$/, "")
}

function captureMode(value: unknown): ContentCaptureMode {
  if (value === "none" || value === "preview" || value === "full") return value
  return "preview"
}

function resourceAttributes(value: unknown): Record<string, string | number | boolean> {
  if (typeof value === "string") {
    try {
      return resourceAttributes(JSON.parse(value))
    } catch {
      return {}
    }
  }
  if (!value || typeof value !== "object" || Array.isArray(value)) return {}
  return Object.fromEntries(
    Object.entries(value as Record<string, unknown>).filter(
      (entry): entry is [string, string | number | boolean] =>
        entry[0].trim().length > 0 &&
        (typeof entry[1] === "string" ||
          typeof entry[1] === "number" ||
          typeof entry[1] === "boolean"),
    ),
  )
}

function stringList(value: unknown): string[] {
  if (Array.isArray(value)) {
    return value
      .map((item) => String(item).trim())
      .filter((item) => item.length > 0)
  }
  if (typeof value !== "string") return []
  const trimmed = value.trim()
  if (!trimmed) return []
  if (trimmed.startsWith("[")) {
    try {
      return stringList(JSON.parse(trimmed))
    } catch {
      return []
    }
  }
  return trimmed
    .split(",")
    .map((item) => item.trim())
    .filter((item) => item.length > 0)
}

function tagsToResourceAttributes(value: unknown): Record<string, string> {
  const tags = stringList(value)
  const result: Record<string, string> = {}
  for (const tag of tags) {
    const separator = tag.indexOf("=")
    if (separator <= 0) continue
    const key = tag.slice(0, separator).trim()
    const item = tag.slice(separator + 1).trim()
    if (key && item) result[key] = item
  }
  return result
}

function pathValue(value: unknown, fallback: string): string {
  return stringValue(value, fallback).replace(/^\/+|\/+$/g, "")
}

function readJsonIfExists(file: string): {
  values: Record<string, unknown>
  loaded: boolean
  warning?: string
} {
  try {
    const content = readFileSync(file, "utf8").replace(/^\uFEFF/, "")
    if (!content.trim()) return { values: {}, loaded: true }
    const parsed = JSON.parse(content)
    if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) {
      return { values: {}, loaded: true, warning: `配置文件不是 JSON 对象: ${file}` }
    }
    return { values: parsed as Record<string, unknown>, loaded: true }
  } catch (error) {
    if (
      typeof error === "object" &&
      error !== null &&
      "code" in error &&
      (error as { code?: string }).code === "ENOENT"
    ) {
      return { values: {}, loaded: false }
    }
    return {
      values: {},
      loaded: true,
      warning: `读取配置文件失败: ${file}`,
    }
  }
}

function resolveGtraceConfig(context: ResolveConfigContext): {
  values: Record<string, unknown>
  loadedFiles: string[]
  warnings: string[]
} {
  const home = context.home ?? homedir()
  const cwd = context.cwd ?? process.cwd()
  const globalFile = join(home, ".config", "opencode", "gtrace.json")
  const localFile = join(cwd, ".opencode", "gtrace.json")
  const globalConfig = readJsonIfExists(globalFile)
  const localConfig = readJsonIfExists(localFile)
  const loadedFiles = [...new Set(
    [globalConfig.loaded ? globalFile : "", localConfig.loaded ? localFile : ""].filter(
      (item) => item.length > 0,
    ),
  )]
  const warnings = [globalConfig.warning, localConfig.warning].filter(
    (item): item is string => typeof item === "string" && item.length > 0,
  )
  return {
    values: {
      ...globalConfig.values,
      ...localConfig.values,
    },
    loadedFiles,
    warnings,
  }
}

export function resolveSignalUrl(endpoint: string, signalPath: string, explicitUrl?: string): string {
  if (explicitUrl?.trim()) return explicitUrl.trim()
  const normalizedEndpoint = endpoint.trim().replace(/\/+$/, "")
  const normalizedPath = signalPath.trim().replace(/^\/+|\/+$/g, "")
  if (!normalizedPath) return normalizedEndpoint
  if (
    normalizedEndpoint.endsWith("/v1/traces") &&
    normalizedPath.endsWith("/v1/traces")
  ) {
    return normalizedEndpoint
  }
  if (normalizedEndpoint.endsWith(`/${normalizedPath}`)) return normalizedEndpoint
  return `${normalizedEndpoint}/${normalizedPath}`
}

export function parseHeaders(value: unknown): Record<string, string> {
  if (!value) return {}
  if (typeof value === "object" && !Array.isArray(value)) {
    return Object.fromEntries(
      Object.entries(value as Record<string, unknown>)
        .filter((entry): entry is [string, string] => typeof entry[1] === "string")
        .map(([key, item]): [string, string] => [key.trim(), item.trim()])
        .filter(([key]) => key.length > 0),
    )
  }
  if (typeof value !== "string") return {}
  const trimmed = value.trim()
  if (trimmed.startsWith("{")) {
    try {
      return parseHeaders(JSON.parse(trimmed))
    } catch {
      return {}
    }
  }
  return Object.fromEntries(
    trimmed
      .split(",")
      .map((item) => item.split("=", 2))
      .filter((item): item is [string, string] => item.length === 2)
      .map(([key, item]): [string, string] => [key.trim(), item.trim()])
      .filter(([key]) => key.length > 0),
  )
}

export function resolveConfig(
  options: Record<string, unknown> = {},
  env: NodeJS.ProcessEnv = process.env,
  context: ResolveConfigContext = {},
): PluginConfig {
  const gtrace = resolveGtraceConfig(context)
  const gtraceValues = gtrace.values
  const home = context.home ?? homedir()
  const endpoint = endpointValue(
    options.endpoint ?? env.OPENCODE_OTEL_ENDPOINT ?? gtraceValues.endpoint ?? gtraceValues.base_url,
    DEFAULT_ENDPOINT,
  )
  const tracePath = pathValue(
    options.tracePath ?? env.OPENCODE_OTEL_TRACE_PATH ?? gtraceValues.tracePath,
    DEFAULT_TRACE_PATH,
  )
  const configuredMetricsPath =
    options.metricsPath ?? env.OPENCODE_OTEL_METRICS_PATH ?? gtraceValues.metricsPath
  const metricsPath = pathValue(configuredMetricsPath, DEFAULT_METRICS_PATH)
  const publicKey = stringValue(
    options.publicKey ?? env.OPENCODE_OTEL_PUBLIC_KEY ?? gtraceValues.public_key,
    "",
  )
  const secretKey = stringValue(
    options.secretKey ?? env.OPENCODE_OTEL_SECRET_KEY ?? gtraceValues.secret_key,
    "",
  )
  const headers = parseHeaders(
    options.headers ?? env.OPENCODE_OTEL_HEADERS ?? gtraceValues.headers,
  )
  if (
    (publicKey || secretKey) &&
    headers.Authorization === undefined &&
    headers.authorization === undefined
  ) {
    headers.Authorization = `Basic ${Buffer.from(`${publicKey}:${secretKey}`).toString("base64")}`
  }
  const normalizedEndpoint = endpoint.replace(/\/+$/, "")
  const normalizedTraceSuffix = `/${tracePath}`
  const metricsEndpoint = normalizedEndpoint.endsWith(normalizedTraceSuffix)
    ? normalizedEndpoint.slice(0, -normalizedTraceSuffix.length)
    : endpoint
  const explicitMetricsUrl = stringValue(
    options.otelMetricsUrl ?? env.OPENCODE_OTEL_METRICS_URL ?? gtraceValues.otel_metrics_url,
    "",
  )
  const inferredMetricsUrl =
    !explicitMetricsUrl &&
    options.metricsPath === undefined &&
    env.OPENCODE_OTEL_METRICS_PATH === undefined &&
    gtraceValues.metricsPath === undefined &&
    normalizedEndpoint.endsWith("/v1/traces")
      ? `${normalizedEndpoint.slice(0, -"traces".length)}metrics`
      : undefined
  const mergedResourceAttributes = {
    ...tagsToResourceAttributes(gtraceValues.tags),
    ...resourceAttributes(gtraceValues.resourceAttributes),
    ...resourceAttributes(options.resourceAttributes ?? env.OPENCODE_OTEL_RESOURCE_ATTRIBUTES),
  }

  return {
    enabled: booleanValue(
      options.enabled ?? env.OPENCODE_OTEL_ENABLED ?? gtraceValues.enabled,
      true,
    ),
    endpoint,
    tracePath,
    metricsPath,
    traceUrl: resolveSignalUrl(
      endpoint,
      tracePath,
      stringValue(
        options.otelTracesUrl ?? env.OPENCODE_OTEL_TRACES_URL ?? gtraceValues.otel_traces_url,
        "",
      ),
    ),
    metricsUrl: resolveSignalUrl(
      metricsEndpoint,
      metricsPath,
      explicitMetricsUrl || inferredMetricsUrl,
    ),
    headers,
    metricsEnabled: booleanValue(
      options.metricsEnabled ?? env.OPENCODE_OTEL_METRICS_ENABLED,
      true,
    ),
    serviceName: stringValue(options.serviceName ?? env.OPENCODE_OTEL_SERVICE_NAME, "gtrace-opencode"),
    environment: stringValue(
      options.environment ?? env.OPENCODE_OTEL_ENV ?? gtraceValues.environment,
      "dev",
    ),
    agentId: stringValue(options.agentId ?? env.OPENCODE_OTEL_AGENT_ID, "opencode"),
    agentName: stringValue(options.agentName ?? env.OPENCODE_OTEL_AGENT_NAME, "OpenCode"),
    agentVersion: stringValue(options.agentVersion ?? env.OPENCODE_OTEL_AGENT_VERSION, "unknown"),
    captureContent: captureMode(options.captureContent ?? env.OPENCODE_OTEL_CAPTURE_CONTENT),
    maxAttributeLength: integerValue(
      options.maxAttributeLength ?? env.OPENCODE_OTEL_MAX_ATTRIBUTE_LENGTH,
      4096,
      128,
      65536,
    ),
    batchDelayMs: integerValue(options.batchDelayMs ?? env.OPENCODE_OTEL_BATCH_DELAY_MS, 500, 50, 60000),
    exportTimeoutMs: integerValue(
      options.exportTimeoutMs ?? env.OPENCODE_OTEL_EXPORT_TIMEOUT_MS ?? gtraceValues.timeout_ms,
      10000,
      1000,
      120000,
    ),
    resourceAttributes: mergedResourceAttributes,
    debug: booleanValue(options.debug ?? env.OPENCODE_OTEL_DEBUG ?? gtraceValues.debug, false),
    hookLogFile: stringValue(
      options.hookLogFile ?? env.OPENCODE_OTEL_HOOK_LOG_FILE ?? gtraceValues.hook_log_file,
      join(home, ".config", "opencode", "gtrace-hook.log"),
    ),
    configSourceFiles: gtrace.loadedFiles,
    configSourceWarnings: gtrace.warnings,
  }
}
