/**
 * Local OmniRoute gateway.
 *
 * OmniRoute is an open-source, self-hosted gateway that fronts 200+ providers behind one
 * OpenAI-compatible endpoint on `localhost:20128`. It sits in the same category as Ollama: no
 * account, no key, nothing leaves the machine except whatever OmniRoute itself forwards.
 *
 * Unlike Ollama it does not own a fixed model list - it exposes whatever providers the user has
 * connected in their OmniRoute dashboard - so the catalogue is discovered from `/v1/models`
 * rather than hardcoded. The entries below are only the prefixes OmniRoute documents as common,
 * shown when discovery is unavailable so the provider is still selectable.
 */

import { Effect } from "effect"
import { define } from "@opencode-ai/plugin/v2/effect/plugin"
import { ModelV2 } from "../../model"
import { ProviderV2 } from "../../provider"

export const OMNIROUTE_HOST = "http://localhost:20128"
export const OMNIROUTE_PROVIDER_ID = "omniroute"

/**
 * Prefixes OmniRoute documents for routing. These are not offered as models to pull - they are
 * how you address a model the gateway already has. Kept small deliberately; the real list comes
 * from the gateway.
 */
export const OMNIROUTE_PREFIXES = [
  { id: "openai/gpt-5", label: "OpenAI routed", note: "through the user's OpenAI connection" },
  { id: "anthropic/claude-sonnet-4-5", label: "Anthropic routed", note: "through the user's Anthropic connection" },
  { id: "gemini/gemini-2.5-pro", label: "Gemini routed", note: "through the user's Google connection" },
  { id: "groq/llama-3.3-70b-versatile", label: "Groq routed", note: "fast free tier" },
] as const

/** Parses the OpenAI-shaped `{ data: [{ id }] }` that `/v1/models` returns. */
export function parseModels(payload: unknown): string[] {
  if (typeof payload !== "object" || payload === null) return []
  const data = (payload as { data?: unknown }).data
  if (!Array.isArray(data)) return []
  return data.flatMap((entry) =>
    typeof entry === "object" && entry !== null && typeof (entry as { id?: unknown }).id === "string"
      ? [(entry as { id: string }).id]
      : [],
  )
}

type FetchLike = (input: string, init?: RequestInit) => Promise<Response>

/** Never throws. OmniRoute simply not running is the normal case, not an error. */
export async function listModels(fetcher: FetchLike = fetch, host = OMNIROUTE_HOST): Promise<string[]> {
  try {
    const response = await fetcher(`${host}/v1/models`, { signal: AbortSignal.timeout(1500) })
    if (!response.ok) return []
    return parseModels(await response.json())
  } catch {
    return []
  }
}

export async function isRunning(fetcher: FetchLike = fetch, host = OMNIROUTE_HOST): Promise<boolean> {
  try {
    const response = await fetcher(`${host}/v1/models`, { signal: AbortSignal.timeout(2500) })
    return response.ok
  } catch {
    return false
  }
}

export const OmniRoutePlugin = define({
  id: "omniroute",
  effect: Effect.fn(function* (ctx) {
    yield* ctx.catalog.transform(
      Effect.fn(function* (evt) {
        const providerID = ProviderV2.ID.make(OMNIROUTE_PROVIDER_ID)
        const discovered = yield* Effect.tryPromise(() => listModels()).pipe(Effect.orElseSucceed(() => [] as string[]))

        // Registered unconditionally so it appears whether or not the gateway is up yet.
        evt.provider.update(providerID, (provider) => {
          provider.name = "OmniRoute (local gateway)"
          provider.api = { type: "aisdk", package: "@ai-sdk/openai-compatible", url: `${OMNIROUTE_HOST}/v1` }
        })

        const listing = discovered.length
          ? discovered.map((id) => ({ id, label: id, note: "discovered from your OmniRoute gateway" }))
          : OMNIROUTE_PREFIXES.map((entry) => ({ ...entry }))

        for (const model of listing) {
          const modelID = ModelV2.ID.make(model.id)
          evt.model.update(providerID, modelID, (draft) => {
            draft.name = model.label
            draft.cost = [{ input: 0, output: 0, cache: { read: 0, write: 0 } }]
            draft.capabilities = { tools: true, input: ["text", "image"], output: ["text"] }
            draft.limit = { context: 128_000, output: 8_192 }
          })
        }
      }),
    )
  }),
})