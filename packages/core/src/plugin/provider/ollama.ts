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
import { ModelV2 } from "../../model"
import { ProviderV2 } from "../../provider"
import { define } from "../internal"

export const OLLAMA_HOST = "http://127.0.0.1:11434"
export const OLLAMA_PROVIDER_ID = "ollama"

export type Hardware = {
  readonly totalRamGb: number
  readonly cpuCores: number
}

/** Models offered in ascending order of appetite; the first one that fits the RAM wins. */
export const RECOMMENDED = [
  {
    id: "qwen2.5-coder:1.5b",
    label: "Qwen2.5 Coder 1.5B",
    minRamGb: 4,
    note: "smallest useful coding model, runs anywhere",
  },
  {
    id: "qwen2.5-coder:7b",
    label: "Qwen2.5 Coder 7B",
    minRamGb: 8,
    note: "good default for everyday coding",
  },
  {
    id: "qwen2.5-coder:14b",
    label: "Qwen2.5 Coder 14B",
    minRamGb: 20,
    note: "noticeably better reasoning, needs a real workstation",
  },
  {
    id: "qwen2.5-coder:32b",
    label: "Qwen2.5 Coder 32B",
    minRamGb: 44,
    note: "only worth it on a machine with plenty of RAM",
  },
] as const

export type Recommendation = {
  readonly id: string
  readonly label: string
  readonly note: string
  readonly minRamGb: number
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

export const OllamaPlugin = define({
  id: "ollama",
  effect: Effect.fn(function* (ctx) {
    yield* ctx.catalog.transform(
      Effect.fn(function* (evt) {
        // A provider with no models is not autoloaded, so only surface Ollama once the daemon
        // answers. Checking here rather than at startup avoids a slow boot on machines without it.
        if (!(yield* Effect.promise(() => isRunning()))) return
        yield* Effect.promise(() => listModels()).pipe(
          Effect.map((models) => {
            evt.provider.update(ProviderV2.ID.make(OLLAMA_PROVIDER_ID), (provider) => {
              provider.name = "Ollama (local)"
            })
            for (const name of models) {
              evt.model.update(ProviderV2.ID.make(OLLAMA_PROVIDER_ID), ModelV2.ID.make(name), (model) => {
                model.name = name
              })
            }
          }),
          Effect.orDie,
        )
      }),
    )
  }),
})

