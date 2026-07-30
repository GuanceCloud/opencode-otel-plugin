import { describe, expect, it } from "vitest"
import { sanitize, stringifySanitized } from "../src/redaction.js"

describe("content redaction", () => {
  it("hides credentials by field name and inline patterns", () => {
    const result = stringifySanitized(
      {
        apiKey: "sk-abcdefghijklmnop",
        nested: {
          message: "Authorization: Bearer abc.def.ghi",
          password: "do-not-export",
        },
      },
      4096,
    )
    expect(result).not.toContain("abcdefghijklmnop")
    expect(result).not.toContain("abc.def.ghi")
    expect(result).not.toContain("do-not-export")
    expect(result).toContain("[REDACTED]")
  })

  it("handles circular references safely", () => {
    const value: Record<string, unknown> = {}
    value.self = value
    expect(sanitize(value)).toEqual({ self: "[Circular]" })
  })

  it("limits attribute length", () => {
    const result = stringifySanitized("x".repeat(2000), 128)
    expect(result.length).toBeLessThanOrEqual(128)
    expect(result).toContain("truncated")
  })
})
