/**
 * Local Ollama provider.
 *
 * Ollama serves models from `http://127.0.0.1:11434` with no API key, which makes it the only
 * provider a fresh install can use without a login. The catch is that a new machine usually has
 * no models pulled, so the work here is choosing one that fits the hardware and pulling it.
 *
 * Sizing is driven by total RAM, not by CPU count: Ollama keeps the whole model resident, and an
 * oversubscribed machine falls back to swapping hard enough to look hung. The thresholds are
 * deliberately conservative - a 7B coder model at Q4 needs roughly 6 GB of headroom once the
 * KV cache and context are counted, so it is only offered above 8 GB.
 */

import { Effect } from "effect"
import { define } from "@opencode-ai/plugin/v2/effect/plugin"
import { ModelV2 } from "../../model"
import { ProviderV2 } from "../../provider"

export const OLLAMA_HOST = "http://127.0.0.1:11434"
export const OLLAMA_PROVIDER_ID = "ollama"

export type Hardware = {
  readonly totalRamGb: number
  readonly cpuCores: number
}

/**
 * The models offered, ascending by appetite: two lightweight and two deeper, so the picker shows
 * a real choice on a laptop and a real choice on a workstation rather than one "safe" option.
 * The RAM and disk figures are surfaced in the display name - someone scanning a model list
 * cannot tell that a 14B will thrash an 8 GB machine unless the list says so.
 */
export const RECOMMENDED = [
  {
    id: "qwen2.5-coder:1.5b",
    label: "Qwen2.5 Coder 1.5B",
    minRamGb: 4,
    diskGb: 1,
    note: "lightest - runs on almost anything",
  },
  {
    id: "llama3.2:3b",
    label: "Llama 3.2 3B",
    minRamGb: 4,
    diskGb: 2,
    note: "lightest - general chat, not code-tuned",
  },
  {
    id: "qwen2.5-coder:7b",
    label: "Qwen2.5 Coder 7B",
    minRamGb: 8,
    diskGb: 5,
    note: "deeper - the everyday default",
  },
  {
    id: "qwen2.5-coder:14b",
    label: "Qwen2.5 Coder 14B",
    minRamGb: 20,
    diskGb: 9,
    note: "deepest listed - needs a real workstation",
  },
] as const

export type Recommendation = {
  readonly id: string
  readonly label: string
  readonly note: string
  readonly minRamGb: number
  readonly diskGb: number
}

/**
 * Picks the largest model the machine can plausibly hold, falling back to the smallest rather
 * than returning nothing - a machine with 2 GB is unusual but should still get a working model.
 */
export function recommend(hardware: Hardware): Recommendation {
  const fits = RECOMMENDED.filter((model) => hardware.totalRamGb >= model.minRamGb)
  if (fits.length === 0) return RECOMMENDED[0]
  return fits[fits.length - 1]
}

export type PullProgress = { readonly done: boolean; readonly status?: string }

/** Parses `/api/tags`, tolerating the shapes a warm vs cold daemon actually returns. */
export function parseTags(payload: unknown): string[] {
  if (typeof payload !== "object" || payload === null) return []
  const models = (payload as { models?: unknown }).models
  if (!Array.isArray(models)) return []
  return models.flatMap((entry) =>
    typeof entry === "object" && entry !== null && typeof (entry as { name?: unknown }).name === "string"
      ? [(entry as { name: string }).name]
      : [],
  )
}

type FetchLike = (input: string, init?: RequestInit) => Promise<Response>

/** True when an Ollama daemon answers. Used to decide whether to offer the provider at all. */
export async function isRunning(fetcher: FetchLike = fetch, host = OLLAMA_HOST): Promise<boolean> {
  try {
    const response = await fetcher(`${host}/api/tags`, { signal: AbortSignal.timeout(2500) })
    return response.ok
  } catch {
    return false
  }
}

export async function listModels(fetcher: FetchLike = fetch, host = OLLAMA_HOST): Promise<string[]> {
  const response = await fetcher(`${host}/api/tags`, { signal: AbortSignal.timeout(5000) })
  if (!response.ok) return []
  return parseTags(await response.json())
}

/**
 * Pulls a model and reports progress. This is a long operation - gigabytes over whatever link
 * the user has - so it is driven through the callback rather than returned as a promise the
 * caller has to poll, and it never throws: a failed pull leaves the machine as it was.
 */
export function pull(
  model: string,
  onProgress: (percent: number, status: string) => void,
  fetcher: FetchLike = fetch,
  host = OLLAMA_HOST,
): Effect.Effect<boolean> {
  return Effect.gen(function* () {
    let response: Response
    try {
      response = yield* Effect.tryPromise(() =>
        fetcher(`${host}/api/pull`, {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({ model, stream: true }),
        }),
      )
    } catch {
      return false
    }
    if (!response.ok || !response.body) return false
    const reader = response.body.getReader()
    const decoder = new TextDecoder()
    let buffer = ""
    while (true) {
      const chunk = yield* Effect.tryPromise(() => reader.read())
      if (chunk.done) break
      buffer += decoder.decode(chunk.value, { stream: true })
      // Ollama streams newline-delimited JSON; a partial line is normal between chunks.
      const lines = buffer.split("\n")
      buffer = lines.pop() ?? ""
      for (const line of lines) {
        const trimmed = line.trim()
        if (!trimmed) continue
        try {
          const event = JSON.parse(trimmed) as { completed?: number; total?: number; status?: string }
          if (typeof event.total === "number" && event.total > 0 && typeof event.completed === "number")
            onProgress(Math.round((event.completed / event.total) * 100), event.status ?? "")
          else if (event.status) onProgress(-1, event.status)
        } catch {
          // Not every line is JSON; skipping is the correct behaviour, not an error.
        }
      }
    }
    onProgress(100, "done")
    return true
  }).pipe(Effect.catch(() => Effect.succeed(false)))
}

export function displayName(model: Recommendation): string {
  return `${model.label} - needs ${model.minRamGb} GB RAM, ~${model.diskGb} GB disk`
}

export const OllamaPlugin = define({
  id: "ollama",
  effect: Effect.fn(function* (ctx) {
    yield* ctx.catalog.transform(
      Effect.fn(function* (evt) {
        const providerID = ProviderV2.ID.make(OLLAMA_PROVIDER_ID)
        const installed = yield* Effect.promise(() => listModels()).pipe(Effect.orElseSucceed(() => [] as []))

        // Register unconditionally: the provider exists in the picker whether or not a daemon is
        // up yet, so a machine that installs Ollama later does not need a restart to see it.
        evt.provider.update(providerID, (provider) => {
          provider.name = "Ollama (local)"
          provider.api = { type: "aisdk", package: "@ai-sdk/openai-compatible", url: `${OLLAMA_HOST}/v1` }
        })

        // The curated list first so a fresh machine has something to pick, then anything the
        // user already pulled, which is how their own models show up without configuration.
        for (const model of [...RECOMMENDED, ...installed.map(toListing)]) {
          const modelID = ModelV2.ID.make(model.id)
          evt.model.update(providerID, modelID, (draft) => {
            draft.name = displayName(model)
            draft.cost = [{ input: 0, output: 0, cache: { read: 0, write: 0 } }]
            draft.capabilities = { tools: true, input: ["text"], output: ["text"] }
            draft.limit = { context: 32_000, output: 8_192 }
          })
        }
      }),
    )
  }),
})

/** An already-pulled model we do not curate, so its size is unknown and requirements are vague. */
function toListing(name: string): Recommendation {
  const curated = RECOMMENDED.find((item) => item.id === name)
  return curated ?? { id: name, label: name, minRamGb: 0, diskGb: 0, note: "already installed locally" }
}

