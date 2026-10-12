/**
 * Local OmniRoute gateway.
 *
 * OmniRoute is an MIT-licensed, self-hosted gateway that fronts 200+ providers behind one
 * OpenAI-compatible endpoint on `localhost:20128`. It sits alongside Ollama as a provider that
 * needs no hosted account, and unlike Ollama it owns no model list of its own - it exposes
 * whatever the user connected in its dashboard.
 *
 * Two details the docs are explicit about and that this integration depends on:
 *
 *   - `GET /v1/models` requires `Authorization: Bearer <key>`, so discovery has to send auth or
 *     it returns 401 and the provider looks empty. The key is taken from `OMNIROUTE_API_KEY`,
 *     falling back to a placeholder because local gateways routinely accept any bearer value.
 *   - Model ids are prefixed by route - `cc/claude-opus-4-7`, `gh/gpt-5.1-codex`,
 *     `openai/gpt-5.2`. The prefix is part of the id and must be preserved verbatim, so nothing
 *     here rewrites or normalises them.
 */

import { Effect } from "effect"
import { define } from "@opencode-ai/plugin/v2/effect/plugin"
import { ModelV2 } from "../../model"
import { ProviderV2 } from "../../provider"

export const OMNIROUTE_HOST = "http://localhost:20128"
export const OMNIROUTE_BASE_URL = `${OMNIROUTE_HOST}/v1`
export const OMNIROUTE_PROVIDER_ID = "omniroute"
export const OMNIROUTE_DASHBOARD_URL = `${OMNIROUTE_HOST}/`
export const OMNIROUTE_INSTALL = "npm install -g omniroute"

/**
 * Documented routing prefixes, used only when the gateway is not running so the provider is
 * still selectable rather than vanishing. Not a catalogue - the real list is discovered.
 */
export const OMNIROUTE_PREFIXES = [
  { id: "cc/claude-sonnet-4-6", label: "Claude Sonnet 4.6 (routed)" },
  { id: "cc/claude-opus-4-7", label: "Claude Opus 4.7 (routed)" },
  { id: "gh/gpt-5.1-codex", label: "GPT-5.1 Codex (routed)" },
  { id: "openai/gpt-5.2", label: "GPT-5.2 (routed)" },
] as const

export type OmniRouteModel = {
  readonly id: string
  readonly label: string
  readonly ownedBy?: string
}

/**
 * The gateway returns one flat OpenAI list covering chat, embedding and image models. Only chat
 * models are offered - offering an embedding model in a coding agent's picker would be a dead
 * choice, since they cannot be used for a completion.
 */
export function parseModels(payload: unknown): OmniRouteModel[] {
  if (typeof payload !== "object" || payload === null) return []
  const data = (payload as { data?: unknown }).data
  if (!Array.isArray(data)) return []
  return data.flatMap((entry) => {
    if (typeof entry !== "object" || entry === null) return []
    const id = (entry as { id?: unknown }).id
    if (typeof id !== "string") return []
    const ownedBy = (entry as { owned_by?: unknown }).owned_by
    return [
      {
        id,
        label: typeof ownedBy === "string" && ownedBy.length > 0 ? `${id}  (${ownedBy})` : id,
        ownedBy: typeof ownedBy === "string" ? ownedBy : undefined,
      },
    ]
  })
}

/** Ids of the models worth showing: anything chat-shaped, excluding embeddings and images. */
export function chatOnly(models: readonly OmniRouteModel[]): OmniRouteModel[] {
  return models.filter((model) => !/embedding|embed|whisper|tts|image|dall|flux|stable-diffusion|nano-?banana/i.test(model.id))
}

type FetchLike = (input: string, init?: RequestInit) => Promise<Response>

/** Discovery needs the bearer token; without it the endpoint answers 401. */
export function bearer(env: Record<string, string | undefined> = process.env): string {
  return `Bearer ${env["OMNIROUTE_API_KEY"]?.trim() || "omniroute-local"}`
}

/** Never throws. A gateway that is not running is the normal case, not an error. */
export async function listModels(
  fetcher: FetchLike = fetch,
  host = OMNIROUTE_HOST,
  env: Record<string, string | undefined> = process.env,
): Promise<OmniRouteModel[]> {
  try {
    const response = await fetcher(`${host}/v1/models`, {
      signal: AbortSignal.timeout(2000),
      headers: { authorization: bearer(env) },
    })
    if (!response.ok) return []
    return parseModels(await response.json())
  } catch {
    return []
  }
}

export async function isRunning(
  fetcher: FetchLike = fetch,
  host = OMNIROUTE_HOST,
  env: Record<string, string | undefined> = process.env,
): Promise<boolean> {
  try {
    const response = await fetcher(`${host}/v1/models`, {
      signal: AbortSignal.timeout(2500),
      headers: { authorization: bearer(env) },
    })
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
        const discovered = yield* Effect.tryPromise(() => listModels()).pipe(
          Effect.orElseSucceed(() => [] as OmniRouteModel[]),
        )
        const usable = chatOnly(discovered)

        // Registered unconditionally so it appears whether or not the gateway is up yet.
        evt.provider.update(providerID, (provider) => {
          provider.name = "OmniRoute (local gateway)"
          provider.api = { type: "aisdk", package: "@ai-sdk/openai-compatible", url: OMNIROUTE_BASE_URL }
          // The OpenAI-compatible SDK only sends Authorization if the provider has a key, and
          // OmniRoute checks it on every route including /v1/models.
          provider.request.headers["authorization"] = bearer()
        })

        // Verified against a running gateway: /v1/models answers 401 even when the gateway sets
        // REQUIRE_API_KEY=false, because the inference plane still expects a key created in
        // Dashboard -> Endpoint -> Registered Keys. So without one we offer the documented
        // prefixes and say why, rather than showing an empty provider and looking broken.
        const listing: readonly OmniRouteModel[] =
          usable.length > 0
            ? usable
            : OMNIROUTE_PREFIXES.map((entry) => ({ id: entry.id, label: `${entry.label} - set OMNIROUTE_API_KEY to list your own` }))

        for (const model of listing) {
          const modelID = ModelV2.ID.make(model.id)
          evt.model.update(providerID, modelID, (draft) => {
            draft.name = model.label
            draft.cost = [{ input: 0, output: 0, cache: { read: 0, write: 0 } }]
            draft.capabilities = { tools: true, input: ["text"], output: ["text"] }
            draft.limit = { context: 128_000, output: 8_192 }
          })
        }
      }),
    )
  }),
})