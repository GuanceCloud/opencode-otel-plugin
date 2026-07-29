import { describe, expect, it } from "vitest"
import { sanitize, stringifySanitized } from "../src/redaction.js"

describe("内容脱敏", () => {
  it("按字段名和行内模式隐藏凭证", () => {
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

  it("安全处理循环引用", () => {
    const value: Record<string, unknown> = {}
    value.self = value
    expect(sanitize(value)).toEqual({ self: "[Circular]" })
  })

  it("限制属性长度", () => {
    const result = stringifySanitized("x".repeat(2000), 128)
    expect(result.length).toBeLessThanOrEqual(128)
    expect(result).toContain("truncated")
  })
})
