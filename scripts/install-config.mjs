import fs from "node:fs";
import { parse, modify, applyEdits } from "jsonc-parser";
import path from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

function canonicalHeaderName(key) {
  const normalized = String(key).trim().toLowerCase().replace(/_/g, "-");
  if (!normalized) return "";
  if (normalized === "to-headless") return "To-Headless";
  if (normalized === "x-token") return "X-Token";
  if (normalized === "authorization") return "Authorization";
  return String(key).trim();
}

function splitAssignment(value) {
  const [key, ...rest] = String(value).split("=");
  if (!key || rest.length === 0) return undefined;
  return [key.trim(), rest.join("=").trim()];
}

function booleanValue(value) {
  if (typeof value === "boolean") return value;
  if (typeof value !== "string") return undefined;
  const normalized = value.trim().toLowerCase();
  if (["1", "true", "yes", "on"].includes(normalized)) return true;
  if (["0", "false", "no", "off"].includes(normalized)) return false;
  return undefined;
}

function parseJson(value, fallback) {
  try {
    return JSON.parse(value || "");
  } catch {
    return fallback;
  }
}

function readJsonObject(file, fallback = {}) {
  if (!fs.existsSync(file)) return { ...fallback };
  const raw = fs.readFileSync(file, "utf8").trim();
  if (!raw) return { ...fallback };
  const parsed = JSON.parse(raw);
  if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) {
    throw new Error(`Expected JSON object in ${file}`);
  }
  return parsed;
}

function writeJson(file, value) {
  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.writeFileSync(file, `${JSON.stringify(value, null, 2)}\n`, { encoding: "utf8", mode: 0o600 });
}

function writeOpencodeConfig(options) {
  const {
    configFile,
    pluginUrl,
    pluginName,
    captureContent,
  } = options;

  const config = readJsonObject(configFile, { $schema: "https://opencode.ai/config.json" });
  if (!config.$schema) config.$schema = "https://opencode.ai/config.json";
  const normalizedPluginUrl =
    typeof pluginUrl === "string" && pluginUrl.startsWith("file://")
      ? pluginUrl
      : pathToFileURL(String(pluginUrl)).href;

  const plugins = Array.isArray(config.plugin) ? config.plugin : [];
  const filtered = plugins.filter((item) => {
    const source = Array.isArray(item) ? item[0] : item;
    return !(typeof source === "string" && source.includes(pluginName));
  });
  filtered.push([
    normalizedPluginUrl,
    { captureContent },
  ]);
  config.plugin = filtered;

  if (!config.experimental || typeof config.experimental !== "object" || Array.isArray(config.experimental)) {
    config.experimental = {};
  }
  config.experimental.openTelemetry = false;

  writeJson(configFile, config);
}

// Edit only the plugin property so comments, credentials and provider configuration survive.
function updateMimoConfig(configFile, pluginDir, remove = false) {
  if (remove && !fs.existsSync(configFile)) return;
  const raw = fs.existsSync(configFile) ? fs.readFileSync(configFile, "utf8") : "{}\n";
  const errors = [];
  const config = parse(raw, errors, { allowTrailingComma: true });
  if (errors.length || !config || typeof config !== "object" || Array.isArray(config)) {
    throw new Error(`Expected JSONC object in ${configFile}`);
  }
  const plugins = Array.isArray(config.plugin) ? config.plugin : [];
  const owned = (item) => {
    const source = Array.isArray(item) ? item[0] : item;
    if (typeof source !== "string") return false;
    if (/^opencode-otel-plugin(?:@[^/]+)?(?:\/mimo)?$/.test(source)) return true;
    if (!source.startsWith("file:")) return false;
    try {
      const file = fileURLToPath(source);
      const canonical = (value) => fs.existsSync(value) ? fs.realpathSync(value) : path.resolve(value);
      return canonical(file) === canonical(pluginDir) || canonical(file) === canonical(path.join(pluginDir, "dist", "mimo.js"));
    } catch { return false; }
  };
  const filtered = plugins.filter((item) => !owned(item));
  if (remove && filtered.length === plugins.length) return;
  if (!remove) filtered.push(pathToFileURL(path.join(pluginDir, "dist", "mimo.js")).href);
  const result = applyEdits(raw, modify(raw, ["plugin"], filtered, { formattingOptions: { insertSpaces: true, tabSize: 2 } }));
  fs.mkdirSync(path.dirname(configFile), { recursive: true });
  fs.writeFileSync(configFile, result, "utf8");
}

function installMimoRuntime() {
  const pluginDir = process.env.OPENCODE_PLUGIN_DIR_RUNTIME;
  const file = path.join(pluginDir, "mimo-options.json");
  if (process.env.OPENCODE_NO_CONFIG_RUNTIME === "1" && fs.existsSync(file)) return;
  writeJson(file, {
    configDir: path.dirname(process.env.GTRACE_CONFIG_FILE_RUNTIME),
    captureContent: process.env.OPENCODE_CAPTURE_CONTENT_RUNTIME || "preview",
  });
}

function writeGtraceConfig(options) {
  const {
    configFile,
    endpoint = "",
    tracePath = "",
    metricsPath = "",
    installType = "gtrace",
    xToken = "",
    scriptEnabled,
    tags = [],
    extraHeaders = [],
  } = options;

  const config = readJsonObject(configFile, {});

  if (typeof scriptEnabled === "boolean") {
    config.enabled = scriptEnabled;
  } else if (typeof config.enabled !== "boolean") {
    config.enabled = booleanValue(config.enabled) ?? true;
  }

  if (endpoint) config.endpoint = endpoint;
  if (tracePath) config.tracePath = tracePath;
  if (metricsPath) config.metricsPath = metricsPath;

  config.headers = config.headers && typeof config.headers === "object" && !Array.isArray(config.headers)
    ? config.headers
    : {};

  if (installType === "gtrace") config.headers["To-Headless"] ??= "true";
  if (xToken) config.headers["X-Token"] = xToken;
  for (const header of extraHeaders) {
    const assignment = splitAssignment(header);
    if (!assignment) continue;
    const canonicalKey = canonicalHeaderName(assignment[0]);
    if (canonicalKey) config.headers[canonicalKey] = assignment[1];
  }
  if (Object.keys(config.headers).length === 0) delete config.headers;

  config.resourceAttributes = config.resourceAttributes && typeof config.resourceAttributes === "object" && !Array.isArray(config.resourceAttributes)
    ? config.resourceAttributes
    : {};

  for (const tag of tags) {
    const assignment = splitAssignment(tag);
    if (!assignment) continue;
    config.resourceAttributes[assignment[0]] = assignment[1];
  }
  if (Object.keys(config.resourceAttributes).length === 0) delete config.resourceAttributes;

  writeJson(configFile, config);
}

function optionsFromEnvironment(action) {
  if (action === "write-opencode-config") {
    return {
      configFile: process.env.OPENCODE_CONFIG_FILE_RUNTIME,
      pluginUrl: process.env.OPENCODE_PLUGIN_URL_RUNTIME,
      pluginName: process.env.OPENCODE_PLUGIN_NAME_RUNTIME,
      captureContent: process.env.OPENCODE_CAPTURE_CONTENT_RUNTIME || "preview",
    };
  }
  return {
    configFile: process.env.GTRACE_CONFIG_FILE_RUNTIME,
    endpoint: process.env.GTRACE_ENDPOINT_RUNTIME,
    tracePath: process.env.GTRACE_TRACE_PATH_RUNTIME,
    metricsPath: process.env.GTRACE_METRICS_PATH_RUNTIME,
    installType: process.env.GTRACE_INSTALL_TYPE_RUNTIME,
    xToken: process.env.GTRACE_X_TOKEN_RUNTIME,
    scriptEnabled: booleanValue(process.env.GTRACE_SCRIPT_ENABLED_RUNTIME),
    tags: parseJson(process.env.GTRACE_TAGS_RUNTIME, []),
    extraHeaders: parseJson(process.env.GTRACE_HEADERS_RUNTIME, []),
  };
}

const action = process.argv[2];
function isMainModule() {
  if (!process.argv[1]) return false;
  try {
    return fs.realpathSync(process.argv[1]) === fs.realpathSync(fileURLToPath(import.meta.url));
  } catch {
    return false;
  }
}

if (isMainModule()) {
  if (action === "install-mimo-runtime") installMimoRuntime();
  else if (action === "remove-mimo-config") {
    const configDir = process.argv[3];
    if (!configDir || !path.isAbsolute(configDir)) throw new Error("Absolute MiMo config directory required");
    const pluginDir = path.dirname(path.dirname(fileURLToPath(import.meta.url)));
    for (const file of ["mimocode.json", "mimocode.jsonc"]) updateMimoConfig(path.join(configDir, file), pluginDir, true);
  }
  else if (action === "write-opencode-config" && process.env.OPENCODE_VARIANT_RUNTIME === "mimo") {
    updateMimoConfig(process.env.OPENCODE_CONFIG_FILE_RUNTIME, process.env.OPENCODE_PLUGIN_DIR_RUNTIME);
  }
  else if (action === "write-opencode-config") writeOpencodeConfig(optionsFromEnvironment(action));
  else if (action === "write-gtrace-config") writeGtraceConfig(optionsFromEnvironment(action));
  else throw new Error(`Unsupported installer config action: ${action || "<empty>"}`);
}
