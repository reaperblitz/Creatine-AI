import { describe, expect, test } from "bun:test"
import { Effect } from "effect"
import { Catalog } from "@opencode-ai/core/catalog"
import { ModelV2 } from "@opencode-ai/core/model"
import { PluginV2 } from "@opencode-ai/core/plugin"
import { PluginHost } from "@opencode-ai/core/plugin/host"
import { ProviderV2 } from "@opencode-ai/core/provider"
import { testEffect } from "../lib/effect"
import { PluginTestLayer } from "./fixture"
import {
  bearer,
  chatOnly,
  isRunning,
  listModels,
  OmniRoutePlugin,
  OMNIROUTE_BASE_URL,
  OMNIROUTE_HOST,
  OMNIROUTE_INSTALL,
  OMNIROUTE_PREFIXES,
  parseModels,
} from "../../src/plugin/provider/omniroute"

const it = testEffect(PluginTestLayer)

describe("discovering gateway models", () => {
  test("reads ids and owners from the OpenAI-shaped list", () => {
    expect(parseModels({ data: [{ id: "cc/claude-opus-4-7", owned_by: "anthropic" }] })).toEqual([
      { id: "cc/claude-opus-4-7", label: "cc/claude-opus-4-7  (anthropic)", ownedBy: "anthropic" },
    ])
  })

  test("keeps the route prefix verbatim", () => {
    // `gh/gpt-5.1-codex` is not `gpt-5.1-codex`; rewriting the prefix makes every model 404.
    const [model] = parseModels({ data: [{ id: "gh/gpt-5.1-codex" }] })
    expect(model.id).toBe("gh/gpt-5.1-codex")
  })

  test("tolerates a gateway that is absent or replies oddly", () => {
    expect(parseModels({})).toEqual([])
    expect(parseModels({ data: "nope" })).toEqual([])
    expect(parseModels(null)).toEqual([])
    expect(parseModels({ data: [{ nope: 1 }, { id: "ok/one" }] })).toHaveLength(1)
  })

  test("hides embedding, image and audio models from a coding picker", () => {
    const models = parseModels({
      data: [
        { id: "nebius/Qwen3-Embedding-8B" },
        { id: "openai/gpt-image-2" },
        { id: "openai/whisper-1" },
        { id: "cc/claude-sonnet-4-6" },
      ],
    })
    expect(chatOnly(models).map((m) => m.id)).toEqual(["cc/claude-sonnet-4-6"])
  })

  test("a refused connection yields an empty list instead of throwing", async () => {
    expect(
      await listModels(async () => {
        throw new Error("ECONNREFUSED")
      }),
    ).toEqual([])
  })

  test("detects a running gateway", async () => {
    expect(await isRunning(async () => new Response("{}", { status: 200 }))).toBe(true)
    expect(
      await isRunning(async () => {
        throw new Error("ECONNREFUSED")
      }),
    ).toBe(false)
  })
})

describe("authentication", () => {
  test("discovery sends a bearer token, because the endpoint rejects requests without one", async () => {
    let sent: string | undefined
    await listModels(async (_url, init) => {
      sent = (init?.headers as Record<string, string> | undefined)?.["authorization"]
      return new Response(JSON.stringify({ data: [] }), { status: 200 })
    })
    expect(sent).toMatch(/^Bearer /)
  })

  test("uses the configured key when there is one", () => {
    expect(bearer({ OMNIROUTE_API_KEY: "sk_live_abc" })).toBe("Bearer sk_live_abc")
  })

  test("falls back to a placeholder so a local gateway still works without a key", () => {
    expect(bearer({})).toMatch(/^Bearer /)
    expect(bearer({ OMNIROUTE_API_KEY: "   " })).toMatch(/^Bearer /)
  })
})

describe("endpoint and install", () => {
  test("uses the documented local endpoint", () => {
    expect(OMNIROUTE_HOST).toBe("http://localhost:20128")
    expect(OMNIROUTE_BASE_URL).toBe("http://localhost:20128/v1")
  })

  test("documents the supported install command", () => {
    expect(OMNIROUTE_INSTALL).toBe("npm install -g omniroute")
  })

  test("the fallback prefixes are all route-qualified", () => {
    for (const entry of OMNIROUTE_PREFIXES) expect(entry.id).toMatch(/^[a-z]+\//)
  })
})

describe("registering against the real catalog", () => {
  it.live("registers with the gateway not running", () =>
    Effect.gen(function* () {
      const catalog = yield* Catalog.Service
      yield* OmniRoutePlugin.effect(yield* PluginHost.make(yield* PluginV2.Service))
      yield* catalog.transform(() => {})

      const record = yield* catalog.provider.get(ProviderV2.ID.make("omniroute"))
      expect(record).toBeDefined()
      expect(record!.name).toBe("OmniRoute (local gateway)")
      expect(record!.api).toMatchObject({ url: "http://localhost:20128/v1" })
      expect(record!.request.headers["authorization"]).toMatch(/^Bearer /)
    }))

  it.live("still offers something selectable when discovery finds nothing", () =>
    Effect.gen(function* () {
      const catalog = yield* Catalog.Service
      yield* OmniRoutePlugin.effect(yield* PluginHost.make(yield* PluginV2.Service))
      yield* catalog.transform(() => {})

      for (const entry of OMNIROUTE_PREFIXES)
        expect(yield* catalog.model.get(ProviderV2.ID.make("omniroute"), ModelV2.ID.make(entry.id))).toBeDefined()
    }))
})