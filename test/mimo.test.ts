import { cpSync, mkdtempSync, mkdirSync, readFileSync, rmSync, writeFileSync, existsSync, statSync, chmodSync } from "node:fs"
import { join, resolve } from "node:path"
import { tmpdir } from "node:os"
import { execFileSync } from "node:child_process"
import { parse } from "jsonc-parser"
import { afterEach, describe, expect, it } from "vitest"
import { resolveConfig } from "../src/config.js"
import * as mimoModule from "../src/mimo.js"

const roots: string[] = []
function temp() { const root = mkdtempSync(join(tmpdir(), "mimo-plugin-")); roots.push(root); return root }
function json(file: string, value: unknown) { mkdirSync(resolve(file, ".."), { recursive: true }); writeFileSync(file, JSON.stringify(value)) }
afterEach(() => { for (const root of roots.splice(0)) rmSync(root, { recursive: true, force: true }) })

describe("MiMo host isolation", () => {
  it("exposes only a plugin function to the MiMo loader", () => {
    expect(Object.keys(mimoModule)).toEqual(["default"])
    expect(typeof mimoModule.default).toBe("function")
  })
  it("reads persisted MiMo directory and project files without OpenCode config or environment", () => {
    const home = temp(), cwd = join(home, "project"), configDir = join(home, "custom")
    json(join(home, ".config/opencode/gtrace.json"), { endpoint: "http://wrong", headers: { Authorization: "wrong" } })
    json(join(cwd, ".opencode/gtrace.json"), { endpoint: "http://also-wrong" })
    json(join(configDir, "gtrace.json"), { endpoint: "http://mimo", headers: { "X-Token": "test" } })
    json(join(cwd, ".mimocode/gtrace.json"), { enabled: false })
    const config = resolveConfig({ variant: "mimo", configDir }, { OPENCODE_OTEL_ENDPOINT: "http://wrong-env" }, { home, cwd })
    expect(config.endpoint).toBe("http://mimo")
    expect(config.enabled).toBe(false)
    expect(config.headers).toEqual({ "X-Token": "test" })
    expect(config.agentRuntime).toBe("mimo")
    expect(config.agentId).toBe("mimo")
    expect(config.agentName).toBe("MiMo Code")
    expect(config.serviceName).toBe("gtrace-mimo")
    expect(config.hookLogFile).toBe(join(configDir, "gtrace-hook.log"))
    expect(config.configSourceFiles).toEqual([join(configDir, "gtrace.json"), join(cwd, ".mimocode/gtrace.json")])
  })
  it("rejects relative MiMo roots and ignores relative XDG configuration", () => {
    const home = temp()
    expect(() => resolveConfig({ variant: "mimo" }, { MIMOCODE_HOME: "relative" }, { home })).toThrow("MIMOCODE_HOME must be an absolute path")
    expect(() => resolveConfig({ variant: "mimo" }, { MIMOCODE_CONFIG_DIR: "relative" }, { home })).toThrow("absolute path")
    expect(resolveConfig({ variant: "mimo" }, { XDG_CONFIG_HOME: "relative" }, { home }).hookLogFile).toBe(join(home, ".config/mimocode/gtrace-hook.log"))
    expect(() => execFileSync("bash", ["scripts/install.sh", "--variant", "mimo"], { env: { ...process.env, MIMOCODE_HOME: "relative" }, stdio: "pipe" })).toThrow()
  })
  it("resolves explicit directory, MiMo root, XDG, and default in order", () => {
    const home = temp()
    for (const [env, dir] of [
      [{ MIMOCODE_CONFIG_DIR: join(home, "explicit"), MIMOCODE_HOME: join(home, "root") }, join(home, "explicit")],
      [{ MIMOCODE_HOME: join(home, "root"), XDG_CONFIG_HOME: join(home, "xdg") }, join(home, "root/config")],
      [{ XDG_CONFIG_HOME: join(home, "xdg") }, join(home, "xdg/mimocode")],
      [{}, join(home, ".config/mimocode")],
    ] as Array<[NodeJS.ProcessEnv, string]>) {
      expect(resolveConfig({ variant: "mimo" }, env, { home }).hookLogFile).toBe(join(dir, "gtrace-hook.log"))
    }
  })
})

describe("MiMo Unix installer lifecycle", () => {
  it("preserves JSONC and user settings, keeps no-config updates, and unregisters cleanly", () => {
    const root = temp(), stage = join(root, "stage"), configDir = join(root, "mimo config"), pluginDir = join(configDir, "plugins/opencode-otel-plugin")
    mkdirSync(join(stage, "scripts"), { recursive: true }); mkdirSync(join(stage, "dist"))
    writeFileSync(join(stage, "dist/index.js"), "export default {}")
    writeFileSync(join(stage, "dist/mimo.js"), "export default async () => ({})")
    json(join(stage, "package.json"), { name: "opencode-otel-plugin", type: "module" })
    mkdirSync(join(stage, "node_modules"))
    cpSync("node_modules/jsonc-parser", join(stage, "node_modules/jsonc-parser"), { recursive: true })
    cpSync("scripts/install-config.mjs", join(stage, "scripts/install-config.mjs"))
    mkdirSync(configDir)
    const userConfig = '{\n // Keep my provider\n "provider": {"xiaomi":{"apiKey":"fixture"}},\n "plugin": ["other-plugin", "not-opencode-otel-plugin"],\n}\n'
    const file = join(configDir, "mimocode.jsonc")
    writeFileSync(file, userConfig)
    const env = { ...process.env, HOME: root, MIMOCODE_CONFIG_DIR: configDir, MIMOCODE_HOME: "", XDG_CONFIG_HOME: "relative", REPO_ROOT: stage, OPENCODE_HOME: join(root, "wrong"), GTRACE_CONFIG_FILE: "", PLUGIN_DIR: "" }
    const run = (...args: string[]) => execFileSync("bash", ["scripts/install.sh", "--variant", "mimo", ...args], { env })
    run("--endpoint", "http://127.0.0.1:4318", "--tag", "user_name=fixture")
    expect(existsSync(join(root, "wrong"))).toBe(false)
    expect(existsSync(join(configDir, "mimocode.json"))).toBe(false)
    const installed = readFileSync(file, "utf8")
    expect(installed).toContain("// Keep my provider")
    expect(parse(installed).provider.xiaomi.apiKey).toBe("fixture")
    expect(parse(installed).plugin).toHaveLength(3)
    expect(parse(installed).plugin[2]).toMatch(/file:.*mimo%20config.*dist\/mimo.js$/)
    const optionsFile = join(pluginDir, "mimo-options.json")
    expect(JSON.parse(readFileSync(optionsFile, "utf8")).configDir).toBe(configDir)
    const gtraceFile = join(configDir, "gtrace.json"), telemetry = readFileSync(gtraceFile, "utf8"), options = readFileSync(optionsFile, "utf8")
    expect(statSync(gtraceFile).mode & 0o777).toBe(0o600)
    chmodSync(gtraceFile, 0o640)
    run("--no-config")
    expect(readFileSync(file, "utf8")).toBe(installed)
    expect(readFileSync(gtraceFile, "utf8")).toBe(telemetry)
    expect(readFileSync(optionsFile, "utf8")).toBe(options)
    run("--disable-script")
    expect(JSON.parse(readFileSync(gtraceFile, "utf8")).enabled).toBe(false)
    expect(statSync(gtraceFile).mode & 0o777).toBe(0o640)
    run("--enable-script")
    expect(JSON.parse(readFileSync(gtraceFile, "utf8")).enabled).toBe(true)
    execFileSync(process.execPath, [join(pluginDir, "scripts/install-config.mjs"), "remove-mimo-config", configDir])
    expect(parse(readFileSync(file, "utf8")).plugin).toEqual(["other-plugin", "not-opencode-otel-plugin"])
    expect(readFileSync(file, "utf8")).toContain("// Keep my provider")
    execFileSync("bash", ["scripts/install.sh", "--variant", "mimo", "--endpoint", "http://127.0.0.1:4318"], { env: { ...env, MIMOCODE_CONFIG_DIR: "" } })
    expect(existsSync(join(root, ".config/mimocode/mimocode.json"))).toBe(true)
  })
  it("forwards host variant in PowerShell release wrapper and supports native path resolution", () => {
    const wrapper = readFileSync("install-release.ps1", "utf8"), installer = readFileSync("scripts/install.ps1", "utf8")
    expect(wrapper).toContain("Variant = $Variant")
    expect(installer).toContain('$env:MIMOCODE_CONFIG_DIR')
    expect(installer).toContain('$env:MIMOCODE_HOME "config"')
    expect(installer).toContain('install-mimo-runtime')
    expect(installer).toContain('mimocode.jsonc')
  })
})
