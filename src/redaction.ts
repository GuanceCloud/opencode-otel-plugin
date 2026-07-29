import type { ContentCaptureMode } from "./config.js"

const SECRET_KEY_PATTERN =
  /(?:authorization|proxy-authorization|cookie|set-cookie|api[-_.]?key|access[-_.]?token|refresh[-_.]?token|id[-_.]?token|password|passwd|secret|private[-_.]?key|client[-_.]?secret)/i

const INLINE_SECRET_PATTERNS: Array<[RegExp, string]> = [
  [/\b(?:sk|rk|pk)-[A-Za-z0-9_-]{12,}\b/g, "[REDACTED_TOKEN]"],
  [/\bBearer\s+[A-Za-z0-9._~+/-]+=*\b/gi, "Bearer [REDACTED]"],
  [
    /\b(authorization|api[-_]?key|access[-_]?token|refresh[-_]?token|password|secret)\b\s*[:=]\s*["']?[^,\s"']+/gi,
    "$1=[REDACTED]",
  ],
]

function redactText(value: string): string {
  let result = value
  for (const [pattern, replacement] of INLINE_SECRET_PATTERNS) {
    result = result.replace(pattern, replacement)
  }
  return result
}

function sanitizeUnknown(value: unknown, seen: WeakSet<object>): unknown {
  if (typeof value === "string") return redactText(value)
  if (value === null || typeof value !== "object") return value
  if (seen.has(value)) return "[Circular]"
  seen.add(value)
  if (Array.isArray(value)) return value.map((item) => sanitizeUnknown(item, seen))

  const output: Record<string, unknown> = {}
  for (const [key, item] of Object.entries(value as Record<string, unknown>)) {
    output[key] = SECRET_KEY_PATTERN.test(key) ? "[REDACTED]" : sanitizeUnknown(item, seen)
  }
  return output
}

export function sanitize(value: unknown): unknown {
  return sanitizeUnknown(value, new WeakSet())
}

export function stringifySanitized(value: unknown, maxLength: number): string {
  let text: string
  try {
    text = typeof value === "string" ? redactText(value) : JSON.stringify(sanitize(value))
  } catch {
    text = "[Unserializable]"
  }
  if (text.length <= maxLength) return text
  return `${text.slice(0, Math.max(0, maxLength - 15))}…[truncated]`
}

export function captureText(value: string, mode: ContentCaptureMode, maxLength: number): string | undefined {
  if (mode === "none") return undefined
  const safe = redactText(value)
  if (mode === "full") return stringifySanitized(safe, maxLength)
  return stringifySanitized(safe, Math.min(maxLength, 1024))
}

export function preview(value: string, maxLength: number): { value: string; length: number } {
  return {
    value: stringifySanitized(value, Math.min(maxLength, 1024)),
    length: value.length,
  }
}
