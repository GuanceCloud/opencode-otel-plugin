import { beforeEach, describe, expect, it, vi } from "vitest"
import type { Plugin } from "@opencode-ai/plugin"

const mocks = vi.hoisted(() => ({ read: vi.fn(), plugin: vi.fn() }))
vi.mock("node:fs", () => ({ readFileSync: mocks.read }))
vi.mock("../src/index.js", () => ({ OpenCodeOtelPlugin: mocks.plugin }))
import mimo from "../src/mimo.js"

const input = { directory: "/fixture" } as Parameters<Plugin>[0]
beforeEach(() => { vi.resetAllMocks(); mocks.plugin.mockResolvedValue({}) })

describe("MiMo startup failure isolation", () => {
  it.each(["broken JSON", "null", "[]", "42"])("disables telemetry for malformed options: %s", async (raw) => {
    mocks.read.mockReturnValue(raw)
    await expect(mimo(input)).resolves.toEqual({})
    expect(mocks.plugin).not.toHaveBeenCalled()
  })
  it("does not abort MiMo when installed options cannot be read", async () => {
    mocks.read.mockImplementation(() => { throw Object.assign(new Error("private"), { code: "EACCES" }) })
    await expect(mimo(input)).resolves.toEqual({})
    expect(mocks.plugin).not.toHaveBeenCalled()
  })
  it("supports a package entry without installer metadata", async () => {
    mocks.read.mockImplementation(() => { throw Object.assign(new Error("missing"), { code: "ENOENT" }) })
    await expect(mimo(input)).resolves.toEqual({})
    expect(mocks.plugin).toHaveBeenCalledWith(input, { variant: "mimo" })
  })
  it("does not abort MiMo if telemetry initialization rejects", async () => {
    mocks.read.mockReturnValue('{"configDir":"/fixture/config"}')
    mocks.plugin.mockRejectedValue(new Error("private exporter configuration"))
    await expect(mimo(input)).resolves.toEqual({})
    expect(mocks.plugin).toHaveBeenCalledWith(input, { configDir: "/fixture/config", variant: "mimo" })
  })
})
