import { describe, expect, test } from "bun:test"
import { localProviderSpecs, OLLAMA_DEFAULT_URL, OMNIROUTE_DEFAULT_URL, toInfo } from "../src/provider/local-providers"

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