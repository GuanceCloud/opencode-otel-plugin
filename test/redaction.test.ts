import { describe, expect, it } from "vitest"
import { sanitize, stringifySanitized } from "../src/redaction.js"

describe("content redaction", () => {
  it.each([undefined, () => undefined, Symbol("missing")])("handles values with no JSON representation: %s", (value) => {
    expect(stringifySanitized(value, 1024)).toBe("[Unserializable]")
  })

  it("handles missing MCP text and mixed structured content without modifying the result", () => {
    const content = [{ type: "text", text: "ok" }, { type: "image", data: "fixture" }]
    const original = structuredClone(content)
    expect(stringifySanitized(content[1].text, 1024)).toBe("[Unserializable]")
    expect(JSON.parse(stringifySanitized(content, 1024))).toEqual(original)
    expect(content).toEqual(original)
    expect(stringifySanitized(null, 1024)).toBe("null")
    expect(stringifySanitized(1n, 1024)).toBe("[Unserializable]")
  })

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
