import { Config } from "effect"

export function truthy(key: string) {
  const value = process.env[key]?.toLowerCase()
  return value === "true" || value === "1"
}

const copy = process.env["CREATINE_EXPERIMENTAL_DISABLE_COPY_ON_SELECT"]
const fff = process.env["CREATINE_DISABLE_FFF"]

function enabledByExperimental(key: string) {
  return process.env[key] === undefined ? truthy("CREATINE_EXPERIMENTAL") : truthy(key)
}

export const Flag = {
  OTEL_EXPORTER_OTLP_ENDPOINT: process.env["OTEL_EXPORTER_OTLP_ENDPOINT"],
  OTEL_EXPORTER_OTLP_HEADERS: process.env["OTEL_EXPORTER_OTLP_HEADERS"],

  CREATINE_AUTO_HEAP_SNAPSHOT: truthy("CREATINE_AUTO_HEAP_SNAPSHOT"),
  CREATINE_GIT_BASH_PATH: process.env["CREATINE_GIT_BASH_PATH"],
  CREATINE_CONFIG: process.env["CREATINE_CONFIG"],
  CREATINE_CONFIG_CONTENT: process.env["CREATINE_CONFIG_CONTENT"],
  CREATINE_DISABLE_AUTOUPDATE: truthy("CREATINE_DISABLE_AUTOUPDATE"),
  CREATINE_ALWAYS_NOTIFY_UPDATE: truthy("CREATINE_ALWAYS_NOTIFY_UPDATE"),
  CREATINE_DISABLE_PRUNE: truthy("CREATINE_DISABLE_PRUNE"),
  CREATINE_DISABLE_TERMINAL_TITLE: truthy("CREATINE_DISABLE_TERMINAL_TITLE"),
  CREATINE_SHOW_TTFD: truthy("CREATINE_SHOW_TTFD"),
  CREATINE_DISABLE_AUTOCOMPACT: truthy("CREATINE_DISABLE_AUTOCOMPACT"),
  CREATINE_DISABLE_MODELS_FETCH: truthy("CREATINE_DISABLE_MODELS_FETCH"),
  CREATINE_DISABLE_MOUSE: truthy("CREATINE_DISABLE_MOUSE"),
  CREATINE_FAKE_VCS: process.env["CREATINE_FAKE_VCS"],
  CREATINE_SERVER_PASSWORD: process.env["CREATINE_SERVER_PASSWORD"],
  CREATINE_SERVER_USERNAME: process.env["CREATINE_SERVER_USERNAME"],
  CREATINE_DISABLE_FFF: fff === undefined ? process.platform === "win32" : truthy("CREATINE_DISABLE_FFF"),

  // Experimental
  CREATINE_EXPERIMENTAL_FILEWATCHER: Config.boolean("CREATINE_EXPERIMENTAL_FILEWATCHER").pipe(
    Config.withDefault(false),
  ),
  CREATINE_EXPERIMENTAL_DISABLE_FILEWATCHER: Config.boolean("CREATINE_EXPERIMENTAL_DISABLE_FILEWATCHER").pipe(
    Config.withDefault(false),
  ),
  CREATINE_EXPERIMENTAL_DISABLE_COPY_ON_SELECT:
    copy === undefined ? process.platform === "win32" : truthy("CREATINE_EXPERIMENTAL_DISABLE_COPY_ON_SELECT"),
  CREATINE_MODELS_URL: process.env["CREATINE_MODELS_URL"],
  CREATINE_MODELS_PATH: process.env["CREATINE_MODELS_PATH"],
  CREATINE_DB: process.env["CREATINE_DB"],

  CREATINE_WORKSPACE_ID: process.env["CREATINE_WORKSPACE_ID"],
  CREATINE_EXPERIMENTAL_WORKSPACES: enabledByExperimental("CREATINE_EXPERIMENTAL_WORKSPACES"),

  // Evaluated at access time (not module load) because tests, the CLI, and
  // external tooling set these env vars at runtime.
  get CREATINE_DISABLE_PROJECT_CONFIG() {
    return truthy("CREATINE_DISABLE_PROJECT_CONFIG")
  },
  get CREATINE_EXPERIMENTAL_REFERENCES() {
    return enabledByExperimental("CREATINE_EXPERIMENTAL_REFERENCES")
  },
  get CREATINE_TUI_CONFIG() {
    return process.env["CREATINE_TUI_CONFIG"]
  },
  get CREATINE_CONFIG_DIR() {
    return process.env["CREATINE_CONFIG_DIR"]
  },
  get CREATINE_PURE() {
    return truthy("CREATINE_PURE")
  },
  get CREATINE_PERMISSION() {
    return process.env["CREATINE_PERMISSION"]
  },
  get CREATINE_PLUGIN_META_FILE() {
    return process.env["CREATINE_PLUGIN_META_FILE"]
  },
  get CREATINE_CLIENT() {
    return process.env["CREATINE_CLIENT"] ?? "cli"
  },
}
