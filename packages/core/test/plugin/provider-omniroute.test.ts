import { describe, expect, test } from "bun:test"
import { Effect } from "effect"
import { Catalog } from "@opencode-ai/core/catalog"
import { ModelV2 } from "@opencode-ai/core/model"
import { PluginV2 } from "@opencode-ai/core/plugin"
import { PluginHost } from "@opencode-ai/core/plugin/host"
import { ProviderV2 } from "@opencode-ai/core/provider"
import { testEffect } from "../lib/effect"
import { PluginTestLayer } from "./fixture"
import { isRunning, listModels, OmniRoutePlugin, OMNIROUTE_HOST, OMNIROUTE_PREFIXES, parseModels } from "../../src/plugin/provider/omniroute"

const it = testEffect(PluginTestLayer)

describe("discovering gateway models", () => {
  test("reads ids from the OpenAI-shaped model list", () => {
    expect(parseModels({ data: [{ id: "gh/gpt-5.1-codex" }, { id: "cc/claude-opus-4" }] })).toEqual([
      "gh/gpt-5.1-codex",
      "cc/claude-opus-4",
    ])
  })

  test("tolerates a gateway that is not there or replies oddly", () => {
    expect(parseModels({})).toEqual([])
    expect(parseModels({ data: "nope" })).toEqual([])
    expect(parseModels(null)).toEqual([])
    expect(parseModels({ data: [{ nope: 1 }, { id: "ok/one" }] })).toEqual(["ok/one"])
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

  test("documents the local endpoint", () => {
    expect(OMNIROUTE_HOST).toBe("http://localhost:20128")
  })
})

describe("registering against the real catalog", () => {
  it.live("registers even with the gateway not running", () =>
    Effect.gen(function* () {
      const catalog = yield* Catalog.Service
      yield* OmniRoutePlugin.effect(yield* PluginHost.make(yield* PluginV2.Service))
      yield* catalog.transform(() => {})

      const record = yield* catalog.provider.get(ProviderV2.ID.make("omniroute"))
      expect(record).toBeDefined()
      expect(record!.name).toBe("OmniRoute (local gateway)")
      expect(record!.api).toMatchObject({ url: "http://localhost:20128/v1" })
    }))

  it.live("still offers something selectable when discovery finds nothing", () =>
    Effect.gen(function* () {
      const catalog = yield* Catalog.Service
      yield* OmniRoutePlugin.effect(yield* PluginHost.make(yield* PluginV2.Service))
      yield* catalog.transform(() => {})

      // With no gateway running there is nothing to discover, so the documented prefixes stand in.
      for (const entry of OMNIROUTE_PREFIXES)
        expect(yield* catalog.model.get(ProviderV2.ID.make("omniroute"), ModelV2.ID.make(entry.id))).toBeDefined()
    }))
})