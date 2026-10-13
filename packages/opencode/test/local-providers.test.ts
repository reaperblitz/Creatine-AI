import { describe, expect, test } from "bun:test"
import { discover, localProviderSpecs, OLLAMA_DEFAULT_URL, OMNIROUTE_DEFAULT_URL, toInfo } from "../src/provider/local-providers"

describe("local providers are present", () => {
  test("both local providers are offered without any configuration", () => {
    expect(localProviderSpecs({}).map((s) => s.id)).toEqual(["ollama", "omniroute"])
  })

  test("they are registered as custom-sourced, which is what the loader expects", () => {
    // source: "custom" is required: the provider loader reads this catalogue and silently
    // discards anything it does not recognise, which is how these two went missing.
    for (const spec of localProviderSpecs({})) expect(toInfo(spec).source).toBe("custom")
  })

  test("both carry an OpenAI-compatible endpoint", () => {
    for (const spec of localProviderSpecs({})) {
      const info = toInfo(spec)
      expect(info.options.baseURL).toBeTruthy()
      for (const model of Object.values(info.models)) expect(model.api.npm).toBe("@ai-sdk/openai-compatible")
    }
  })

  test("ollama always has a key, because the OpenAI SDK will not send a request without one", () => {
    expect(toInfo(localProviderSpecs({})[0]).options.apiKey).toBeTruthy()
  })
})

describe("endpoints are user-configurable", () => {
  test("defaults point at the documented local ports", () => {
    expect(OLLAMA_DEFAULT_URL).toBe("http://127.0.0.1:11434/v1")
    expect(OMNIROUTE_DEFAULT_URL).toBe("http://localhost:20128/v1")
    const [, omni] = localProviderSpecs({})
    expect(omni.baseUrl).toBe(OMNIROUTE_DEFAULT_URL)
  })

  test("a custom gateway url overrides the default rather than being ignored", () => {
    const [, omni] = localProviderSpecs({ OMNIROUTE_URL: "https://omni.internal/v1" })
    expect(omni.baseUrl).toBe("https://omni.internal/v1")
  })

  test("a custom ollama url is honoured too", () => {
    const [ollama] = localProviderSpecs({ OLLAMA_URL: "http://10.0.0.5:11434/v1" })
    expect(ollama.baseUrl).toBe("http://10.0.0.5:11434/v1")
  })

  test("a blank override falls back rather than producing an empty base url", () => {
    const [, omni] = localProviderSpecs({ OMNIROUTE_URL: "   " })
    expect(omni.baseUrl).toBe(OMNIROUTE_DEFAULT_URL)
  })
})

describe("omniroute key", () => {
  test("is read from the environment when the user configured one", () => {
    const [, omni] = localProviderSpecs({ OMNIROUTE_API_KEY: "sk_live_abc" })
    expect(omni.apiKey).toBe("sk_live_abc")
  })

  test("is empty when unset, so the failure is the gateway answering 401 rather than a bogus key", () => {
    // Verified against a running gateway: /v1/models returns 401 even with REQUIRE_API_KEY=false,
    // and a made-up bearer produces the same 401 - indistinguishable from a missing key.
    const [, omni] = localProviderSpecs({})
    expect(omni.apiKey).toBe("")
  })
})

describe("model listings", () => {
  test("ollama advertises models sized for the machine", () => {
    const [ollama] = localProviderSpecs({})
    const names = Object.values(ollama.models).map((m) => m.name)
    expect(names.some((n) => n.includes("4 GB RAM"))).toBe(true)
    expect(names.some((n) => n.includes("20 GB RAM"))).toBe(true)
  })

  test("omniroute models keep their route prefix, which is part of the id", () => {
    const [, omni] = localProviderSpecs({})
    for (const model of omni.models) expect(model.id).toMatch(/^[a-z]+\//)
  })
})
describe("discovery beats the placeholder list", () => {
  const real = [
    { id: "cc/claude-sonnet-4-6", name: "cc/claude-sonnet-4-6" },
    { id: "gh/gpt-5.1-codex", name: "gh/gpt-5.1-codex" },
  ]

  test("a running gateway's own models replace the made-up ids", () => {
    // The bug this fixes: a hard-coded list is worse than none, because picking an id the
    // gateway does not serve 404s at send time.
    const [, omni] = localProviderSpecs({ OMNIROUTE_API_KEY: "k" }, { omniroute: real })
    expect(omni.models.map((m) => m.id)).toEqual(["cc/claude-sonnet-4-6", "gh/gpt-5.1-codex"])
  })

  test("a gateway that returns nothing still yields the placeholders, so the provider is usable", () => {
    const [, omni] = localProviderSpecs({}, { omniroute: [] })
    expect(omni.models.length).toBeGreaterThan(0)
  })

  test("an unreachable gateway does not stop either provider being registered", () => {
    expect(localProviderSpecs({}).map((s) => s.id)).toEqual(["ollama", "omniroute"])
  })

  test("discovery reaches ollama too", () => {
    const [ollama] = localProviderSpecs({}, { ollama: [{ id: "llama3.2:3b", name: "llama3.2:3b" }] })
    expect(ollama.models.map((m) => m.id)).toEqual(["llama3.2:3b"])
  })
})

describe("discovering from a live gateway", () => {
  const withFetch = async (impl: typeof fetch, run: () => Promise<void>) => {
    const original = globalThis.fetch
    globalThis.fetch = impl
    try {
      await run()
    } finally {
      globalThis.fetch = original
    }
  }

  test("asks the gateway's own /models endpoint", async () => {
    let called = ""
    await withFetch(
      (async (input: string) => {
        called = String(input)
        return new Response(JSON.stringify({ data: [{ id: "cc/claude-opus-4-7" }] }), { status: 200 })
      }) as unknown as typeof fetch,
      async () => {
        expect(await discover("http://localhost:20128/v1", "k")).toEqual([
          { id: "cc/claude-opus-4-7", name: "cc/claude-opus-4-7" },
        ])
        expect(called).toBe("http://localhost:20128/v1/models")
      },
    )
  })

  test("drops models that cannot serve a completion", async () => {
    await withFetch(
      (async () =>
        new Response(
          JSON.stringify({
            data: [{ id: "nebius/Qwen3-Embedding-8B" }, { id: "openai/gpt-image-2" }, { id: "cc/ok" }],
          }),
          { status: 200 },
        )) as unknown as typeof fetch,
      async () => {
        expect((await discover("http://x/v1", "k")).map((m) => m.id)).toEqual(["cc/ok"])
      },
    )
  })

  test("a 401 yields an empty list rather than throwing", async () => {
    await withFetch((async () => new Response("nope", { status: 401 })) as unknown as typeof fetch, async () => {
      expect(await discover("http://localhost:20128/v1", "")).toEqual([])
    })
  })

  test("a refused connection yields an empty list rather than throwing", async () => {
    await withFetch(
      (async () => {
        throw new Error("ECONNREFUSED")
      }) as unknown as typeof fetch,
      async () => {
        expect(await discover("http://localhost:20128/v1", "k")).toEqual([])
      },
    )
  })

  test("sends no authorization header when there is no key", async () => {
    let seen: unknown
    await withFetch(
      (async (_input: string, init?: RequestInit) => {
        seen = init?.headers
        return new Response(JSON.stringify({ data: [] }), { status: 200 })
      }) as unknown as typeof fetch,
      async () => {
        await discover("http://localhost:20128/v1", "")
        expect(seen).toEqual({})
      },
    )
  })
})