/**
 * Locally-run providers that models.dev does not carry.
 *
 * The provider list is built from the models.dev catalogue, and anything missing from it is
 * dropped before it can reach the picker - so Ollama and OmniRoute have to be injected into the
 * same catalogue, not merely registered as plugins. Plugin registration alone changes the V2
 * catalog and is invisible to the V1 provider path that the UI actually reads.
 *
 * Both are OpenAI-compatible endpoints on localhost, so they share one construction.
 */

export type LocalProviderSpec = {
  readonly id: string
  readonly name: string
  readonly baseUrl: string
  readonly apiKey: string
  readonly models: readonly { readonly id: string; readonly name: string }[]
}

export const OLLAMA_DEFAULT_URL = "http://127.0.0.1:11434/v1"
export const OMNIROUTE_DEFAULT_URL = "http://localhost:20128/v1"

/**
 * Both base URLs are user-configurable. OmniRoute in particular is often proxied or moved, and
 * hard-coding a port is the kind of thing that works on my machine and nowhere else.
 */
export function localProviderSpecs(
  env: Record<string, string | undefined> = process.env,
  discovered: Record<string, Discovered> = {},
): LocalProviderSpec[] {
  const omnirouteKey = env["OMNIROUTE_API_KEY"]?.trim()
  return [
    {
      id: "ollama",
      name: "Ollama (local)",
      baseUrl: env["OLLAMA_URL"]?.trim() || OLLAMA_DEFAULT_URL,
      // Ollama ignores the key entirely but the OpenAI-compatible SDK refuses to send a request
      // without one, so a placeholder is required rather than merely convenient.
      apiKey: env["OLLAMA_API_KEY"]?.trim() || "ollama",
      models: discovered["ollama"]?.length
        ? discovered["ollama"]
        : [
        { id: "qwen2.5-coder:1.5b", name: "Qwen2.5 Coder 1.5B - needs 4 GB RAM, ~1 GB disk" },
        { id: "llama3.2:3b", name: "Llama 3.2 3B - needs 4 GB RAM, ~2 GB disk" },
        { id: "qwen2.5-coder:7b", name: "Qwen2.5 Coder 7B - needs 8 GB RAM, ~5 GB disk" },
        { id: "qwen2.5-coder:14b", name: "Qwen2.5 Coder 14B - needs 20 GB RAM, ~9 GB disk" },
      ],
    },
    {
      id: "omniroute",
      name: "OmniRoute (local gateway)",
      baseUrl: env["OMNIROUTE_URL"]?.trim() || OMNIROUTE_DEFAULT_URL,
      // OmniRoute's /v1/models answers 401 even with REQUIRE_API_KEY=false, so a missing key is
      // surfaced plainly rather than producing a gateway that silently lists nothing.
      apiKey: omnirouteKey || "",
      models: discovered["omniroute"]?.length
        ? discovered["omniroute"]
        : [
        { id: "cc/claude-sonnet-4-6", name: "Claude Sonnet 4.6 (routed)" },
        { id: "cc/claude-opus-4-7", name: "Claude Opus 4.7 (routed)" },
        { id: "gh/gpt-5.1-codex", name: "GPT-5.1 Codex (routed)" },
        { id: "openai/gpt-5.2", name: "GPT-5.2 (routed)" },
      ],
    },
  ]
}

/** A model id and the label shown for it. */
export type Discovered = readonly { id: string; name: string }[]

/**
 * Asks the running gateway what it actually serves.
 *
 * This is the part that was missing. A hard-coded list of model ids is worse than none, because
 * selecting one the gateway does not have 404s at send time and looks like the app is broken.
 * A gateway that cannot be reached yields an empty list, and the provider still appears - just
 * without models, which is honest.
 */
export async function discover(baseUrl: string, apiKey: string, timeoutMs = 2500): Promise<Discovered> {
  try {
    const response = await fetch(`${baseUrl.replace(/\/$/, "")}/models`, {
      signal: AbortSignal.timeout(timeoutMs),
      headers: apiKey ? { authorization: `Bearer ${apiKey}` } : {},
    })
    if (!response.ok) return []
    const payload = (await response.json()) as { data?: unknown }
    if (!Array.isArray(payload?.data)) return []
    return payload.data.flatMap((entry) => {
      if (typeof entry !== "object" || entry === null) return []
      const id = (entry as { id?: unknown }).id
      if (typeof id !== "string") return []
      // Embedding, image and audio models cannot serve a completion; offering them in a coding
      // picker is a dead choice that only reveals itself when a request is sent.
      if (/embedding|embed|whisper|tts|image|dall|flux|stable-diffusion|nano-?banana/i.test(id)) return []
      return [{ id, name: id }]
    })
  } catch {
    return []
  }
}

/**
 * Builds the catalogue entry. `source: "custom"` is what the provider loader expects for a
 * provider that did not come from models.dev.
 */
export function toInfo(spec: LocalProviderSpec) {
  return {
    id: spec.id,
    source: "custom" as const,
    name: spec.name,
    env: [] as string[],
    options: {
      baseURL: spec.baseUrl,
      apiKey: spec.apiKey,
    },
    models: Object.fromEntries(
      spec.models.map((model) => [
        model.id,
        {
          id: model.id,
          providerID: spec.id,
          name: model.name,
          cost: { input: 0, output: 0, cache: { read: 0, write: 0 } },
          capabilities: { tools: true, input: ["text"], output: ["text"] },
          limit: { context: 128_000, output: 8_192 },
          api: {
            id: model.id,
            npm: "@ai-sdk/openai-compatible",
            url: spec.baseUrl,
          },
          options: {},
          headers: {},
        },
      ]),
    ),
  }
}
