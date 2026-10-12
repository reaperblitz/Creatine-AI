import { describe, expect, test } from "bun:test"
import { Effect } from "effect"
import { Catalog } from "@opencode-ai/core/catalog"
import { ModelV2 } from "@opencode-ai/core/model"
import { PluginV2 } from "@opencode-ai/core/plugin"
import { PluginHost } from "@opencode-ai/core/plugin/host"
import { ProviderV2 } from "@opencode-ai/core/provider"
import { testEffect } from "../lib/effect"
import { PluginTestLayer } from "./fixture"
import { displayName, isRunning, listModels, OllamaPlugin, parseTags, pull, recommend, RECOMMENDED, OLLAMA_HOST } from "../../src/plugin/provider/ollama"

const it = testEffect(PluginTestLayer)

describe("the offered model list", () => {
  test("offers two lightweight and two deeper models, as asked", () => {
    expect(RECOMMENDED).toHaveLength(4)
    expect(RECOMMENDED.filter((m) => m.minRamGb <= 4)).toHaveLength(2)
    expect(RECOMMENDED.filter((m) => m.minRamGb >= 8)).toHaveLength(2)
  })

  test("covers both qwen and llama, so it is not one vendor's list", () => {
    expect(RECOMMENDED.some((m) => m.id.startsWith("qwen"))).toBe(true)
    expect(RECOMMENDED.some((m) => m.id.startsWith("llama"))).toBe(true)
  })

  test("every model states the RAM and disk it needs, in the name the user sees", () => {
    for (const model of RECOMMENDED) {
      const shown = displayName(model)
      expect(shown).toContain(`${model.minRamGb} GB RAM`)
      expect(shown).toContain(`${model.diskGb} GB disk`)
    }
  })
})

describe("model sizing by hardware", () => {
  test("a small machine gets a lightweight model, not the largest that technically fits", () => {
    expect(recommend({ totalRamGb: 4, cpuCores: 2 }).id).toBe("llama3.2:3b")
    expect(recommend({ totalRamGb: 2, cpuCores: 1 }).id).toBe("qwen2.5-coder:1.5b")
  })

  test("an 8 GB machine - the common case - gets the 7B coder model", () => {
    expect(recommend({ totalRamGb: 8, cpuCores: 4 }).id).toBe("qwen2.5-coder:7b")
    expect(recommend({ totalRamGb: 16, cpuCores: 8 }).id).toBe("qwen2.5-coder:7b")
  })

  test("bigger RAM climbs to the deeper model", () => {
    expect(recommend({ totalRamGb: 24, cpuCores: 8 }).id).toBe("qwen2.5-coder:14b")
  })

  test("a machine below every threshold still gets something rather than nothing", () => {
    expect(recommend({ totalRamGb: 1, cpuCores: 1 }).id).toBe(RECOMMENDED[0].id)
  })

  test("the ladder never goes downhill", () => {
    // Both lightweight entries legitimately sit at 4 GB, so the invariant is non-decreasing.
    for (let i = 1; i < RECOMMENDED.length; i++)
      expect(RECOMMENDED[i].minRamGb).toBeGreaterThanOrEqual(RECOMMENDED[i - 1].minRamGb)
  })

  test("cpu cores do not drive the choice", () => {
    expect(recommend({ totalRamGb: 4, cpuCores: 64 }).id).toBe("llama3.2:3b")
  })
})

describe("registering against the real catalog", () => {
  // The regression that actually mattered. listModels was called through Effect.promise, so a
  // machine with no daemon produced a *defect*, which orElseSucceed cannot catch. The transform
  // died and the provider silently never appeared in the picker. These run the plugin for real.
  it.live("appears in the catalog with no daemon running", () =>
    Effect.gen(function* () {
      const catalog = yield* Catalog.Service
      yield* OllamaPlugin.effect(yield* PluginHost.make(yield* PluginV2.Service))
      yield* catalog.transform(() => {})

      const record = yield* catalog.provider.get(ProviderV2.ID.make("ollama"))
      expect(record).toBeDefined()
      expect(record!.name).toBe("Ollama (local)")
      expect(record!.api).toMatchObject({ url: "http://127.0.0.1:11434/v1" })
    }))

  it.live("registers all four models with their requirements in the name", () =>
    Effect.gen(function* () {
      const catalog = yield* Catalog.Service
      yield* OllamaPlugin.effect(yield* PluginHost.make(yield* PluginV2.Service))
      yield* catalog.transform(() => {})

      for (const model of RECOMMENDED) {
        const entry = yield* catalog.model.get(ProviderV2.ID.make("ollama"), ModelV2.ID.make(model.id))
        expect(entry).toBeDefined()
        expect(entry!.name ?? "").toContain(`${model.minRamGb} GB RAM`)
      }
    }))

  it.live("still registers when the daemon refuses the connection", () =>
    Effect.gen(function* () {
      const catalog = yield* Catalog.Service
      yield* OllamaPlugin.effect(yield* PluginHost.make(yield* PluginV2.Service))
      yield* catalog.transform(() => {})
      expect(yield* catalog.provider.get(ProviderV2.ID.make("ollama"))).toBeDefined()
    }))
})

describe("detecting a running daemon", () => {
  test("an answering daemon is reported as running", async () => {
    expect(await isRunning(async () => new Response("{}", { status: 200 }))).toBe(true)
  })

  test("a refused connection is not running, and does not throw", async () => {
    expect(
      await isRunning(async () => {
        throw new Error("ECONNREFUSED")
      }),
    ).toBe(false)
  })

  test("a non-2xx response is not running", async () => {
    expect(await isRunning(async () => new Response("", { status: 500 }))).toBe(false)
  })
})

describe("listing installed models", () => {
  test("a refused connection yields an empty list rather than throwing", async () => {
    // This is the exact case that broke the picker: no daemon on a fresh machine.
    expect(
      await listModels(async () => {
        throw new Error("ECONNREFUSED")
      }),
    ).toEqual([])
  })

  test("reads model names out of a real response", async () => {
    const models = await listModels(async () => Response.json({ models: [{ name: "qwen2.5-coder:7b" }] }))
    expect(models).toEqual(["qwen2.5-coder:7b"])
  })

  test("tolerates the shapes a cold or odd daemon returns", () => {
    expect(parseTags({})).toEqual([])
    expect(parseTags(null)).toEqual([])
    expect(parseTags("nope")).toEqual([])
    expect(parseTags({ models: [{ nope: 1 }, null, { name: "ok:1b" }] })).toEqual(["ok:1b"])
  })
})

describe("pulling a model", () => {
  const stream = (lines: string[]) =>
    new Response(new Blob([lines.join("\n") + "\n"]), { headers: { "content-type": "application/x-ndjson" } })

  test("reports progress and succeeds", async () => {
    const seen: number[] = []
    const ok = await Effect.runPromise(
      pull(
        "qwen2.5-coder:7b",
        (percent) => void seen.push(percent),
        async () => stream(['{"completed":50,"total":100,"status":"pulling"}', '{"status":"success"}']),
      ),
    )
    expect(ok).toBe(true)
    expect(seen).toContain(50)
    expect(seen[seen.length - 1]).toBe(100)
  })

  test("a failed pull returns false instead of throwing", async () => {
    const ok = await Effect.runPromise(
      pull("bad:1b", () => {}, async () => {
        throw new Error("boom")
      }),
    )
    expect(ok).toBe(false)
  })

  test("a non-2xx pull reports failure rather than pretending to start", async () => {
    expect(await Effect.runPromise(pull("bad:1b", () => {}, async () => new Response("", { status: 500 })))).toBe(false)
  })

  test("malformed stream lines are skipped, not fatal", async () => {
    expect(await Effect.runPromise(pull("m:1b", () => {}, async () => stream(["not json", '{"status":"success"}'])))).toBe(true)
  })

  test("targets the local daemon by default", async () => {
    let called = ""
    await Effect.runPromise(
      pull("m:1b", () => {}, async (url) => {
        called = url
        return new Response("")
      }),
    )
    expect(called.startsWith(OLLAMA_HOST)).toBe(true)
  })
})